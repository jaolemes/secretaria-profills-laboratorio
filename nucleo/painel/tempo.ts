import type { Instante } from "../dominio";

const FUSO = "America/Sao_Paulo";

const partesDaHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaEMes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "long" });
const diaCivil = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const numeros = new Intl.NumberFormat("pt-BR");

/** "9h05", no padrão de hora do user. */
export function hora(instante: Instante): string {
  const partes = partesDaHora.formatToParts(new Date(instante));
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${Number(valor("hour"))}h${valor("minute")}`;
}

/** "9 de fevereiro". */
export function data(instante: Instante): string {
  return diaEMes.format(new Date(instante));
}

/** "hoje às 9h05" ou "9 de fevereiro às 9h05", no fuso de Brasília. */
export function momento(instante: Instante, agora: Date): string {
  const mesmoDia = diaCivil.format(new Date(instante)) === diaCivil.format(agora);
  return `${mesmoDia ? "hoje" : data(instante)} às ${hora(instante)}`;
}

/** "2 min 05 s", "45 s" ou `null` quando o prazo já passou. */
export function restante(expiraEm: Instante, agora: Date): string | null {
  const segundos = Math.ceil((Date.parse(expiraEm) - agora.getTime()) / 1000);
  if (segundos <= 0) return null;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return minutos === 0 ? `${resto} s` : `${minutos} min ${String(resto).padStart(2, "0")} s`;
}

export function numero(valor: number): string {
  return numeros.format(valor);
}
