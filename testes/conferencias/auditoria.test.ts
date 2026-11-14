import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");

/** Dados do vendedor e segredos moram na pasta de dados do sistema. No índice do Git, nunca. */
const NOMES_PROIBIDOS: readonly { readonly padrao: RegExp; readonly motivo: string }[] = [
  { padrao: /\.(db|db-wal|db-shm|sqlite|sqlite3)$/i, motivo: "banco de dados" },
  { padrao: /(^|\/)\.env(\.[^/]*)?$/i, motivo: "arquivo .env" },
  { padrao: /(^|\/)(cofre|servidor|ambiente|estado)\.json$/i, motivo: "arquivo da pasta de dados" },
  { padrao: /\.(pem|key|p12|pfx)$/i, motivo: "chave ou certificado" },
  { padrao: /(^|\/)backups\//i, motivo: "backup" },
];

const CONTEUDO_PROIBIDO: readonly { readonly padrao: RegExp; readonly motivo: string }[] = [
  { padrao: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, motivo: "chave privada" },
];

function problemas(caminhos: readonly string[], ler: (caminho: string) => string | null): string[] {
  const achados: string[] = [];
  for (const caminho of caminhos) {
    for (const { padrao, motivo } of NOMES_PROIBIDOS) if (padrao.test(caminho)) achados.push(`${caminho}: ${motivo}`);
    const conteudo = ler(caminho);
    if (conteudo === null) continue;
    for (const { padrao, motivo } of CONTEUDO_PROIBIDO) if (padrao.test(conteudo)) achados.push(`${caminho}: ${motivo}`);
  }
  return achados;
}

function arquivosNoIndice(): string[] {
  const git = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO });
  if (git.exitCode !== 0) throw new Error(`git ls-files falhou: ${git.stderr.toString()}`);
  return git.stdout.toString().split("\0").filter((caminho) => caminho !== "");
}

function lerTexto(caminho: string): string | null {
  const bytes = readFileSync(join(REPO, caminho));
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

describe("auditoria do índice do Git", () => {
  test("nenhum dado do vendedor, segredo ou chave está versionado", () => {
    const caminhos = arquivosNoIndice();
    expect(caminhos.length).toBeGreaterThan(0);
    expect(problemas(caminhos, lerTexto)).toEqual([]);
  });

  test.each([
    ["secretaria.db", "banco de dados"],
    ["dados/estado.json", "arquivo da pasta de dados"],
    [".env.local", "arquivo .env"],
    ["cofre.json", "arquivo da pasta de dados"],
    ["testes/ca.pem", "chave ou certificado"],
    ["backups/antes-de-nucleo-0002.db", "backup"],
  ])("pega %s", (caminho, motivo) => {
    expect(problemas([caminho], () => null)).toContain(`${caminho}: ${motivo}`);
  });

  test("pega chave privada colada num arquivo de texto", () => {
    // Montada em partes para este arquivo, que está no índice, não acusar a si mesmo.
    const conteudo = ["x", "-----BEGIN RSA PRIVATE", "KEY-----", "abc"].join("\n").replace("PRIVATE\nKEY", "PRIVATE KEY");
    expect(problemas(["notas.md"], () => conteudo)).toEqual(["notas.md: chave privada"]);
  });

  test("deixa passar código comum", () => {
    expect(problemas(["nucleo/banco/esquema.ts", "docs/ambiente.md"], () => "export const x = 1;")).toEqual([]);
  });
});
