import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirNoNavegador, programaPadrao } from "./navegador";

const URL_COM_BILHETE = "http://127.0.0.1:9/entrar?b=bilhete-canario";
const raiz = mkdtempSync(join(tmpdir(), "navegador-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("programa padrão de abrir URL", () => {
  test.each([
    ["linux", ["xdg-open"]],
    ["darwin", ["open"]],
    ["win32", ["rundll32", "url.dll,FileProtocolHandler"]],
  ] as const)("%s usa %p", (plataforma, programa) => {
    expect(programaPadrao(plataforma)).toEqual(programa);
  });
});

describe("abrir a URL com o programa do `navegador`", () => {
  test("programa que sai com 0 abriu", async () => {
    expect(await abrirNoNavegador(URL_COM_BILHETE, [process.execPath, "-e", "process.exit(0)"])).toEqual({ abriu: true });
  });

  test("programa que sai com erro não abriu, com o código de saída e sem a URL", async () => {
    expect(await abrirNoNavegador(URL_COM_BILHETE, [process.execPath, "-e", "process.exit(3)"])).toEqual({
      abriu: false,
      motivo: `o programa \`${process.execPath}\` saiu com o código 3`,
    });
  });

  test("programa ausente: diz que não existe, cita o programa e não a URL", async () => {
    const ausente = join(raiz, "nao-existe");
    expect(await abrirNoNavegador(URL_COM_BILHETE, [ausente])).toEqual({
      abriu: false,
      motivo: `o programa \`${ausente}\` não existe nesta máquina`,
    });
  });

  // No Windows não há bit de execução: o caso é de Linux e macOS.
  test.skipIf(process.platform === "win32")("programa que existe sem permissão de execução: diz que não pôde ser iniciado", async () => {
    const semPermissao = join(raiz, "sem-permissao");
    writeFileSync(semPermissao, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    expect(await abrirNoNavegador(URL_COM_BILHETE, [semPermissao])).toEqual({
      abriu: false,
      motivo: `o programa \`${semPermissao}\` existe mas não pôde ser iniciado (EACCES)`,
    });
  });
});
