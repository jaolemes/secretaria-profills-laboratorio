/**
 * O endereço da última versão, falso: serve o `versao.json` que o teste mandar, assinado por uma
 * chave gerada aqui, na hora. Nenhuma chave privada fica no repo.
 */
import { assinarManifesto, escreverManifesto, gerarParDeChaves, type ChavePublica, type ParDeChaves } from "../../nucleo/atualizacao";

const CAMINHO = "/releases/latest/download/versao.json";

type Resposta = { readonly tipo: "corpo"; readonly corpo: string } | { readonly tipo: "status"; readonly status: number } | { readonly tipo: "pendurar" };

export interface ReleaseFalsa {
  readonly endereco: URL;
  /** A chave ativa que a Secretária do teste aceita. */
  readonly chaves: readonly ChavePublica[];
  /** Quantas vezes o `versao.json` foi pedido. */
  pedidos(): number;
  /** Publica a versão, assinada pela chave ativa ou, com `outraChave`, por uma que a Secretária não conhece. */
  publicar(versao: string, opcoes?: { readonly bunMinimo?: string; readonly outraChave?: true }): Promise<void>;
  /** Responde só com este status, sem corpo. */
  responder(status: number): void;
  /** Recebe o pedido e nunca responde. */
  pendurar(): void;
  parar(): Promise<void>;
}

export async function subirReleaseFalsa(): Promise<ReleaseFalsa> {
  const ativa = await gerarParDeChaves();
  const outra = await gerarParDeChaves();
  let resposta: Resposta = { tipo: "status", status: 404 };
  let pedidos = 0;
  const servidor = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname !== CAMINHO) return new Response("não existe", { status: 404 });
      pedidos += 1;
      if (resposta.tipo === "pendurar") return new Promise<Response>(() => {});
      if (resposta.tipo === "status") return new Response(null, { status: resposta.status });
      return new Response(resposta.corpo, { headers: { "Content-Type": "application/octet-stream" } });
    },
  });

  const assinar = (versao: string, par: ParDeChaves, bunMinimo: string) =>
    assinarManifesto(
      escreverManifesto({
        versao,
        data: "2026-11-20",
        bunMinimo,
        sha256: "ab".repeat(32),
        bytes: 2_300_000,
        oQueMuda: ["O painel avisa quando tem versão nova da Secretária."],
      }),
      par.privada,
    );

  return {
    endereco: new URL(`http://127.0.0.1:${servidor.port}${CAMINHO}`),
    chaves: [{ papel: "ativa", publica: ativa.publica }],
    pedidos: () => pedidos,
    async publicar(versao, opcoes = {}) {
      resposta = { tipo: "corpo", corpo: await assinar(versao, opcoes.outraChave ? outra : ativa, opcoes.bunMinimo ?? "1.4.4") };
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
