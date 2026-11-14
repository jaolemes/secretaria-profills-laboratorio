import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { CHAVES_DO_COFRE, CofreIndisponivel, Segredo, abrirCofre, chaveDaSenhaDoEmail, comPrazo, ehChaveDoCofre, escolherBackend, type Cofre } from "./index";

const CANARIO = "CANARIO-7f3a9c";
const pastas: string[] = [];

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-cofre-"));
  pastas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

describe("Segredo", () => {
  const segredo = Segredo.de(CANARIO);

  test.each([
    ["JSON.stringify", () => JSON.stringify({ senha: segredo, lista: [segredo] })],
    ["template string", () => `senha=${segredo}`],
    ["concatenação", () => "senha=" + segredo],
    ["String()", () => String(segredo)],
    ["Bun.inspect", () => Bun.inspect({ fundo: { segredo } })],
    ["util.inspect", () => inspect({ segredo }, { showHidden: true, depth: 5 })],
  ])("%s não mostra o valor", (_nome, serializar) => {
    const texto = serializar();
    expect(texto).not.toContain(CANARIO);
    expect(texto).toContain("[segredo]");
  });

  test("o valor não é uma propriedade enumerável nem nomeada", () => {
    expect(Object.entries(segredo)).toEqual([]);
    expect(Object.getOwnPropertyNames(segredo)).toEqual([]);
    expect({ ...segredo }).toEqual({});
  });

  test("console.log e console.error não mostram o valor", () => {
    const filho = Bun.spawnSync([
      process.execPath,
      "-e",
      `import { Segredo } from ${JSON.stringify(join(import.meta.dir, "segredo.ts"))};
       const s = Segredo.de(${JSON.stringify(CANARIO)});
       console.log(s); console.log({ s }); console.error(s); console.error("erro", { aninhado: [s] });`,
    ]);
    const saida = filho.stdout.toString() + filho.stderr.toString();
    expect(filho.exitCode).toBe(0);
    expect(saida).not.toContain(CANARIO);
    expect(saida.match(/\[segredo\]/g)?.length).toBe(4);
  });

  test("revelar devolve o valor", () => {
    expect(segredo.revelar()).toBe(CANARIO);
    expect(segredo.igual(Segredo.de(CANARIO))).toBe(true);
    expect(segredo.igual(Segredo.de("outro"))).toBe(false);
  });
});

describe("cofre em arquivo", () => {
  test("ida e volta de cada chave, sobrevivendo a reabrir", async () => {
    const dirDados = pastaTemporaria();
    const cofre = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    expect(cofre.backend).toBe("arquivo");
    for (const chave of CHAVES_DO_COFRE) await cofre.gravar(chave, Segredo.de(`${CANARIO}-${chave}`));

    const reaberto = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    for (const chave of CHAVES_DO_COFRE) expect((await reaberto.ler(chave))?.revelar()).toBe(`${CANARIO}-${chave}`);
  });

  test("cada conta de e-mail tem a própria chave, e só UUID forma chave de conta", async () => {
    const dirDados = pastaTemporaria();
    const cofre = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    await cofre.gravar(chaveDaSenhaDoEmail(a), Segredo.de(`${CANARIO}-a`));
    await cofre.gravar(chaveDaSenhaDoEmail(b), Segredo.de(`${CANARIO}-b`));
    await cofre.apagar(chaveDaSenhaDoEmail(a));
    const reaberto = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    expect(await reaberto.ler(chaveDaSenhaDoEmail(a))).toBeNull();
    expect((await reaberto.ler(chaveDaSenhaDoEmail(b)))?.revelar()).toBe(`${CANARIO}-b`);
    expect(() => chaveDaSenhaDoEmail("../crm.refresh_token")).toThrow();
    expect(ehChaveDoCofre("email.conta.x.senha")).toBe(false);
    writeFileSync(join(dirDados, "cofre.json"), JSON.stringify({ v: 1, valores: { "chave.livre": CANARIO } }));
    expect(reaberto.ler("email.senha")).rejects.toThrow();
  });

  test("gravar duas vezes e apagar duas vezes convergem", async () => {
    const dirDados = pastaTemporaria();
    const cofre = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    await cofre.gravar("email.senha", Segredo.de(CANARIO));
    await cofre.gravar("email.senha", Segredo.de(CANARIO));
    await cofre.gravar("crm.refresh_token", Segredo.de("refresh"));
    await cofre.apagar("email.senha");
    await cofre.apagar("email.senha");
    expect(await cofre.ler("email.senha")).toBeNull();
    expect((await cofre.ler("crm.refresh_token"))?.revelar()).toBe("refresh");
    await cofre.apagar("crm.refresh_token");
    expect(existsSync(join(dirDados, "cofre.json"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("o arquivo fica com modo 0600", async () => {
    const dirDados = pastaTemporaria();
    await abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados }).gravar("email.senha", Segredo.de(CANARIO));
    expect(statSync(join(dirDados, "cofre.json")).mode & 0o777).toBe(0o600);
  });

  test("arquivo ilegível não é tratado como vazio", async () => {
    const dirDados = pastaTemporaria();
    writeFileSync(join(dirDados, "cofre.json"), "{quebrado");
    const cofre = abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados });
    expect(cofre.ler("email.senha")).rejects.toThrow();
    expect(cofre.gravar("email.senha", Segredo.de(CANARIO))).rejects.toThrow();
  });
});

describe("escolha do backend", () => {
  test("sonda que passa escolhe o chaveiro do sistema", async () => {
    expect(await escolherBackend(async () => true)).toBe("sistema");
  });

  test("sonda que falha escolhe o arquivo", async () => {
    expect(await escolherBackend(async () => false)).toBe("arquivo");
  });

  test("sonda que não responde no prazo escolhe o arquivo", async () => {
    expect(await escolherBackend(() => new Promise(() => {}), 50)).toBe("arquivo");
  });

  test("o backend do sistema usa um serviço por instalação", () => {
    expect(abrirCofre({ backend: "sistema", idInstalacao: "inst-1", dirDados: "/nao/usado" }).backend).toBe("sistema");
  });
});

describe("cofre com prazo", () => {
  const mudo: Cofre = { backend: "sistema", ler: () => new Promise(() => {}), gravar: () => new Promise(() => {}), apagar: () => new Promise(() => {}) };

  test("chamada que não responde vira CofreIndisponivel no prazo", async () => {
    const cofre = comPrazo(mudo, 50);
    expect(cofre.backend).toBe("sistema");
    for (const chamada of [cofre.ler("email.senha"), cofre.gravar("email.senha", Segredo.de(CANARIO)), cofre.apagar("email.senha")]) {
      expect(await chamada.catch((erro: unknown) => erro)).toBeInstanceOf(CofreIndisponivel);
    }
  });

  test("erro do backend vira CofreIndisponivel sem levar a mensagem de fora", async () => {
    const quebrado: Cofre = { ...mudo, ler: () => Promise.reject(new Error(`falhou com ${CANARIO}`)) };
    const erro = (await comPrazo(quebrado, 50).ler("email.senha").catch((e: unknown) => e)) as Error;
    expect(erro).toBeInstanceOf(CofreIndisponivel);
    expect(erro.message).not.toContain(CANARIO);
  });

  test("cofre que responde passa direto", async () => {
    const dirDados = pastaTemporaria();
    const cofre = comPrazo(abrirCofre({ backend: "arquivo", idInstalacao: "inst-1", dirDados }), 1_000);
    await cofre.gravar("email.senha", Segredo.de(CANARIO));
    expect((await cofre.ler("email.senha"))?.igual(Segredo.de(CANARIO))).toBe(true);
  });
});
