/** O "O que muda" de uma versão, de `novidades/<versão>.md`, em palavras de vendedor. */
export interface Novidades {
  readonly versao: string;
  readonly data: string;
  readonly linhas: readonly string[];
}

export type LeituraDeNovidades = { readonly ok: true; readonly novidades: Novidades } | { readonly ok: false; readonly problemas: readonly string[] };

export const MAXIMO_DE_LINHAS = 5;
export const MAXIMO_DE_CARACTERES = 140;
export const MAXIMO_DE_BYTES = 4096;
export const PADRAO_DE_VERSAO = /^\d+\.\d+\.\d+$/;

/** O vendedor lê estas linhas no painel: nada que só programador entende. */
const PROIBIDO_NA_LINHA: readonly { readonly padrao: RegExp; readonly motivo: string }[] = [
  { padrao: /`/, motivo: "tem crase" },
  { padrao: /[a-z][a-z\d+.-]*:[^\s]|www\.|\]\(/i, motivo: "tem link" },
  { padrao: /[<>]/, motivo: "tem HTML" },
  { padrao: /\b[\w-]+\.(ts|tsx|js|md|json|sh|ps1|db|sql|yml|yaml|toml|lock|exe)\b/i, motivo: "tem nome de arquivo" },
  { padrao: /[a-z_.-]\/[a-z_.-]/i, motivo: "tem caminho de pasta" },
  { padrao: /\b(bun|bunx|git|npm|npx|wacli)\s+[a-z]/i, motivo: "tem comando" },
  { padrao: /(^|\s)--?[a-z]/i, motivo: "tem opção de comando" },
  { padrao: /#\d+|\bPRs?\s*\d+|pull request/i, motivo: "cita PR" },
];

function dataExiste(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto;
}

function problemasDaFrase(frase: string): string[] {
  const problemas: string[] = [];
  if (frase.length > MAXIMO_DE_CARACTERES) problemas.push(`passa de ${MAXIMO_DE_CARACTERES} caracteres`);
  if (!/^\p{Lu}/u.test(frase)) problemas.push("não começa com maiúscula");
  if (!/[.!?]$/.test(frase)) problemas.push("não termina com ponto");
  if (/[.!?]\s+\S/.test(frase)) problemas.push("tem mais de uma frase");
  for (const { padrao, motivo } of PROIBIDO_NA_LINHA) if (padrao.test(frase)) problemas.push(motivo);
  return problemas;
}

export function lerNovidades(texto: string): LeituraDeNovidades {
  if (new TextEncoder().encode(texto).length > MAXIMO_DE_BYTES) return { ok: false, problemas: [`o arquivo passa de ${MAXIMO_DE_BYTES} bytes`] };
  const casamento = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/.exec(texto.replace(/^﻿/, "").replaceAll("\r\n", "\n"));
  if (casamento === null) return { ok: false, problemas: ["falta o cabeçalho entre as linhas ---"] };
  const [, cabecalho = "", corpo = ""] = casamento;
  const problemas: string[] = [];

  const campos = new Map<string, string>();
  for (const linha of cabecalho.split("\n")) {
    const campo = /^(\w+):\s*(.*?)\s*$/.exec(linha);
    if (campo === null) problemas.push(`cabeçalho: linha fora do formato "campo: valor": ${linha}`);
    else campos.set(campo[1] ?? "", campo[2] ?? "");
  }
  for (const nome of campos.keys()) if (nome !== "versao" && nome !== "data") problemas.push(`cabeçalho: campo desconhecido ${nome}`);
  const versao = campos.get("versao") ?? "";
  const data = campos.get("data") ?? "";
  if (!PADRAO_DE_VERSAO.test(versao)) problemas.push("cabeçalho: versao precisa ser X.Y.Z");
  if (!dataExiste(data)) problemas.push("cabeçalho: data precisa ser um dia AAAA-MM-DD");

  const linhas: string[] = [];
  corpo
    .split("\n")
    .filter((linha) => linha.trim() !== "")
    .forEach((linha, indice) => {
      const numero = indice + 1;
      if (!linha.startsWith("- ")) {
        problemas.push(`linha ${numero}: precisa começar com "- "`);
        return;
      }
      const frase = linha.slice(2).trim();
      for (const problema of problemasDaFrase(frase)) problemas.push(`linha ${numero}: ${problema}`);
      linhas.push(frase);
    });
  if (linhas.length === 0) problemas.push("precisa de pelo menos 1 linha");
  if (linhas.length > MAXIMO_DE_LINHAS) problemas.push(`tem ${linhas.length} linhas, o máximo é ${MAXIMO_DE_LINHAS}`);

  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, novidades: { versao, data, linhas } };
}
