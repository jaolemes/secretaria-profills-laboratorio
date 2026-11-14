import { gravarConector, lerConector } from "../../banco";
import type { Segredo } from "../../cofre";
import {
  falha,
  ok,
  somar,
  textoExterno,
  transicionarCrm,
  type Acao,
  type EfeitoCrm,
  type EstadoCrm,
  type EventoCrm,
  type Instante,
  type MotivoDaRecusa,
  type Resultado,
  type SondagemCrm,
  type TextoExterno,
} from "../../dominio";
import type { Dependencias } from "../dependencias";
import { criarMotor, pedir, type Motor } from "../motor";
import { criarEscritor, type EscritorDoCrm } from "./escrita";
import { criarLeitor, type LeitorDoCrm } from "./leitura";
import { contarFerramentas } from "./mcp";
import {
  VIDA_DA_CONEXAO_MS,
  descobrir,
  mesmoState,
  prepararAutorizacao,
  renovar,
  trocarCodigo,
  type Cliente,
  type Pendente,
  type ServidorDeAutorizacao,
} from "./oauth";
import type { AcessoAoCrm } from "./sessao";

/** Renova antes de o access vencer no meio de um pedido. */
const FOLGA_DO_ACESSO_MS = 60_000;

type Acesso =
  | { readonly tipo: "ok"; readonly token: Segredo }
  | { readonly tipo: "ausente" }
  | { readonly tipo: "recusado" }
  | { readonly tipo: "indeterminado"; readonly detalhe: TextoExterno };

export interface CascaCrm {
  readonly motor: Motor<"crm", EventoCrm>;
  agir(acao: Acao): Promise<Resultado<{ readonly estado: EstadoCrm; readonly urlAutorizacao: string | null }>>;
  /** Trata a volta do navegador em `GET /oauth/crm/retorno`. */
  retorno(query: URLSearchParams): Promise<Resultado<EstadoCrm>>;
  /** Access token para o MCP. `null` sem conexão válida; o estado do conector diz o motivo. */
  tokenValido(): Promise<Segredo | null>;
  /** Leitor das tools de leitura do MCP, com o token desta conexão. Um por uso; `sinal` corta as leituras dele. */
  leitor(sinal?: AbortSignal): LeitorDoCrm;
  /** Escritor das três tools de escrita do MCP, com o mesmo acesso do leitor. Só o fluxo de aprovar o usa. */
  escritor(sinal?: AbortSignal): EscritorDoCrm;
  reconciliar(): Promise<void>;
  /** Corta os pedidos de rede em voo. */
  parar(): void;
}

