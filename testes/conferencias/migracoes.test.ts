import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PASTA = join(import.meta.dir, "..", "..", "nucleo", "banco", "migracoes");

describe("migrações do núcleo", () => {
  // O SQLite que o Bun usa no macOS não reescreve a referência qualificada ao renomear a tabela,
  // e a migração morre com "no such column: __new_<tabela>.<coluna>".
  test("nenhum CHECK cita a tabela temporária __new_ pelo nome", () => {
    const culpadas = readdirSync(PASTA)
      .filter((nome) => nome.endsWith(".sql"))
      .filter((nome) => /"__new_[a-z_]+"\s*\./.test(readFileSync(join(PASTA, nome), "utf8")));
    expect(culpadas).toEqual([]);
  });
});
