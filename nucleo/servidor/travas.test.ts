import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGRAS_DAS_TRAVAS } from "../escritas";
import { lerTravas } from "./travas";

const pastas: string[] = [];
afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function repoCom(conteudo: string | null): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-travas-"));
  pastas.push(pasta);
  if (conteudo !== null) {
    mkdirSync(join(pasta, ".claude"));
    writeFileSync(join(pasta, ".claude", "settings.json"), conteudo);
  }
  return pasta;
}

const deny = REGRAS_DAS_TRAVAS.filter((r) => r.lista === "deny").map((r) => r.regra);
const ask = REGRAS_DAS_TRAVAS.filter((r) => r.lista === "ask").map((r) => r.regra);

describe("as travas lidas do repo", () => {
  test("arquivo completo: lido, 18 presentes e nada faltando", () => {
    const travas = lerTravas(repoCom(JSON.stringify({ permissions: { deny, ask } })));
    expect(travas).toMatchObject({ arquivo: ".claude/settings.json", lido: true, faltando: 0, codex: "nao_verificado" });
    expect(travas.regras).toHaveLength(18);
  });

  test("a cada chamada lê o arquivo de novo: uma regra tirada aparece na hora", () => {
    const repo = repoCom(JSON.stringify({ permissions: { deny, ask } }));
    expect(lerTravas(repo).faltando).toBe(0);
    writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: deny.slice(1), ask } }));
    const depois = lerTravas(repo);
    expect(depois.faltando).toBe(1);
    expect(depois.regras.filter((r) => !r.presente)).toEqual([{ lista: "deny", regra: deny[0] as string, presente: false }]);
  });

  test("arquivo ausente, JSON inválido ou sem permissions: todas ausentes, sem lançar", () => {
    const ausente = lerTravas(repoCom(null));
    expect(ausente).toMatchObject({ lido: false, faltando: 18 });
    expect(lerTravas(repoCom("{isto não é json"))).toMatchObject({ lido: false, faltando: 18 });
    expect(lerTravas(repoCom("{}"))).toMatchObject({ lido: true, faltando: 18 });
    expect(lerTravas(repoCom('{"permissions": 7}'))).toMatchObject({ lido: true, faltando: 18 });
  });
});
