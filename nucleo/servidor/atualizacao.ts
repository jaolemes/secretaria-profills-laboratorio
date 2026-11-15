import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CHAVES_PUBLICAS,
  ENDERECO_DA_ULTIMA_VERSAO,
  INTERVALO_DO_AGENTE_MS,
  PRAZO_DA_BUSCA_MS,
  TETO_DO_ENVELOPE_BYTES,
  deveBuscar,
  estadoDaAtualizacao,
  lerConferenciaGuardada,
  lerResposta,
  type ChavePublica,
  type Conferencia,
  type EstadoDaAtualizacao,
  type Impedimento,
  type RespostaDaBusca,
} from "../atualizacao";
import { gravarConferenciaDeVersao, lerConferenciaDeVersao, type BancoAberto } from "../banco";
import { detalheComoDado, falha, ok, textoExterno, type Instante, type Resultado } from "../dominio";
import type { Registro } from "../registro";
import type { Chamador } from "./guarda";
import { respostaJson, type Rota } from "./rotas";

/** Onde a Secretária confere a última versão e quais chaves aceita. Fora do teste, é sempre o que está no código. */
export interface FonteDasVersoes {
  readonly endereco: URL;
  readonly chaves: readonly ChavePublica[];
  readonly prazoMs: number;
}

export const FONTE_DAS_VERSOES: FonteDasVersoes = { endereco: new URL(ENDERECO_DA_ULTIMA_VERSAO), chaves: CHAVES_PUBLICAS, prazoMs: PRAZO_DA_BUSCA_MS };

export interface Descoberta {
  /** O estado da última conferência, sem buscar. */
  estado(): EstadoDaAtualizacao;
  /** O painel abriu: busca só quando `deveBuscar` manda. */
  aoAbrirOPainel(): Promise<EstadoDaAtualizacao>;
  /** Busca agora. Dois pedidos ao mesmo tempo dividem a mesma busca. */
  conferir(): Promise<EstadoDaAtualizacao>;
  /** Segundos que o agente ainda espera para pedir outra conferência; 0 quando pode. */
  esperaDoAgenteS(): number;
}

/** O que o `diagnostico` mostra da atualização: sem o O que muda, que é texto de fora. */
export interface AtualizacaoNoDiagnostico {
  readonly fase: EstadoDaAtualizacao["fase"];
  readonly versaoNova: string | null;
  readonly impedimento: Impedimento | null;
  readonly ultimaConferencia: string | null;
}

async function lerComTeto(corpo: ReadableStream<Uint8Array>): Promise<string> {
  const partes: Uint8Array[] = [];
  let total = 0;
  for await (const parte of corpo) {
    partes.push(parte);
    total += parte.length;
    // Passou do teto: o envelope já é recusado pelo tamanho, e o resto nem é lido.
    if (total > TETO_DO_ENVELOPE_BYTES) break;
  }
  return new TextDecoder().decode(Buffer.concat(partes));
}

/** Sem internet não é erro: vira `sem_resposta`. O prazo cobre a resposta inteira, corpo incluído. */
async function buscarVersao(fonte: FonteDasVersoes): Promise<RespostaDaBusca> {
  try {
    const resposta = await fetch(fonte.endereco, { signal: AbortSignal.timeout(fonte.prazoMs) });
    if (resposta.status !== 200 || resposta.body === null) {
      await resposta.body?.cancel();
      return { tipo: "http", status: resposta.status, corpo: "" };
    }
    return { tipo: "http", status: 200, corpo: await lerComTeto(resposta.body) };
  } catch {
    return { tipo: "sem_resposta" };
  }
}

export function criarDescoberta(deps: {
  readonly banco: BancoAberto;
  readonly registro: Registro;
  readonly fonte: FonteDasVersoes;
  readonly instalada: string;
  readonly dirRepo: string;
  agora(): Instante;
}): Descoberta {
  const instalacao = { instalada: deps.instalada, bun: Bun.version, desenvolvimento: existsSync(join(deps.dirRepo, ".git")) };
  const ultima = (): Conferencia | null => {
    const linha = lerConferenciaDeVersao(deps.banco);
    return linha === null ? null : lerConferenciaGuardada(linha.em, linha.resultado);
  };
  const estado = () => estadoDaAtualizacao(ultima(), instalacao);

  let emCurso: Promise<EstadoDaAtualizacao> | null = null;
  const conferir = (): Promise<EstadoDaAtualizacao> => {
    emCurso ??= (async () => {
      try {
        const em = deps.agora();
        const resposta = await buscarVersao(deps.fonte);
        const { resultado, aviso } = await lerResposta(resposta, { instalada: deps.instalada, chaves: deps.fonte.chaves });
        if (aviso !== null) deps.registro.aviso("atualizacao.busca_com_aviso", { motivo: aviso });
        gravarConferenciaDeVersao(deps.banco, em, resultado);
        return estado();
      } finally {
        emCurso = null;
      }
    })();
    return emCurso;
  };

  return {
    estado,
    conferir,
    aoAbrirOPainel: () => (emCurso !== null || deveBuscar(ultima(), deps.agora()) ? conferir() : Promise.resolve(estado())),
    esperaDoAgenteS() {
      const anterior = ultima();
      if (anterior === null) return 0;
      const passou = Date.parse(deps.agora()) - Date.parse(anterior.em);
      return passou >= 0 && passou < INTERVALO_DO_AGENTE_MS ? Math.ceil((INTERVALO_DO_AGENTE_MS - passou) / 1000) : 0;
    },
  };
}

/** O O que muda chega ao agente como dado citado: veio da rede, mesmo assinado. */
function estadoPara(estado: EstadoDaAtualizacao, chamador: Chamador): EstadoDaAtualizacao {
  if (chamador !== "agente" || estado.fase !== "versao_nova") return estado;
  return { ...estado, nova: { ...estado.nova, oQueMuda: estado.nova.oQueMuda.map((frase) => detalheComoDado(textoExterno(frase))) } };
}

export function atualizacaoNoDiagnostico(estado: EstadoDaAtualizacao): AtualizacaoNoDiagnostico {
  return {
    fase: estado.fase,
    versaoNova: estado.fase === "versao_nova" ? estado.nova.versao : null,
    impedimento: estado.fase === "versao_nova" ? estado.impedimento : null,
    ultimaConferencia: estado.fase === "em_dia" || estado.fase === "versao_nova" ? estado.conferidaEm : estado.fase === "sem_internet" ? estado.tentadaEm : null,
  };
}

function cedoDemais(esperaS: number): Resultado<never> {
  const recusa = falha("conferir_cedo_demais");
  return recusa.ok ? recusa : { ok: false, erro: { ...recusa.erro, esperaS } };
}

/** Ler e conferir. Aplicar a versão ainda não existe. */
export function montarRotasDeAtualizacao(descoberta: Descoberta): readonly Rota[] {
  return [
    {
      metodo: "GET",
      caminho: "/api/atualizacao",
      quem: ["painel", "agente"],
      async tratar({ chamador }) {
        const estado = chamador === "painel" ? await descoberta.aoAbrirOPainel() : descoberta.estado();
        return respostaJson(ok(estadoPara(estado, chamador)), chamador);
      },
    },
    {
      metodo: "POST",
      caminho: "/api/atualizacao/conferir",
      quem: ["painel", "agente"],
      async tratar({ chamador }) {
        const espera = chamador === "agente" ? descoberta.esperaDoAgenteS() : 0;
        if (espera > 0) return respostaJson(cedoDemais(espera), chamador);
        return respostaJson(ok(estadoPara(await descoberta.conferir(), chamador)), chamador);
      },
    },
  ];
}
