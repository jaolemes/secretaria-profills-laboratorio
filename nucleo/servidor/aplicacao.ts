import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  conferirPacote,
  conferirVersaoPublicada,
  extrairPacote,
  juntarEstado,
  versaoMaior,
  type Aplicacao,
  type EstadoDaAtualizacao,
  type Manifesto,
  type MotivoDaFalha,
  type Ocupacao,
  type PassoDaAplicacao,
} from "../atualizacao";
import { andamentoPreparado, caminhosDoAtualizador, gravarAndamento, haAtualizacaoPendente, lerAndamento } from "../atualizador";
import { listarCartoes, segurarTrava, type BancoAberto } from "../banco";
import type { Conectores } from "../conectores";
import { FASES_DURAVEIS, falha, ok, type Instante, type Resultado } from "../dominio";
import { destacar, type Supervisor } from "../processos";
import type { Registro } from "../registro";
import { buscarVersao, type Descoberta, type FonteDasVersoes } from "./atualizacao";
import type { Sessoes } from "./sessoes";

/** O pacote passa de 2 MB; numa conexão ruim, minutos. */
const PRAZO_DO_PACOTE_MS = 10 * 60_000;
const PRAZO_DAS_DEPENDENCIAS_MS = 15 * 60_000;
/** Quanto o servidor espera o atualizador segurar a trava antes de desistir dele e seguir no ar. */
const PRAZO_DO_ATUALIZADOR_MS = 15_000;
/** O resultado que o atualizador gravou só vale para o servidor que sobe logo depois dele. */
const JANELA_DO_RESULTADO_MS = 10 * 60_000;

export interface Aplicador {
  /** A descoberta, a atualização deste processo ou a que o atualizador gravou, e o que está ocupado agora. */
  estado(): EstadoDaAtualizacao;
  /**
   * O clique do vendedor. Confere as travas, guarda a sessão da aba e começa a atualização sem esperar por ela:
   * a resposta já é `atualizando`. Com uma em curso, devolve o estado dela e não começa outra.
   */
  aplicar(cookies: string | null): Resultado<EstadoDaAtualizacao>;
}

export interface DependenciasDoAplicador {
  readonly descoberta: Descoberta;
  readonly fonte: FonteDasVersoes;
  readonly instalada: string;
  readonly dirRepo: string;
  readonly dirDados: string;
  readonly banco: BancoAberto;
  readonly conectores: Pick<Conectores, "estado" | "assinarSincronizacao">;
  readonly supervisor: Supervisor;
  readonly sessoes: Pick<Sessoes, "guardarParaORestart">;
  readonly registro: Registro;
  /** Quando este servidor subiu. */
  readonly subiuEm: Instante;
  agora(): Instante;
  /** Chamado a cada mudança de passo, para o SSE. */
  aoMudar(estado: EstadoDaAtualizacao): void;
  pedirParada(): void;
}

const ehDuravel = (fase: string) => (FASES_DURAVEIS as readonly string[]).includes(fase);

async function esperarAte(condicao: () => boolean, prazoMs: number): Promise<boolean> {
  const fim = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() >= fim) return false;
    await Bun.sleep(50);
  }
  return true;
}

/** Lê o pacote até o tamanho que o manifesto diz, mais um byte: o que passa disso já não confere. */
async function baixarPacote(endereco: URL, bytes: number): Promise<Uint8Array | null> {
  try {
    const resposta = await fetch(endereco, { signal: AbortSignal.timeout(PRAZO_DO_PACOTE_MS) });
    if (resposta.status !== 200 || resposta.body === null) {
      await resposta.body?.cancel();
      return null;
    }
    const partes: Uint8Array[] = [];
    let total = 0;
    for await (const parte of resposta.body) {
      partes.push(parte);
      total += parte.length;
      if (total > bytes) break;
    }
    return new Uint8Array(Buffer.concat(partes));
  } catch {
    return null;
  }
}

class FalhaDaAplicacao extends Error {
  constructor(
    readonly motivo: MotivoDaFalha,
    detalhe: string,
  ) {
    super(detalhe);
    this.name = "FalhaDaAplicacao";
  }
}

