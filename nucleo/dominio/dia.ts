import type { Instante } from "./tipos";

declare const marcaDoDia: unique symbol;

/** Dia do calendário, `AAAA-MM-DD`, sem hora nem fuso. Prazo de tarefa e nome de backup usam este tipo. */
export type Dia = string & { readonly [marcaDoDia]: "Dia" };

/** O dia do vendedor vira à meia-noite de Brasília, não à de UTC nem à da máquina. */
export const FUSO_DO_VENDEDOR = "America/Sao_Paulo";

const FORMATO = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_DO_VENDEDOR, year: "numeric", month: "2-digit", day: "2-digit" });

/** `AAAA-MM-DD` de um dia que existe no calendário. `2026-02-30` dá `null`. */
export function lerDia(texto: string): Dia | null {
  const casamento = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (casamento === null) return null;
  const [ano, mes, dia] = [Number(casamento[1]), Number(casamento[2]), Number(casamento[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia ? (texto as Dia) : null;
}

/** O dia em Brasília no instante dado. */
export function diaEm(instante: Instante | Date): Dia {
  return FORMATO.format(typeof instante === "string" ? new Date(instante) : instante) as Dia;
}

const UM_DIA_EM_MS = 86_400_000;

function diaDaSemana(dia: Dia): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/** Segunda a sexta. Feriado não entra: a Secretária não tem calendário de feriados. */
export function ehDiaUtil(dia: Dia): boolean {
  const semana = diaDaSemana(dia);
  return semana >= 1 && semana <= 5;
}

/** Quantos dias úteis há depois de `de`, até `ate` inclusive. Zero quando `ate` não vem depois de `de`. */
export function diasUteisEntre(de: Dia, ate: Dia): number {
  const inicio = Date.parse(`${de}T00:00:00Z`);
  const fim = Date.parse(`${ate}T00:00:00Z`);
  let uteis = 0;
  for (let ms = inicio + UM_DIA_EM_MS; ms <= fim; ms += UM_DIA_EM_MS) {
    if (ehDiaUtil(new Date(ms).toISOString().slice(0, 10) as Dia)) uteis += 1;
  }
  return uteis;
}

/** A segunda-feira da semana do dia. No domingo, a semana é a que acabou: a segunda é a de seis dias antes. */
export function segundaDaSemana(dia: Dia): Dia {
  const atras = (diaDaSemana(dia) + 6) % 7;
  return new Date(Date.parse(`${dia}T00:00:00Z`) - atras * UM_DIA_EM_MS).toISOString().slice(0, 10) as Dia;
}
