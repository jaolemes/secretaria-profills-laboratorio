/**
 * Monta o instalador que vai embutido no `instalar.sh` e no `instalar.ps1`: `instalacao.ts` e o
 * que ele usa deste módulo, num arquivo só, com as chaves públicas e o esqueleto de `meu/` de
 * agora. O script não baixa código para conferir a assinatura: quem confere é o que veio nele.
 *
 *   bun nucleo/atualizacao/script.ts   regrava o bloco dos dois scripts na raiz do repo
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChavePublica } from "./chaves";

export type TipoDeScript = "sh" | "ps1";

export const ARQUIVO_DO_SCRIPT: Record<TipoDeScript, string> = { sh: "instalar.sh", ps1: "instalar.ps1" };

/** As linhas que abrem e fecham o bloco. No PowerShell, `'@` no começo de uma linha fecharia a here-string. */
const MARCAS: Record<TipoDeScript, { readonly abre: string; readonly fecha: string }> = {
  sh: { abre: `cat > "$instalador" <<'FIM_DO_INSTALADOR'`, fecha: "FIM_DO_INSTALADOR" },
  ps1: { abre: "$Instalador = @'", fecha: "'@" },
};

/** O que o pacote não traz e a instalação nova cria em `meu/`. A conferência cobra que seja o `meu/` versionado. */
export const ESQUELETO_DE_MEU = ["AGENTS.md", "README.md", "migracoes/.gitkeep", "skills/.gitkeep"] as const;

/** Só o teste passa: a release falsa e a chave gerada nele, no lugar do endereço e das chaves do código. */
export interface FonteDeTeste {
  readonly origem: string;
  readonly chaves: readonly ChavePublica[];
}

function importe(raiz: string, arquivo: string): string {
  return JSON.stringify(path.join(raiz, "nucleo", "atualizacao", arquivo).split(path.sep).join("/"));
}

function entrada(raiz: string, teste: FonteDeTeste | undefined): string {
  const meuInicial = Object.fromEntries(ESQUELETO_DE_MEU.map((caminho) => [caminho, readFileSync(path.join(raiz, "meu", ...caminho.split("/")), "utf8")]));
  const linhas = [`import { principal } from ${importe(raiz, "instalacao.ts")};`];
  if (teste === undefined) {
    linhas.push(`import { FONTE_DAS_VERSOES } from ${importe(raiz, "fonte.ts")};`, "const fonte = FONTE_DAS_VERSOES;");
  } else {
    linhas.push(
      `import { ORIGEM_DAS_VERSOES } from ${importe(raiz, "manifesto.ts")};`,
      `const origem = ${JSON.stringify(teste.origem)};`,
      "const fonte = {",
      "  endereco: new URL(`${origem}/releases/latest/download/versao.json`),",
      `  chaves: ${JSON.stringify(teste.chaves)},`,
      "  prazoMs: 5000,",
      "  pacote: (url: string) => new URL(url.startsWith(ORIGEM_DAS_VERSOES) ? `${origem}/releases/${url.slice(ORIGEM_DAS_VERSOES.length)}` : url),",
      "};",
    );
  }
  linhas.push(`process.exit(await principal(process.argv.slice(2), { fonte, meuInicial: ${JSON.stringify(meuInicial)} }));`, "");
  return linhas.join("\n");
}

/** O instalador num arquivo só. O mesmo repo e o mesmo Bun dão o mesmo texto, só com ASCII. */
export async function montarInstalador(raiz: string, teste?: FonteDeTeste): Promise<string> {
  const saida = await Bun.build({
    entrypoints: ["instalador-do-script"],
    target: "bun",
    root: raiz,
    plugins: [
      {
        name: "instalador-do-script",
        setup(build) {
          build.onResolve({ filter: /^instalador-do-script$/ }, () => ({ path: "instalador-do-script", namespace: "script" }));
          build.onLoad({ filter: /.*/, namespace: "script" }, () => ({ contents: entrada(raiz, teste), loader: "ts" }));
        },
      },
    ],
  });
  const [arquivo] = saida.outputs;
  if (!saida.success || arquivo === undefined) throw new Error(`o instalador não montou: ${saida.logs.map(String).join("\n")}`);
  // Os comentários de caminho trazem a barra do sistema que montou; a do Windows mudaria o texto.
  const texto = (await arquivo.text())
    .split("\n")
    .map((linha) => (linha.startsWith("// ") ? linha.replaceAll("\\", "/") : linha))
    .join("\n")
    .trimEnd();
  if (/[^\x00-\x7f]/.test(texto)) throw new Error("o instalador montado tem caractere fora do ASCII");
  return texto;
}

function partes(script: string, tipo: TipoDeScript): { readonly antes: string[]; readonly bloco: string[]; readonly depois: string[] } {
  const linhas = script.replaceAll("\r\n", "\n").split("\n");
  const { abre, fecha } = MARCAS[tipo];
  const inicio = linhas.indexOf(abre);
  const fim = inicio === -1 ? -1 : linhas.indexOf(fecha, inicio + 1);
  if (inicio === -1 || fim === -1) throw new Error(`o ${ARQUIVO_DO_SCRIPT[tipo]} não tem o bloco do instalador entre ${abre} e ${fecha}`);
  return { antes: linhas.slice(0, inicio + 1), bloco: linhas.slice(inicio + 1, fim), depois: linhas.slice(fim) };
}

/** O instalador que está embutido no script. */
export function instaladorEmbutido(script: string, tipo: TipoDeScript): string {
  return partes(script, tipo).bloco.join("\n");
}

/** O script com `instalador` no lugar do bloco de agora. */
export function embutir(script: string, tipo: TipoDeScript, instalador: string): string {
  const { fecha } = MARCAS[tipo];
  const linhas = instalador.split("\n");
  if (linhas.some((linha) => linha === fecha || (tipo === "ps1" && linha.startsWith(fecha)))) {
    throw new Error(`o instalador tem uma linha que fecharia o bloco do ${ARQUIVO_DO_SCRIPT[tipo]}`);
  }
  const { antes, depois } = partes(script, tipo);
  return [...antes, ...linhas, ...depois].join("\n");
}

/** Os dois scripts do repo com o instalador de agora, ou com o da release falsa. */
export async function scriptsComOInstalador(raiz: string, teste?: FonteDeTeste): Promise<Record<TipoDeScript, string>> {
  const instalador = await montarInstalador(raiz, teste);
  const ler = (tipo: TipoDeScript) => readFileSync(path.join(raiz, ARQUIVO_DO_SCRIPT[tipo]), "utf8");
  return { sh: embutir(ler("sh"), "sh", instalador), ps1: embutir(ler("ps1"), "ps1", instalador) };
}

if (import.meta.main) {
  const raiz = path.join(import.meta.dir, "..", "..");
  const scripts = await scriptsComOInstalador(raiz);
  for (const tipo of ["sh", "ps1"] as const) writeFileSync(path.join(raiz, ARQUIVO_DO_SCRIPT[tipo]), scripts[tipo]);
  console.log(`regravou ${ARQUIVO_DO_SCRIPT.sh} e ${ARQUIVO_DO_SCRIPT.ps1}`);
}