export function criarCascaCrm(deps: Dependencias, aoMudar: () => void): CascaCrm {
  const { ambiente, cofre, registro } = deps;
  const agoraMs = () => Date.parse(ambiente.agora());
  const inicial = lerConector(deps.banco, "crm");

  const fim = new AbortController();
  /** Preparo do login em voo. O estado `autorizando` que o abriu é a identidade da tentativa. */
  let preparo: { readonly estado: EstadoCrm; readonly aborto: AbortController } | null = null;
  /** Login pronto, esperando a volta do navegador. */
  let pendente: { readonly estado: EstadoCrm; readonly dados: Pendente } | null = null;
  /** Identidade da conexão atual. Muda a cada login e some quando o conector sai de `conectado`. */
  let sessao: object | null = inicial.fase === "conectado" ? {} : null;
  let acesso: { readonly token: Segredo; readonly expiraEm: number } | null = null;
  let servidor: ServidorDeAutorizacao | null = null;
  let renovando: Promise<Acesso> | null = null;
  /** Uma escrita por vez na chave do refresh: renovação, login e desconexão não se atropelam. */
  let trava: Promise<unknown> = Promise.resolve();

  function emSerie<T>(tarefa: () => Promise<T>): Promise<T> {
    const proxima = trava.then(tarefa);
    trava = proxima.catch(() => {});
    return proxima;
  }

  function cliente(): Cliente | null {
    return ambiente.crmClientId === null ? null : { clientId: ambiente.crmClientId, recurso: ambiente.crmRecurso };
  }

  const motor = criarMotor<"crm", EventoCrm, EfeitoCrm>({
    id: "crm",
    inicial,
    transicionar: transicionarCrm,
    executar,
    aoMudar() {
      // Cancelar não espera a rede: o preparo em voo é cortado na hora em que o estado muda.
      if (preparo !== null && motor.estado() !== preparo.estado) {
        preparo.aborto.abort();
        preparo = null;
      }
      if (motor.estado().fase !== "conectado") {
        sessao = null;
        acesso = null;
      }
      aoMudar();
    },
    aoFalhar: () => void reconciliar(),
    gravar: (efeito, causa) => gravarConector(deps.banco, "crm", efeito.estado, causa, ambiente.agora()),
    agora: ambiente.agora,
    armar: deps.armar,
    registro,
  });

  function recusar(tentativa: EstadoCrm, motivo: MotivoDaRecusa, detalhe: TextoExterno): void {
    if (motor.estado() === tentativa) motor.despachar({ tipo: "autorizacao_recusada", motivo, detalhe });
  }

  async function iniciarAutorizacao(): Promise<void> {
    const tentativa = motor.estado();
    if (tentativa.fase !== "autorizando") return;
    const quem = cliente();
    if (quem === null) {
      recusar(tentativa, "app_nao_liberado", textoExterno("a URL do aplicativo da Secretária ainda não foi definida"));
      return;
    }
    const aborto = new AbortController();
    preparo = { estado: tentativa, aborto };
    const preparado = await prepararAutorizacao(quem, ambiente.porta, AbortSignal.any([fim.signal, aborto.signal]));
    if (motor.estado() !== tentativa) return;
    preparo = null;
    if (!preparado.ok) {
      recusar(tentativa, preparado.falha.motivo, preparado.falha.detalhe);
      return;
    }
    servidor = preparado.valor.servidor;
    pendente = { estado: tentativa, dados: preparado.valor };
  }

  async function servidorDeAutorizacao(): Promise<ServidorDeAutorizacao | null> {
    if (servidor !== null) return servidor;
    const descoberta = await descobrir(ambiente.crmRecurso, fim.signal);
    if (descoberta.ok) servidor = descoberta.valor;
    return servidor;
  }

  async function renovarAcesso(): Promise<Acesso> {
    const minha = sessao;
    const quem = cliente();
    if (minha === null) return { tipo: "ausente" };
    if (quem === null) return { tipo: "indeterminado", detalhe: textoExterno("a URL do aplicativo não está definida") };
    const refresh = await cofre.ler("crm.refresh_token");
    if (refresh === null) return { tipo: "ausente" };
    const destino = await servidorDeAutorizacao();
    if (destino === null) return { tipo: "indeterminado", detalhe: textoExterno("o CRM não respondeu à descoberta") };

    const renovacao = await renovar(destino, quem, refresh, fim.signal);
    if (renovacao.tipo !== "ok") return renovacao;
    const { tokens } = renovacao;
    // O refresh novo vai ao cofre antes de o access ser entregue: uma queda aqui não perde a conexão.
    const guardou = await emSerie(async () => {
      if (sessao !== minha) return false;
      await cofre.gravar("crm.refresh_token", tokens.refresh);
      acesso = { token: tokens.acesso, expiraEm: agoraMs() + tokens.acessoValeMs };
      return true;
    });
    return guardou ? { tipo: "ok", token: tokens.acesso } : { tipo: "ausente" };
  }

  /** Dez pedidos simultâneos esperam a mesma renovação. */
  function obterAcesso(): Promise<Acesso> {
    if (sessao === null) return Promise.resolve({ tipo: "ausente" });
    if (acesso !== null && acesso.expiraEm - FOLGA_DO_ACESSO_MS > agoraMs()) {
      return Promise.resolve({ tipo: "ok", token: acesso.token });
    }
    renovando ??= renovarAcesso()
      .catch((): Acesso => {
        registro.erro("crm.renovacao_falhou", {});
        return { tipo: "indeterminado", detalhe: textoExterno("a renovação do acesso falhou nesta máquina") };
      })
      .finally(() => {
        renovando = null;
      });
    return renovando;
  }

  /** Renova se preciso e lista as ferramentas do MCP. É a prova de que a conexão serve. */
  async function provar(conexaoExpiraEm: Instante): Promise<SondagemCrm> {
    for (const tentativa of [1, 2]) {
      const meu = await obterAcesso();
      if (meu.tipo === "ausente" || meu.tipo === "recusado") return { token: meu.tipo };
      if (meu.tipo === "indeterminado") return { token: "indeterminado", detalhe: meu.detalhe };
      const contagem = await contarFerramentas(ambiente.crmRecurso, meu.token, fim.signal);
      if (contagem.tipo === "ok") return { token: "ok", ferramentas: contagem.ferramentas, conexaoExpiraEm };
      if (contagem.tipo === "indeterminado") return { token: "indeterminado", detalhe: contagem.detalhe };
      // 401 com access em dia pelo relógio local: descarta e renova uma vez.
      if (acesso?.token === meu.token) acesso = null;
      if (tentativa === 2) return { token: "recusado" };
    }
    return { token: "recusado" };
  }

  async function sondar(geracao: number): Promise<void> {
    const estado = motor.estado();
    let resultado: SondagemCrm;
    if ((await cofre.ler("crm.refresh_token")) === null) resultado = { token: "ausente" };
    // Refresh sem linha de conexão é sobra de uma queda entre o cofre e o banco: não se usa.
    else if (estado.fase !== "conectado") resultado = { token: "recusado" };
    else resultado = await provar(estado.conexaoExpiraEm);
    if (motor.geracao() !== geracao) return;
    motor.despachar({ tipo: "sondagem", resultado });
  }

  async function executar(efeito: Exclude<EfeitoCrm, { tipo: "armar_prazo" | "gravar" }>, geracao: number): Promise<void> {
    switch (efeito.tipo) {
      case "iniciar_autorizacao":
        return iniciarAutorizacao();
      case "esquecer_pendente":
        pendente = null;
        return;
      case "sondar":
        return sondar(geracao);
      case "apagar_refresh":
        acesso = null;
        await emSerie(() => cofre.apagar("crm.refresh_token"));
        return;
    }
  }

  async function retorno(query: URLSearchParams): Promise<Resultado<EstadoCrm>> {
    const aberto = pendente;
    const state = query.get("state");
    const quem = cliente();
    if (aberto === null || quem === null || state === null || !mesmoState(state, aberto.dados.state) || motor.estado() !== aberto.estado) {
      return falha("crm_retorno_invalido", "Este retorno não pertence a um login em andamento.");
    }
    // Uso único: o mesmo `state` não abre uma segunda troca.
    pendente = null;
    const tentativa = aberto.estado;
    const cancelado = () => falha("acao_indisponivel", "O login foi cancelado antes de terminar.");

    const troca = await trocarCodigo(aberto.dados, quem, query, fim.signal);
    if (motor.estado() !== tentativa) return cancelado();
    if (!troca.ok) {
      recusar(tentativa, troca.falha.motivo, troca.falha.detalhe);
      return falha(`crm_${troca.falha.motivo}`);
    }
    const tokens = troca.valor;

    const contagem = await contarFerramentas(ambiente.crmRecurso, tokens.acesso, fim.signal);
    if (motor.estado() !== tentativa) return cancelado();
    if (contagem.tipo !== "ok") {
      const detalhe = contagem.tipo === "indeterminado" ? contagem.detalhe : textoExterno("o MCP recusou o token recém-emitido");
      recusar(tentativa, "inacessivel", detalhe);
      return falha("crm_inacessivel");
    }

    const guardar = emSerie(async () => {
      if (motor.estado() !== tentativa) return false;
      // O cofre vem antes da linha: uma queda no meio deixa refresh sem linha, que a sondagem apaga.
      await cofre.gravar("crm.refresh_token", tokens.refresh);
      if (motor.estado() !== tentativa) {
        await cofre.apagar("crm.refresh_token");
        return false;
      }
      sessao = {};
      acesso = { token: tokens.acesso, expiraEm: agoraMs() + tokens.acessoValeMs };
      motor.despachar({
        tipo: "retorno_ok",
        conexaoExpiraEm: somar(ambiente.agora(), VIDA_DA_CONEXAO_MS),
        ferramentas: contagem.ferramentas,
      });
      return true;
    });
    let conectou: boolean;
    try {
      conectou = await guardar;
    } catch {
      registro.erro("crm.refresh_nao_guardado", {});
      recusar(tentativa, "retorno_invalido", textoExterno("o cofre desta máquina não guardou a conexão"));
      return falha("interno");
    }
    if (!conectou) return cancelado();
    await motor.assentar();
    return ok(motor.estado());
  }

  function reconciliar(): Promise<void> {
    const geracao = motor.geracao();
    return motor.enfileirar(() => sondar(geracao));
  }

  async function tokenValido(): Promise<Segredo | null> {
    const meu = await obterAcesso();
    if (meu.tipo === "ok") return meu.token;
    if (meu.tipo === "recusado" && motor.estado().fase === "conectado") {
      motor.despachar({ tipo: "sondagem", resultado: { token: "recusado" } });
    }
    return null;
  }

  const sinalDoUso = (sinal: AbortSignal | undefined) => (sinal === undefined ? fim.signal : AbortSignal.any([fim.signal, sinal]));

  function acessoAoCrm(): AcessoAoCrm {
    return {
      token: tokenValido,
      origemDasTelas: async () => {
        const emissor = (await servidorDeAutorizacao())?.emissor;
        return emissor === undefined ? null : new URL(emissor).origin;
      },
      recusado(token) {
        if (acesso?.token === token) acesso = null;
      },
      vencido: () => void reconciliar(),
    };
  }

  return {
    motor,
    async agir(acao) {
      const resultado = await pedir(motor, acao, { tipo: `pedido_${acao}` });
      if (!resultado.ok) return resultado;
      const aberto = pendente !== null && pendente.estado === resultado.dados ? pendente.dados.url.href : null;
      return ok({ estado: resultado.dados, urlAutorizacao: aberto });
    },
    retorno,
    tokenValido,
    leitor: (sinal) => criarLeitor(ambiente.crmRecurso, acessoAoCrm(), sinalDoUso(sinal)),
    escritor: (sinal) => criarEscritor(ambiente.crmRecurso, acessoAoCrm(), sinalDoUso(sinal)),
    reconciliar,
    parar: () => fim.abort(),
  };
}
