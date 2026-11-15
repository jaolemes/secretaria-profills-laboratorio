import { CHAVES_PUBLICAS, type ChavePublica } from "./chaves";
import { PRAZO_DA_BUSCA_MS, type RespostaDaBusca } from "./descoberta";
import { TETO_DO_ENVELOPE_BYTES } from "./envelope";
import { ENDERECO_DA_ULTIMA_VERSAO } from "./manifesto";

/** Onde a Secretária confere a última versão e quais chaves aceita. Fora do teste, é sempre o que está no código. */
export interface FonteDasVersoes {
  readonly endereco: URL;
  readonly chaves: readonly ChavePublica[];
  readonly prazoMs: number;
  /** De onde baixar o pacote cuja URL canônica o manifesto assinado traz. Fora do teste, a própria URL. */
  pacote(url: string): URL;
}

export const FONTE_DAS_VERSOES: FonteDasVersoes = {
  endereco: new URL(ENDERECO_DA_ULTIMA_VERSAO),
  chaves: CHAVES_PUBLICAS,
  prazoMs: PRAZO_DA_BUSCA_MS,
  pacote: (url) => new URL(url),
};

/** O pacote passa de 2 MB; numa conexão ruim, minutos. */
export const PRAZO_DO_PACOTE_MS = 10 * 60_000;

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
export async function buscarVersao(fonte: FonteDasVersoes): Promise<RespostaDaBusca> {
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

/** Lê o pacote até o tamanho que o manifesto diz, mais um byte: o que passa disso já não confere. */
export async function baixarPacote(endereco: URL, bytes: number): Promise<Uint8Array | null> {
  try {
    // O redirecionamento segue para qualquer host de propósito: o GitHub já trocou o host dos arquivos, e o que vale é a assinatura e o sha256.
    const resposta = await fetch(endereco, { signal: AbortSignal.timeout(PRAZO_DO_PACOTE_MS) });
    if (resposta.status !== 200 || resposta.body === null) {
      await resposta.body?.cancel();
      return null;
    }
    const partes: Uint8Array[] = [];
    let total = 0;
    for await (const parte of resposta.body) {
      partes.push(parte);
      total += parte.length;
      if (total > bytes) break;
    }
    return new Uint8Array(Buffer.concat(partes));
  } catch {
    return null;
  }
}
