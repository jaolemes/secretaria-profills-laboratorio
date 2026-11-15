import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PADRAO_DE_VERSAO, lerNovidades } from "../../nucleo/atualizacao";

const REPO = join(import.meta.dir, "..", "..");
const PASTA = join(REPO, "novidades");
const VERSAO: string = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;

describe("novidades de cada versão", () => {
  test("a versão do package.json é X.Y.Z e tem o arquivo de novidades", () => {
    expect(VERSAO).toMatch(PADRAO_DE_VERSAO);
    expect(existsSync(join(PASTA, `${VERSAO}.md`))).toBe(true);
  });

  test("todo arquivo de novidades segue a regra e diz a versão do próprio nome", () => {
    const nomes = existsSync(PASTA) ? readdirSync(PASTA) : [];
    const problemas = nomes.flatMap((nome) => {
      const versao = nome.replace(/\.md$/, "");
      if (!nome.endsWith(".md") || !PADRAO_DE_VERSAO.test(versao)) return [`${nome}: o nome precisa ser <X.Y.Z>.md`];
      const leitura = lerNovidades(readFileSync(join(PASTA, nome), "utf8"));
      if (!leitura.ok) return leitura.problemas.map((problema) => `${nome}: ${problema}`);
      return leitura.novidades.versao === versao ? [] : [`${nome}: o cabeçalho diz versao ${leitura.novidades.versao}`];
    });
    expect(problemas).toEqual([]);
  });
});
