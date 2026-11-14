import { textoExterno, type Instante } from "../dominio";
import type { CartaoVisto, ResumoDaEscrita } from "../escritas";

/** Só para os testes do painel: cartões da fila com canários, sem dado de cliente real. */
export const HASH = "26801a7a".repeat(8);
export const CRIADA = "2026-11-14T12:12:00.000Z" as Instante;
/** Meio-dia de Brasília do mesmo dia: "hoje às 9h12" vale a partir daqui. */
export const AGORA = new Date("2026-11-14T15:00:00.000Z");

export const CLIENTE_CONFERIDO = { id: 9201, conferido: true, nome: textoExterno("CANARIO Cliente 9201"), cidade: textoExterno("Curitiba") } as const;

export function resumo(extra: Partial<ResumoDaEscrita> = {}): ResumoDaEscrita {
  return {
    id: "0b0e6f0e-1c1c-4c1c-9c1c-000000000001",
    tool: "registrar_atendimento",
    estado: "rascunho",
    versao: 1,
    hash: HASH,
    cliente: CLIENTE_CONFERIDO,
    confiraOCliente: false,
    confiraOTexto: false,
    erro: null,
    recibo: null,
    criadaEm: CRIADA,
    atualizadaEm: CRIADA,
    ...extra,
  };
}

/** O cartão de um atendimento sem sinal. `extra` troca qualquer campo, inclusive `dados`. */
export function cartao(extra: Partial<CartaoVisto> = {}): CartaoVisto {
  return {
    ...resumo(),
    hash: HASH,
    dados: { cliente_id: 9201, assunto: "CANARIO assunto do atendimento", status: "Concluído", descricao: "CANARIO primeira linha\nCANARIO segunda linha" },
    sinais: {},
    compromisso: null,
    decisoes: [],
    ...extra,
  } as CartaoVisto;
}

export function compromisso(dados: Record<string, unknown>, extra: Partial<CartaoVisto> = {}): CartaoVisto {
  const { inicio, fim } = dados as { inicio: string; fim?: string };
  const minutos = (texto: string) => Date.parse(`${texto.replace(" ", "T")}:00Z`) / 60_000;
  return cartao({
    tool: "criar_compromisso",
    dados,
    compromisso: fim === undefined ? { inicio, fim: null, duracaoMin: 60, fimAssumido: true } : { inicio, fim, duracaoMin: minutos(fim) - minutos(inicio), fimAssumido: false },
    ...extra,
  });
}
