/**
 * O endereço da última versão, falso: serve o `versao.json` que o teste mandar, assinado por uma
 * chave gerada aqui, na hora, e o pacote da versão. Nenhuma chave privada fica no repo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assinarManifesto, escreverManifesto, gerarParDeChaves, montarPacote, nomeDoPacote, type ChavePublica, type ParDeChaves } from "../../nucleo/atualizacao";
import type { FonteDasVersoes } from "../../nucleo/servidor";

const CAMINHO = "/releases/latest/download/versao.json";
const ORIGEM_CANONICA = "https://github.com/profillsbrasil/secretaria-profills/releases/";

type Resposta = { readonly tipo: "corpo"; readonly corpo: string; readonly demoraMs: number } | { readonly tipo: "status"; readonly status: number } | { readonly tipo: "pendurar" };

export interface OpcoesDaPublicacao {
  readonly bunMinimo?: string;
  readonly outraChave?: true;
  readonly demoraMs?: number;
  /** O pacote de verdade: o manifesto leva o sha256 e o tamanho dele, e o falso o serve no endereço da versão. */
  readonly pacote?: Uint8Array;
  /** Serve estes bytes no lugar do pacote que o manifesto descreve. */
  readonly pacoteAdulterado?: Uint8Array;
  /** Segura a resposta do pacote até o teste soltar. */
  readonly segurarPacote?: Promise<void>;
}

export interface ReleaseFalsa {
  readonly endereco: URL;
  /** A chave ativa que a Secretária do teste aceita. */
  readonly chaves: readonly ChavePublica[];
  /** O endereço, as chaves e o pacote no falso, como o servidor recebe por `OpcoesDoServidor.versoes`. */
  fonte(prazoMs?: number): FonteDasVersoes;
  /** Quantas vezes o `versao.json` foi pedido. */
  pedidos(): number;
  /** Quantas vezes um pacote foi pedido. */
  pedidosDoPacote(): number;
  /**
   * Publica a versão, assinada pela chave ativa ou, com `outraChave`, por uma que a Secretária não conhece.
   * `demoraMs` segura cada resposta, para dois pedidos se encontrarem no meio da busca.
   */
  publicar(versao: string, opcoes?: OpcoesDaPublicacao): Promise<void>;
  /** Responde 200 com este corpo, como veio, sem assinar. */
  servir(corpo: string): void;
  /** Responde só com este status, sem corpo. */
  responder(status: number): void;
  /** Recebe o pedido e nunca responde. */
  pendurar(): void;
  parar(): Promise<void>;
}

/** A fonte que aponta para uma release falsa em `origem`, também de dentro de outro processo. */
export function fonteDaReleaseFalsa(origem: string, chaves: readonly ChavePublica[], prazoMs: number): FonteDasVersoes {
  return {
    endereco: new URL(`${origem}${CAMINHO}`),
    chaves,
    prazoMs,
    pacote: (url) => new URL(url.startsWith(ORIGEM_CANONICA) ? `${origem}/releases/${url.slice(ORIGEM_CANONICA.length)}` : url),
  };
}

export async function subirReleaseFalsa(): Promise<ReleaseFalsa> {
  const ativa = await gerarParDeChaves();
  const outra = await gerarParDeChaves();
  let resposta: Resposta = { tipo: "status", status: 404 };
  let pacote: { readonly caminho: string; readonly bytes: Uint8Array; readonly segurar: Promise<void> | null } | null = null;
  let pedidos = 0;
  let pedidosDoPacote = 0;
  const servidor = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const caminho = new URL(req.url).pathname;
      if (pacote !== null && caminho === pacote.caminho) {
        pedidosDoPacote += 1;
        const servido = pacote;
        if (servido.segurar !== null) await servido.segurar;
        return new Response(new Blob([new Uint8Array(servido.bytes)]), { headers: { "Content-Type": "application/octet-stream" } });
      }
      if (caminho !== CAMINHO) return new Response("não existe", { status: 404 });
      pedidos += 1;
      const atual = resposta;
      if (atual.tipo === "pendurar") return new Promise<Response>(() => {});
      if (atual.tipo === "status") return new Response(null, { status: atual.status });
      if (atual.demoraMs > 0) await Bun.sleep(atual.demoraMs);
      return new Response(atual.corpo, { headers: { "Content-Type": "application/octet-stream" } });
    },
  });
  const origem = `http://127.0.0.1:${servidor.port}`;

  const assinar = (versao: string, par: ParDeChaves, bunMinimo: string, doPacote: Uint8Array | undefined) =>
    assinarManifesto(
      escreverManifesto({
        versao,
        data: "2026-11-20",
        bunMinimo,
        sha256: doPacote === undefined ? "ab".repeat(32) : new Bun.CryptoHasher("sha256").update(doPacote).digest("hex"),
        bytes: doPacote?.length ?? 2_300_000,
        oQueMuda: ["O painel avisa quando tem versão nova da Secretária."],
      }),
      par.privada,
    );

  const chaves: readonly ChavePublica[] = [{ papel: "ativa", publica: ativa.publica }];
  return {
    endereco: new URL(`${origem}${CAMINHO}`),
    chaves,
    fonte: (prazoMs = 300) => fonteDaReleaseFalsa(origem, chaves, prazoMs),
    pedidos: () => pedidos,
    pedidosDoPacote: () => pedidosDoPacote,
    async publicar(versao, opcoes = {}) {
      const corpo = await assinar(versao, opcoes.outraChave ? outra : ativa, opcoes.bunMinimo ?? "1.4.4", opcoes.pacote);
      resposta = { tipo: "corpo", corpo, demoraMs: opcoes.demoraMs ?? 0 };
      const bytes = opcoes.pacoteAdulterado ?? opcoes.pacote;
      pacote = bytes === undefined ? null : { caminho: `/releases/download/v${versao}/${nomeDoPacote(versao)}`, bytes, segurar: opcoes.segurarPacote ?? null };
    },
    servir(corpo) {
      resposta = { tipo: "corpo", corpo, demoraMs: 0 };
    },
    responder(status) {
      resposta = { tipo: "status", status };
    },
    pendurar() {
      resposta = { tipo: "pendurar" };
    },
    parar: () => servidor.stop(true),
  };
}

/** O pacote de uma versão com estes arquivos, pelo mesmo `montarPacote` que o workflow de release usa. */
export function pacoteCom(versao: string, arquivos: Readonly<Record<string, string | Uint8Array>>): Uint8Array {
  const fonte = mkdtempSync(join(tmpdir(), "secretaria-pacote-"));
  try {
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      const completo = join(fonte, ...caminho.split("/"));
      mkdirSync(dirname(completo), { recursive: true });
      writeFileSync(completo, conteudo);
    }
    return montarPacote({ raiz: fonte, caminhos: Object.keys(arquivos), versao }).pacote;
  } finally {
    rmSync(fonte, { recursive: true, force: true });
  }
}
