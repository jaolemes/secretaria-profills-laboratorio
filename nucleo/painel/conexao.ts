import type { AndamentoDaSincronizacao } from "../conectores";
import { CONECTORES_UNICOS, FONTES_DA_SINCRONIZACAO, type EstadoPainel } from "../dominio";
import { SINCRONIZACAO_PARADA, reduzirSincronizacao, type EstadoDaSincronizacao } from "./meu-dia";

/**
 * O que o painel sabe do servidor: o último snapshot e se o canal está vivo.
 * O snapshot só muda inteiro, por evento do SSE. O painel não edita nada dele.
 */
export interface Conexao {
  readonly estado: EstadoPainel | null;
  readonly canal: "conectando" | "aberto" | "sem_conexao";
  /** Quantos `event: tarefas` chegaram. O evento não leva a lista: quem mostra tarefas recarrega quando o número muda. */
  readonly mudancasDeTarefas: number;
  /**
   * A rodada de sincronização que o SSE mostra, pedida aqui ou pelo agente. Cada evento passa pelo
   * redutor: o React junta eventos que chegam juntos, e só o último chegaria a quem lê uma prop.
   */
  readonly sincronizacao: EstadoDaSincronizacao;
  /** Quantas rodadas terminaram. Quem mostra o CRM recarrega quando o número muda. */
  readonly rodadasTerminadas: number;
}

export type EventoDaConexao =
  | { readonly tipo: "aberto" }
  | { readonly tipo: "estado"; readonly estado: EstadoPainel }
  | { readonly tipo: "tarefas" }
  | { readonly tipo: "sincronizacao"; readonly andamento: AndamentoDaSincronizacao }
  | { readonly tipo: "caiu" };

export const CONEXAO_INICIAL: Conexao = { estado: null, canal: "conectando", mudancasDeTarefas: 0, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0 };

export function reduzirConexao(atual: Conexao, evento: EventoDaConexao): Conexao {
  switch (evento.tipo) {
    case "aberto":
      return { ...atual, canal: "aberto" };
    case "estado":
      return { ...atual, estado: evento.estado, canal: "aberto" };
    case "tarefas":
      return { ...atual, mudancasDeTarefas: atual.mudancasDeTarefas + 1 };
    case "sincronizacao":
      return {
        ...atual,
        sincronizacao: reduzirSincronizacao(atual.sincronizacao, evento.andamento),
        rodadasTerminadas: atual.rodadasTerminadas + (evento.andamento.etapa === "terminou" ? 1 : 0),
      };
    case "caiu":
      // Com o canal caído, o fim da rodada pode se perder: o botão não fica preso esperando por ele.
      return { ...atual, canal: "sem_conexao", sincronizacao: SINCRONIZACAO_PARADA };
  }
}

const ETAPAS_DA_FONTE: readonly string[] = ["lendo", "leu", "falhou", "pulada"];

/** Borda do SSE da sincronização: forma errada vira `null` e é ignorada. */
export function lerAndamento(texto: string): AndamentoDaSincronizacao | null {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== "object" || valor === null) return null;
  const { id, etapa, fonte, situacao } = valor as { id?: unknown; etapa?: unknown; fonte?: unknown; situacao?: unknown };
  if (typeof id !== "string") return null;
  if (etapa === "comecou") return { id, etapa, fontes: FONTES_DA_SINCRONIZACAO };
  if (etapa === "terminou") return { id, etapa };
  const daFonte = FONTES_DA_SINCRONIZACAO.find((nome) => nome === fonte);
  if (etapa !== "fonte" || daFonte === undefined || typeof situacao !== "string" || !ETAPAS_DA_FONTE.includes(situacao)) return null;
  return { id, etapa, fonte: daFonte, situacao: situacao as "lendo" | "leu" | "falhou" | "pulada" };
}

/** Botões só valem com o canal aberto: com ele caído, o snapshot mostrado pode estar velho. */
export function podeAgir(conexao: Conexao): boolean {
  return conexao.canal === "aberto" && conexao.estado !== null;
}

/** Borda do SSE: texto que não tem a forma de `EstadoPainel` vira `null` e é ignorado. */
export function lerEstadoPainel(texto: string): EstadoPainel | null {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== "object" || valor === null) return null;
  const { conectores, email, onboardingCompleto } = valor as { conectores?: unknown; email?: { pulado?: unknown; contas?: unknown }; onboardingCompleto?: unknown };
  if (typeof onboardingCompleto !== "boolean" || typeof conectores !== "object" || conectores === null) return null;
  if (typeof email?.pulado !== "boolean" || !Array.isArray(email.contas)) return null;
  const formaCerta = CONECTORES_UNICOS.every((id) => {
    const visao = (conectores as Record<string, { estado?: { fase?: unknown }; acoes?: unknown } | undefined>)[id];
    return typeof visao?.estado?.fase === "string" && Array.isArray(visao.acoes);
  });
  return formaCerta ? (valor as EstadoPainel) : null;
}

/** Espera antes de abrir o SSE de novo quando o navegador desistiu sozinho. Sobe até 10 s. */
export function esperaParaReconectar(tentativa: number): number {
  return Math.min(1000 * 2 ** tentativa, 10_000);
}

/**
 * O que, no estado dos conectores, muda o que o Meu dia diz: o motivo de um bloco sem leitura depende
 * da fase do WhatsApp e do CRM. Muda de texto quando um deles muda, para a tela recarregar na hora.
 */
export function chaveDosConectores(estado: EstadoPainel | null): string {
  if (estado === null) return "";
  const { whatsapp, crm } = estado.conectores;
  return [whatsapp.estado, crm.estado].map((visto) => (visto.fase === "atencao" ? `atencao:${visto.problema.codigo}` : visto.fase)).join("|");
}
