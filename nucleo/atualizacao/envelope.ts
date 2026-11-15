import { CHAVES_PUBLICAS, type ChavePublica, type PapelDaChave } from "./chaves";
import { lerManifesto, versaoMaior, type Manifesto } from "./manifesto";
import { recusar, type Recusa } from "./recusa";

/** O `versao.json` de uma release: o manifesto como texto, quem assinou e a assinatura desses bytes. */
interface Envelope {
  readonly manifesto: string;
  readonly chave: string;
  readonly assinatura: string;
}

export const TETO_DO_ENVELOPE_BYTES = 64 * 1024;
const ALGORITMO = "Ed25519";

function deBase64(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(texto)) return null;
  const bytes = Buffer.from(texto, "base64");
  return bytes.toString("base64") === texto ? new Uint8Array(bytes) : null;
}

/** O id de uma chave sai da própria chave pública: não há como dizer um id e apresentar outra chave. */
export function idDaChave(publica: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(publica).digest("hex").slice(0, 16);
}

export interface ParDeChaves {
  /** PKCS8 em base64. É o segredo: nunca entra no repo. */
  readonly privada: string;
  /** Os 32 bytes da chave pública em base64, como vão em `CHAVES_PUBLICAS`. */
  readonly publica: string;
  readonly id: string;
}

export async function gerarParDeChaves(): Promise<ParDeChaves> {
  const par = await crypto.subtle.generateKey(ALGORITMO, true, ["sign", "verify"]);
  const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const privada = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  return { privada: Buffer.from(privada).toString("base64"), publica: Buffer.from(publica).toString("base64"), id: idDaChave(publica) };
}

/** Assina o texto do manifesto e devolve o `versao.json`. Chave que não é PKCS8 de Ed25519 lança erro. */
export async function assinarManifesto(manifesto: string, privada: string): Promise<string> {
  const pkcs8 = deBase64(privada.trim());
  if (pkcs8 === null) throw new Error("a chave de assinatura não está em base64");
  const chave = await crypto.subtle.importKey("pkcs8", pkcs8, ALGORITMO, true, ["sign"]);
  const { x } = await crypto.subtle.exportKey("jwk", chave);
  if (x === undefined) throw new Error("a chave de assinatura não traz a parte pública");
  const assinatura = await crypto.subtle.sign(ALGORITMO, chave, new TextEncoder().encode(manifesto));
  const envelope: Envelope = {
    manifesto,
    chave: idDaChave(new Uint8Array(Buffer.from(x, "base64url"))),
    assinatura: Buffer.from(assinatura).toString("base64"),
  };
  return `${JSON.stringify(envelope)}\n`;
}

function lerEnvelope(texto: string): Envelope | null {
  if (new TextEncoder().encode(texto).length > TETO_DO_ENVELOPE_BYTES) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const { manifesto, chave, assinatura } = bruto as Record<string, unknown>;
  if (typeof manifesto !== "string" || typeof chave !== "string" || typeof assinatura !== "string") return null;
  return { manifesto, chave, assinatura };
}

/** Confere a assinatura e devolve o texto assinado. O manifesto só é lido depois disso. */
export async function abrirEnvelope(
  texto: string,
  chaves: readonly ChavePublica[] = CHAVES_PUBLICAS,
): Promise<{ readonly ok: true; readonly manifesto: string; readonly papel: PapelDaChave } | Recusa> {
  const envelope = lerEnvelope(texto);
  if (envelope === null) return recusar("envelope_invalido", "o arquivo da versão não tem manifesto, chave e assinatura");
  for (const { papel, publica } of chaves) {
    const bytes = deBase64(publica);
    if (bytes === null || bytes.length !== 32 || idDaChave(bytes) !== envelope.chave) continue;
    const assinatura = deBase64(envelope.assinatura);
    if (assinatura === null || assinatura.length !== 64) return recusar("assinatura_invalida", "a assinatura não tem 64 bytes em base64");
    const chave = await crypto.subtle.importKey("raw", bytes, ALGORITMO, false, ["verify"]);
    const confere = await crypto.subtle.verify(ALGORITMO, chave, assinatura, new TextEncoder().encode(envelope.manifesto));
    if (!confere) return recusar("assinatura_invalida", "a assinatura não é desse manifesto");
    return { ok: true, manifesto: envelope.manifesto, papel };
  }
  return recusar("chave_desconhecida", "a versão foi assinada por uma chave que esta instalação não conhece");
}

/**
 * A porta de entrada de uma versão publicada: assinatura de uma chave do código, manifesto no
 * formato, pacote no endereço canônico e versão maior que a instalada. É o que o servidor chama
 * com o `versao.json` que baixou.
 */
export async function conferirVersaoPublicada(
  texto: string,
  opcoes: { readonly instalada: string; readonly chaves?: readonly ChavePublica[] },
): Promise<{ readonly ok: true; readonly manifesto: Manifesto } | Recusa> {
  const aberto = await abrirEnvelope(texto, opcoes.chaves);
  if (!aberto.ok) return aberto;
  const leitura = lerManifesto(aberto.manifesto);
  if (!leitura.ok) return leitura;
  if (!versaoMaior(leitura.manifesto.versao, opcoes.instalada)) {
    return recusar("versao_nao_e_maior", `a versão publicada é a ${leitura.manifesto.versao} e a instalada é a ${opcoes.instalada}`);
  }
  return leitura;
}
