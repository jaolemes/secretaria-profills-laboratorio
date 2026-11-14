import { createHash } from "node:crypto";
import { join } from "node:path";

export interface ArquivoDoPainel {
  readonly corpo: ArrayBuffer;
  readonly tipo: string;
}

const ENTRADA = join(import.meta.dir, "..", "painel", "index.html");
let construcao: Promise<ReadonlyMap<string, ArquivoDoPainel>> | null = null;

/**
 * Empacota o painel em memória uma vez por processo. Servir os arquivos daqui, e não por
 * import de HTML no `Bun.serve`, faz cada um passar pela guarda e levar os mesmos cabeçalhos.
 * A chave é o caminho da URL: `/` para a página, `/chunk-<hash>.js` para o resto.
 */
export function construirPainel(): Promise<ReadonlyMap<string, ArquivoDoPainel>> {
  construcao ??= (async () => {
    const { default: tailwind } = await import("bun-plugin-tailwind");
    const resultado = await Bun.build({
      entrypoints: [ENTRADA],
      plugins: [tailwind],
      minify: true,
      target: "browser",
      // Sem isto o React entra no build de desenvolvimento, maior e mais lento.
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    });
    if (!resultado.success) throw new AggregateError(resultado.logs, "o painel não compilou");
    const arquivos = new Map<string, ArquivoDoPainel>();
    for (const saida of resultado.outputs) {
      const nome = saida.path.replace(/^\.\//, "");
      arquivos.set(nome === "index.html" ? "/" : `/${nome}`, { corpo: await saida.arrayBuffer(), tipo: saida.type });
    }
    return arquivos;
  })();
  construcao.catch(() => {
    construcao = null;
  });
  return construcao;
}

const ESTILO =
  "body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#e7e5e4;background:#1c1917}h1{font-size:1.25rem}";

/** Hash do bloco de estilo da página simples: a CSP o libera sem abrir `style-src` para qualquer estilo inline. */
export const HASH_DO_ESTILO = `'sha256-${createHash("sha256").update(ESTILO).digest("base64")}'`;

/** Página mínima, sem script: usada fora do painel (sem sessão, retorno do CRM). */
export function paginaSimples(titulo: string, linhas: readonly string[]): string {
  const escapar = (texto: string) =>
    texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const paragrafos = linhas.map((linha) => `<p>${escapar(linha)}</p>`).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)}</title><style>${ESTILO}</style><body><h1>${escapar(titulo)}</h1>${paragrafos}</body></html>`;
}
