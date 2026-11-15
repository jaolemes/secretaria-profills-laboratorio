import type { ChavePublica } from "./chaves";
import { conferirVersaoPublicada } from "./envelope";
import { versaoMaior } from "./manifesto";
import { PADRAO_DE_VERSAO } from "./novidades";
import type { MotivoDaRecusa } from "./recusa";

/** Instante em ISO 8601 UTC. O módulo não importa o domínio: o atualizador roda só com o Bun e estes arquivos. */
type Instante = string;

/** A abertura do painel só busca de novo depois disto. Nenhum temporizador busca sozinho. */
export const INTERVALO_DAS_CONFERENCIAS_MS = 6 * 60 * 60 * 1000;
/** Sem resposta neste prazo, a busca vira `sem_resposta`. */
export const PRAZO_DA_BUSCA_MS = 5_000;
/** O agente pede a conferência no máximo uma vez neste intervalo. */
export const INTERVALO_DO_AGENTE_MS = 30_000;

/** A versão publicada maior que a instalada, lida de um manifesto de assinatura conferida. */
export interface VersaoPublicada {
  readonly versao: string;
  readonly data: string;
  readonly bunMinimo: string;
  readonly oQueMuda: readonly string[];
}

/** O que a última busca do `versao.json` deu. É o que fica no banco. */
export type ResultadoDaBusca =
  | { readonly tipo: "versao_nova"; readonly publicada: VersaoPublicada }
  /** Nada maior, nenhuma versão publicada, ou um arquivo que não passou na assinatura. */
  | { readonly tipo: "nada_novo" }
  /** Rede fora, prazo vencido ou erro do GitHub: a próxima abertura do painel já tenta de novo. */
  | { readonly tipo: "sem_resposta" }
  /** 403 ou 429: só tenta de novo depois das 6 horas. */
  | { readonly tipo: "recusada_pelo_github" };

export interface Conferencia {
  readonly em: Instante;
  readonly resultado: ResultadoDaBusca;
}

/** O que o servidor recebeu ao buscar o `versao.json`. */
export type RespostaDaBusca = { readonly tipo: "sem_resposta" } | { readonly tipo: "http"; readonly status: number; readonly corpo: string };

/** Por que uma resposta não virou versão nova. Vai ao registro, nunca ao vendedor. */
export type AvisoDaBusca = Exclude<MotivoDaRecusa, "versao_nao_e_maior"> | "sem_versao_publicada" | `http_${number}`;

export async function lerResposta(
  resposta: RespostaDaBusca,
  opcoes: { readonly instalada: string; readonly chaves: readonly ChavePublica[] },
): Promise<{ readonly resultado: ResultadoDaBusca; readonly aviso: AvisoDaBusca | null }> {
  if (resposta.tipo === "sem_resposta") return { resultado: { tipo: "sem_resposta" }, aviso: null };
  const { status } = resposta;
  if (status === 404) return { resultado: { tipo: "nada_novo" }, aviso: "sem_versao_publicada" };
  if (status === 403 || status === 429) return { resultado: { tipo: "recusada_pelo_github" }, aviso: `http_${status}` };
  if (status !== 200) return { resultado: { tipo: "sem_resposta" }, aviso: `http_${status}` };
  const conferida = await conferirVersaoPublicada(resposta.corpo, opcoes);
  if (!conferida.ok) {
    return { resultado: { tipo: "nada_novo" }, aviso: conferida.motivo === "versao_nao_e_maior" ? null : conferida.motivo };
  }
  const { versao, data, bunMinimo, oQueMuda } = conferida.manifesto;
  return { resultado: { tipo: "versao_nova", publicada: { versao, data, bunMinimo, oQueMuda } }, aviso: null };
}

/** A abertura do painel busca quando nunca conferiu, quando a última ficou sem resposta ou depois de 6 horas. */
export function deveBuscar(ultima: Conferencia | null, agora: Instante): boolean {
  if (ultima === null || ultima.resultado.tipo === "sem_resposta") return true;
  const passou = Date.parse(agora) - Date.parse(ultima.em);
  return passou < 0 || passou >= INTERVALO_DAS_CONFERENCIAS_MS;
}

/** Por que a versão nova não se aplica nesta máquina, mesmo com o botão um dia no painel. */
export type Impedimento = "instalacao_de_desenvolvimento" | "bun_antigo";

/** O que a última conferência diz. O estado que a API entrega junta a ele a atualização em curso (`juntarEstado`). */
export type EstadoDaDescoberta =
  | { readonly fase: "nao_conferida"; readonly instalada: string }
  | { readonly fase: "em_dia"; readonly instalada: string; readonly conferidaEm: Instante }
  | {
      readonly fase: "versao_nova";
      readonly instalada: string;
      readonly conferidaEm: Instante;
      readonly nova: VersaoPublicada;
      readonly impedimento: Impedimento | null;
    }
  | { readonly fase: "sem_internet"; readonly instalada: string; readonly tentadaEm: Instante };

export interface InstalacaoAtual {
  readonly instalada: string;
  readonly bun: string;
  /** A pasta tem `.git`: é de desenvolvimento e nunca se atualiza pelo painel. */
  readonly desenvolvimento: boolean;
}

/**
 * O estado sai da última conferência e da instalação de agora, nunca de um estado guardado: depois
 * de atualizar, a versão guardada deixa de ser maior e o estado volta a `em_dia` sem outra busca.
 */
export function estadoDaAtualizacao(ultima: Conferencia | null, instalacao: InstalacaoAtual): EstadoDaDescoberta {
  const { instalada } = instalacao;
  if (ultima === null) return { fase: "nao_conferida", instalada };
  const { em, resultado } = ultima;
  switch (resultado.tipo) {
    case "sem_resposta":
    case "recusada_pelo_github":
      return { fase: "sem_internet", instalada, tentadaEm: em };
    case "nada_novo":
      return { fase: "em_dia", instalada, conferidaEm: em };
    case "versao_nova": {
      const nova = resultado.publicada;
      if (!versaoMaior(nova.versao, instalada)) return { fase: "em_dia", instalada, conferidaEm: em };
      const impedimento = instalacao.desenvolvimento ? "instalacao_de_desenvolvimento" : versaoMaior(nova.bunMinimo, instalacao.bun) ? "bun_antigo" : null;
      return { fase: "versao_nova", instalada, conferidaEm: em, nova, impedimento };
    }
  }
}

function ehVersao(valor: unknown): valor is string {
  return typeof valor === "string" && PADRAO_DE_VERSAO.test(valor);
}

function lerPublicada(valor: unknown): VersaoPublicada | null {
  if (typeof valor !== "object" || valor === null) return null;
  const { versao, data, bunMinimo, oQueMuda } = valor as Record<string, unknown>;
  if (!ehVersao(versao) || !ehVersao(bunMinimo) || typeof data !== "string") return null;
  if (!Array.isArray(oQueMuda) || !oQueMuda.every((frase) => typeof frase === "string")) return null;
  return { versao, data, bunMinimo, oQueMuda };
}

/** A linha do banco de volta. Linha que esta versão não entende conta como nunca conferida: a próxima abertura busca. */
export function lerConferenciaGuardada(em: Instante, texto: string): Conferencia | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const { tipo, publicada } = bruto as Record<string, unknown>;
  if (tipo === "nada_novo" || tipo === "sem_resposta" || tipo === "recusada_pelo_github") return { em, resultado: { tipo } };
  if (tipo !== "versao_nova") return null;
  const lida = lerPublicada(publicada);
  return lida === null ? null : { em, resultado: { tipo, publicada: lida } };
}
