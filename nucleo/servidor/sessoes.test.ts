import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirCofre, mesmoTexto, Segredo } from "../cofre";
import { NOME_DO_COOKIE, TETO_DE_SESSOES, VIDA_DA_SESSAO_MS, criarSessoes } from "./sessoes";

function cofreTemporario() {
  const dir = mkdtempSync(join(tmpdir(), "secretaria-sessoes-"));
  return { cofre: abrirCofre({ backend: "arquivo", idInstalacao: "teste", dirDados: dir }), apagar: () => rmSync(dir, { recursive: true, force: true }) };
}

async function entrar(sessoes: Awaited<ReturnType<typeof criarSessoes>>): Promise<string> {
  const definido = await sessoes.trocarBilhete(sessoes.emitirBilhete());
  if (definido === null) throw new Error("o bilhete recém-emitido foi recusado");
  return definido.split(";")[0] ?? "";
}

describe("sessões do painel", () => {
  test("a sessão vence no servidor depois da vida dela, também depois de um restart", async () => {
    const { cofre, apagar } = cofreTemporario();
    try {
      let agora = 1_000_000;
      const cookie = await entrar(await criarSessoes(cofre, () => agora));
      const depoisDoRestart = await criarSessoes(cofre, () => agora);
      expect(depoisDoRestart.valida(cookie)).toBe(true);
      agora += VIDA_DA_SESSAO_MS - 1;
      expect(depoisDoRestart.valida(cookie)).toBe(true);
      agora += 1;
      expect(depoisDoRestart.valida(cookie)).toBe(false);
    } finally {
      apagar();
    }
  });

  test("só as sessões mais novas valem: a que passa do teto deixa de valer", async () => {
    const { cofre, apagar } = cofreTemporario();
    try {
      const sessoes = await criarSessoes(cofre, () => 1_000_000);
      const cookies: string[] = [];
      for (let i = 0; i < TETO_DE_SESSOES + 2; i += 1) cookies.push(await entrar(sessoes));
      expect(cookies.map((cookie) => sessoes.valida(cookie))).toEqual([false, false, ...Array.from({ length: TETO_DE_SESSOES }, () => true)]);
    } finally {
      apagar();
    }
  });

  test("cookie com o vencimento adulterado não vale", async () => {
    const { cofre, apagar } = cofreTemporario();
    try {
      const sessoes = await criarSessoes(cofre, () => 1_000_000);
      const cookie = await entrar(sessoes);
      const [nome, valor = ""] = cookie.split("=");
      expect(nome).toBe(NOME_DO_COOKIE);
      const [, aleatorio] = valor.split(".");
      expect(sessoes.valida(`${NOME_DO_COOKIE}=${(9e15).toString(36)}.${aleatorio}`)).toBe(false);
      expect(sessoes.valida(`${NOME_DO_COOKIE}=`)).toBe(false);
      expect(sessoes.valida(null)).toBe(false);
    } finally {
      apagar();
    }
  });
});

describe("comparação de segredo", () => {
  test("Bearer e sessão comparam por valor, com tamanhos diferentes inclusive", () => {
    expect(mesmoTexto("Bearer abc", "Bearer abc")).toBe(true);
    expect(mesmoTexto("Bearer abc", "Bearer abd")).toBe(false);
    expect(mesmoTexto("Bearer abc", "Bearer abcd")).toBe(false);
    expect(mesmoTexto("", "Bearer abc")).toBe(false);
    expect(Segredo.de("x1").igual(Segredo.de("x1"))).toBe(true);
    expect(Segredo.de("x1").igual(Segredo.de("x12"))).toBe(false);
  });

  test("nenhum segredo do servidor é comparado com === ou !==", async () => {
    const fontes = await Promise.all(
      ["guarda.ts", "sessoes.ts", "../cofre/segredo.ts"].map(async (nome) => ({ nome, texto: await Bun.file(join(import.meta.dir, nome)).text() })),
    );
    const suspeitas = fontes.flatMap(({ nome, texto }) =>
      texto
        .split("\n")
        .filter((linha) => /(token|#valor|autorizacao)\S*\s*[!=]==|[!=]==\s*\S*(token|#valor|Bearer)/.test(linha) && !/===? null|!== null/.test(linha))
        .map((linha) => `${nome}: ${linha.trim()}`),
    );
    expect(suspeitas).toEqual([]);
  });
});