export function criarAplicador(deps: DependenciasDoAplicador): Aplicador {
  const caminhos = caminhosDoAtualizador(deps.dirRepo, deps.dirDados);
  const rodadas = new Set<string>();
  deps.conectores.assinarSincronizacao((andamento) => {
    if (andamento.etapa === "comecou") rodadas.add(andamento.id);
    if (andamento.etapa === "terminou") rodadas.delete(andamento.id);
  });
  let nesteProcesso: Exclude<Aplicacao, { tipo: "concluida" | "nenhuma" }> | null = null;

  function ocupacoes(): Ocupacao[] {
    const lista: Ocupacao[] = [];
    if (listarCartoes(deps.banco, "gravando").length > 0) lista.push("gravando_no_crm");
    if (rodadas.size > 0) lista.push("sincronizando");
    const { whatsapp, crm, email } = deps.conectores.estado();
    if (!ehDuravel(whatsapp.fase)) lista.push("whatsapp_conectando");
    if (!ehDuravel(crm.fase)) lista.push("crm_conectando");
    if (email.contas.some((conta) => !ehDuravel(conta.estado.fase))) lista.push("email_testando");
    return lista;
  }

  /** O fim que o atualizador gravou, se ele acabou de subir este servidor (ou o `abrir` desfez uma que caiu). */
  function resultadoGravado(): Aplicacao {
    const lido = lerAndamento(caminhos.andamento);
    if (lido.tipo !== "lido") return { tipo: "nenhuma" };
    const { andamento } = lido;
    if (!(Date.parse(andamento.atualizadoEm) >= Date.parse(deps.subiuEm) - JANELA_DO_RESULTADO_MS)) return { tipo: "nenhuma" };
    if (andamento.fase === "concluido" && andamento.para === deps.instalada) {
      return { tipo: "concluida", de: andamento.de, nucleoMudado: andamento.mudados?.quantos ?? null, em: andamento.atualizadoEm };
    }
    if (andamento.fase === "desfeito" && andamento.falha !== null && andamento.de === deps.instalada) {
      return { tipo: "falhou", para: andamento.para, motivo: andamento.falha.motivo, em: andamento.atualizadoEm };
    }
    return { tipo: "nenhuma" };
  }

  const estado = () => juntarEstado(deps.descoberta.estado(), nesteProcesso ?? resultadoGravado(), ocupacoes());

  function mudar(aplicacao: Exclude<Aplicacao, { tipo: "concluida" | "nenhuma" }>): void {
    nesteProcesso = aplicacao;
    deps.aoMudar(estado());
  }

  async function manifestoDe(para: string): Promise<Manifesto> {
    const resposta = await buscarVersao(deps.fonte);
    if (resposta.tipo === "sem_resposta" || resposta.status !== 200) throw new FalhaDaAplicacao("sem_internet", "o versao.json não respondeu");
    const conferida = await conferirVersaoPublicada(resposta.corpo, { instalada: deps.instalada, chaves: deps.fonte.chaves });
    if (!conferida.ok) throw new FalhaDaAplicacao("versao_mudou", conferida.motivo);
    const { manifesto } = conferida;
    if (manifesto.versao !== para) throw new FalhaDaAplicacao("versao_mudou", `a versão publicada agora é a ${manifesto.versao}`);
    if (versaoMaior(manifesto.bunMinimo, Bun.version)) throw new FalhaDaAplicacao("versao_mudou", `a versão pede o Bun ${manifesto.bunMinimo}`);
    return manifesto;
  }

  /** Passo 2: nada de `nova/` existe antes de a assinatura do manifesto e o sha256 do pacote conferirem. */
  async function baixarEExtrair(para: string): Promise<void> {
    const manifesto = await manifestoDe(para);
    const bytes = await baixarPacote(deps.fonte.pacote(manifesto.pacote.url), manifesto.pacote.bytes);
    if (bytes === null) throw new FalhaDaAplicacao("sem_internet", "o pacote não chegou");
    const conferido = conferirPacote(bytes, manifesto);
    if (!conferido.ok) throw new FalhaDaAplicacao("pacote_recusado", conferido.detalhe);
    rmSync(caminhos.nova, { recursive: true, force: true });
    const extraido = extrairPacote(conferido.pacote, caminhos.nova);
    if (!extraido.ok) {
      rmSync(caminhos.nova, { recursive: true, force: true });
      throw new FalhaDaAplicacao("pacote_recusado", extraido.detalhe);
    }
  }

  /** Passo 3: toda a rede das dependências acontece com o servidor ainda no ar. */
  async function instalarDependencias(): Promise<void> {
    const feito = await deps.supervisor.executar(
      { argv: [process.execPath, "install", "--frozen-lockfile", "--cwd", caminhos.nova], env: {}, capturarStderr: true },
      PRAZO_DAS_DEPENDENCIAS_MS,
    );
    if (!feito.iniciou || feito.codigo !== 0) throw new FalhaDaAplicacao("dependencias_falharam", (feito.stderr ?? "").trim().slice(-500) || `saiu com ${feito.codigo ?? "limite de tempo"}`);
  }

  /**
   * Passo 4: o `preparado` é gravado com a trava na mão, para um `abrir` no meio não o tomar por uma
   * atualização que caiu. O servidor só pede a própria parada depois que o atualizador tomou a trava
   * e saiu de `preparado`: antes disso, uma parada deixaria a Secretária fora do ar sem ninguém para subi-la.
   */
  async function entregarAoAtualizador(para: string): Promise<void> {
    if (ocupacoes().length > 0) throw new FalhaDaAplicacao("ficou_ocupada", ocupacoes().join(", "));
    const trava = segurarTrava(caminhos.trava);
    if (trava === null) throw new FalhaDaAplicacao("ficou_ocupada", "outro processo segura a trava da atualização");
    try {
      if (haAtualizacaoPendente(deps.dirRepo)) throw new FalhaDaAplicacao("ficou_ocupada", "há uma atualização que não terminou");
      gravarAndamento(caminhos.andamento, andamentoPreparado(deps.instalada, para));
    } finally {
      trava.soltar();
    }
    const filho = destacar([process.execPath, join(caminhos.nova, "nucleo", "atualizador", "main.ts"), "--repo", deps.dirRepo, "--dados", deps.dirDados], {
      saidaEm: join(deps.dirDados, "logs", "atualizador.log"),
      cwd: deps.dirRepo,
    });
    const preparado = () => {
      const lido = lerAndamento(caminhos.andamento);
      return lido.tipo === "lido" && lido.andamento.fase === "preparado";
    };
    await esperarAte(() => !preparado() || filho.saida() !== null || filho.erro() !== null, PRAZO_DO_ATUALIZADOR_MS);
    if (preparado()) {
      const sem = segurarTrava(caminhos.trava);
      // Com a trava solta e o `preparado` ainda lá, o atualizador não começou: o servidor segue no ar e apaga o aviso.
      if (sem !== null) {
        try {
          rmSync(caminhos.andamento, { force: true });
        } finally {
          sem.soltar();
        }
        throw new FalhaDaAplicacao("atualizador_nao_comecou", filho.erro() ?? `saiu com ${filho.saida() ?? "nada"}`);
      }
    }
    deps.registro.info("atualizacao.reiniciando", { de: deps.instalada, para });
    deps.pedirParada();
  }

  async function rodar(para: string, cookies: string | null): Promise<void> {
    const passo = (proximo: PassoDaAplicacao) => mudar({ tipo: "em_curso", para, passo: proximo });
    try {
      await deps.sessoes.guardarParaORestart(cookies);
      await baixarEExtrair(para);
      passo("instalando");
      await instalarDependencias();
      passo("reiniciando");
      await entregarAoAtualizador(para);
    } catch (erro) {
      const motivo = erro instanceof FalhaDaAplicacao ? erro.motivo : "atualizador_nao_comecou";
      deps.registro.aviso("atualizacao.falhou", { motivo, erro: erro instanceof Error ? erro.message.slice(0, 500) : typeof erro });
      if (motivo === "versao_mudou") void deps.descoberta.conferir();
      mudar({ tipo: "falhou", para, motivo, em: deps.agora() });
    }
  }

  return {
    estado,
    aplicar(cookies) {
      const atual = estado();
      if (atual.fase === "atualizando") return ok(atual);
      const nova = atual.fase === "versao_nova" || atual.fase === "falhou" ? atual.nova : null;
      if (nova === null) return falha("sem_versao_nova");
      const bloqueio = atual.fase === "versao_nova" || atual.fase === "falhou" ? atual.bloqueio : null;
      if (bloqueio !== null) {
        const recusa = falha("atualizacao_bloqueada", bloqueio.explicacao);
        return recusa.ok ? recusa : { ok: false, erro: { ...recusa.erro, atual } };
      }
      if (haAtualizacaoPendente(deps.dirRepo)) return falha("atualizacao_em_andamento");
      // O estado muda antes da primeira espera: o segundo clique já encontra a atualização em curso.
      mudar({ tipo: "em_curso", para: nova.versao, passo: "baixando" });
      deps.registro.info("atualizacao.comecou", { de: deps.instalada, para: nova.versao });
      void rodar(nova.versao, cookies);
      return ok(estado());
    },
  };
}
