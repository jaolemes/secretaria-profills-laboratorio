import { MAXIMO_DE_CARACTERES, MAXIMO_DE_LINHAS, PADRAO_DE_VERSAO } from "./novidades";
import { recusar, type Recusa } from "./recusa";

/**
 * Este módulo, o envelope e o pacote usam só o Bun, sem pacote do npm: o passo que assina a
 * versão no workflow de release roda sem `bun install`, e o atualizador roda antes dele.
 */

/** O repo é público: fork, espelho ou manifesto com outra URL não levam a Secretária a baixar de outro lugar. */
const ORIGEM_DAS_VERSOES = "https://github.com/profillsbrasil/secretaria-profills/releases/";

/** Arquivo anexado à última release que não é de teste. Não é a API do GitHub e não pede conta. */
export const ENDERECO_DA_ULTIMA_VERSAO = `${ORIGEM_DAS_VERSOES}latest/download/versao.json`;

export const TETO_DO_PACOTE_BYTES = 64 * 1024 * 1024;

export function nomeDoPacote(versao: string): string {
  return `secretaria-${versao}.tar.gz`;
}

/** A tag de uma versão é `v` mais o número. Só o workflow de release passa outra tag, na release de teste. */
export function enderecoDoPacote(versao: string, tag: string = `v${versao}`): string {
  return `${ORIGEM_DAS_VERSOES}download/${tag}/${nomeDoPacote(versao)}`;
}

export interface Manifesto {
  readonly v: 1;
  readonly versao: string;
  readonly data: string;
  readonly bunMinimo: string;
  readonly pacote: { readonly url: string; readonly sha256: string; readonly bytes: number };
  readonly oQueMuda: readonly string[];
}

/** O texto que é assinado. A assinatura cobre estes bytes, então ele viaja como texto, sem ser reescrito. */
export function escreverManifesto(dados: {
  readonly versao: string;
  readonly data: string;
  readonly bunMinimo: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly oQueMuda: readonly string[];
  readonly tag?: string;
}): string {
  const manifesto: Manifesto = {
    v: 1,
    versao: dados.versao,
    data: dados.data,
    bunMinimo: dados.bunMinimo,
    pacote: { url: enderecoDoPacote(dados.versao, dados.tag), sha256: dados.sha256, bytes: dados.bytes },
    oQueMuda: dados.oQueMuda,
  };
  return JSON.stringify(manifesto);
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function ehTexto(valor: unknown, padrao: RegExp): valor is string {
  return typeof valor === "string" && padrao.test(valor);
}

/**
 * Lê o manifesto de uma versão. Campo a mais é ignorado, para o manifesto poder crescer sem
 * prender quem está numa versão antiga; mudança que quebra sobe o `v`.
 */
export function lerManifesto(texto: string, tag?: string): { readonly ok: true; readonly manifesto: Manifesto } | Recusa {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return recusar("manifesto_invalido", "o manifesto não é JSON");
  }
  if (!ehObjeto(bruto)) return recusar("manifesto_invalido", "o manifesto não é um objeto");
  const { v, versao, data, bunMinimo, pacote, oQueMuda } = bruto;
  if (v !== 1) return recusar("manifesto_invalido", "esta versão só lê o manifesto de formato 1");
  if (!ehTexto(versao, PADRAO_DE_VERSAO)) return recusar("manifesto_invalido", "versao precisa ser X.Y.Z");
  if (!ehTexto(data, /^\d{4}-\d{2}-\d{2}$/)) return recusar("manifesto_invalido", "data precisa ser AAAA-MM-DD");
  if (!ehTexto(bunMinimo, PADRAO_DE_VERSAO)) return recusar("manifesto_invalido", "bunMinimo precisa ser X.Y.Z");
  if (!ehObjeto(pacote)) return recusar("manifesto_invalido", "falta o pacote");
  const { url, sha256, bytes } = pacote;
  if (typeof url !== "string") return recusar("manifesto_invalido", "falta a URL do pacote");
  if (!ehTexto(sha256, /^[0-9a-f]{64}$/)) return recusar("manifesto_invalido", "o sha256 do pacote precisa ter 64 caracteres hexadecimais");
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > TETO_DO_PACOTE_BYTES) {
    return recusar("manifesto_invalido", `o tamanho do pacote precisa ficar entre 1 e ${TETO_DO_PACOTE_BYTES} bytes`);
  }
  if (!Array.isArray(oQueMuda) || oQueMuda.length < 1 || oQueMuda.length > MAXIMO_DE_LINHAS) {
    return recusar("manifesto_invalido", `oQueMuda precisa ter de 1 a ${MAXIMO_DE_LINHAS} frases`);
  }
  const frases: string[] = [];
  for (const frase of oQueMuda) {
    if (typeof frase !== "string" || frase.length < 1 || frase.length > MAXIMO_DE_CARACTERES) {
      return recusar("manifesto_invalido", `cada frase de oQueMuda tem de 1 a ${MAXIMO_DE_CARACTERES} caracteres`);
    }
    frases.push(frase);
  }
  if (url !== enderecoDoPacote(versao, tag)) {
    return recusar("endereco_fora_do_canonico", `a URL do pacote precisa ser ${enderecoDoPacote(versao, tag)}`);
  }
  return { ok: true, manifesto: { v, versao, data, bunMinimo, pacote: { url, sha256, bytes }, oQueMuda: frases } };
}

/** Compara duas versões X.Y.Z pela ordem numérica de cada parte. */
export function versaoMaior(candidata: string, instalada: string): boolean {
  const partes = (versao: string) => versao.split(".").map(Number);
  const a = partes(candidata);
  const b = partes(instalada);
  for (let i = 0; i < 3; i++) {
    const diferenca = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferenca !== 0) return diferenca > 0;
  }
  return false;
}
