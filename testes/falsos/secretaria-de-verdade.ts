/**
 * O CLI de uma instalação de teste que roda o servidor de verdade deste repo: o `nucleo/cli/main.ts`
 * dela chama `principal` com a raiz e com a release falsa. Só `instalar --json` e `servidor --json`.
 * O servidor diz a versão do `package.json` da instalação, e a pasta de dados vem de `SECRETARIA_DADOS`,
 * com o `ambiente.json` que o teste gravou.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ChavePublica } from "../../nucleo/atualizacao";
import { fonteDaReleaseFalsa } from "./release";

export interface ReleaseDoTeste {
  readonly origem: string;
  readonly chaves: readonly ChavePublica[];
}

/** O `nucleo/cli/main.ts` que vai dentro do pacote da instalação de teste. */
export function cliDaInstalacao(release: ReleaseDoTeste): string {
  return [
    `import path from "node:path";`,
    `import { principal as deVerdade } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dir, "secretaria-de-verdade.ts")).href)};`,
    `export const principal = (argv: readonly string[]) => deVerdade(path.resolve(import.meta.dir, "..", ".."), argv, ${JSON.stringify(release)});`,
    `if (import.meta.main) process.exit(await principal(process.argv.slice(2)));`,
    "",
  ].join("\n");
}

function escrever(envelope: unknown): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export async function principal(raiz: string, argumentos: readonly string[], release: ReleaseDoTeste): Promise<number> {
  if (argumentos[0] === "instalar") {
    escrever({ v: 1, ok: true, dados: { pronto: true, passos: [] } });
    return 0;
  }
  if (argumentos[0] !== "servidor") {
    escrever({ v: 1, ok: false, erro: { codigo: "uso_invalido", mensagem: `a instalação de teste não tem ${argumentos[0] ?? "comando"}`, acao: "" } });
    return 2;
  }
  const [{ resolverAmbiente }, { iniciarServidor }] = await Promise.all([import("../../nucleo/ambiente"), import("../../nucleo/servidor")]);
  const dirDados = process.env.SECRETARIA_DADOS ?? "";
  const versao = (JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")) as { version: string }).version;
  const rodando = await iniciarServidor(resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dirDados }, home: dirDados }, raiz), {
    versaoDoNucleo: versao,
    versoes: fonteDaReleaseFalsa(release.origem, release.chaves, 2_000),
    sincronizacaoAutomatica: false,
  });
  escrever({ v: 1, ok: true, dados: { origem: rodando.origem, pid: process.pid } });
  await rodando.parado;
  return 0;
}
