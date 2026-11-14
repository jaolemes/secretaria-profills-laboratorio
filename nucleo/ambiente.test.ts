import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AmbienteInvalido,
  CRM_RECURSO_PADRAO,
  PORTA_PADRAO,
  PastaDeDadosInvalida,
  caminhosDosDados,
  conferirPastaDeDados,
  pastaDeDadosPadrao,
  resolverAmbiente,
} from "./ambiente";

const REPO = resolve(import.meta.dir, "..");
const pastas: string[] = [];

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-ambiente-"));
  pastas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

describe("pasta de dados padrão", () => {
  test.each([
    ["linux", { plataforma: "linux", env: {}, home: "/home/v" }, "/home/v/.local/share/secretaria-profills"],
    ["linux com XDG", { plataforma: "linux", env: { XDG_DATA_HOME: "/dados" }, home: "/home/v" }, "/dados/secretaria-profills"],
    ["macOS", { plataforma: "darwin", env: {}, home: "/Users/v" }, "/Users/v/Library/Application Support/SecretariaProfills"],
    [
      "Windows",
      { plataforma: "win32", env: { LOCALAPPDATA: "C:\\Users\\v\\AppData\\Local" }, home: "C:\\Users\\v" },
      "C:\\Users\\v\\AppData\\Local\\SecretariaProfills",
    ],
  ] as const)("%s", (_nome, sistema, esperado) => {
    expect(pastaDeDadosPadrao(sistema)).toBe(esperado);
  });

  test("caminhos do Windows usam o binário .exe", () => {
    const caminhos = caminhosDosDados({ dirDados: "C:\\Dados", plataforma: "win32" });
    expect(caminhos.wacli).toBe("C:\\Dados\\bin\\wacli.exe");
    expect(caminhos.banco).toBe("C:\\Dados\\secretaria.db");
  });
});

describe("pasta de dados dentro do checkout", () => {
  test.each([
    ["a raiz do repo", REPO],
    ["uma subpasta do repo", join(REPO, "dados")],
    ["uma subpasta escrita com ..", join(REPO, "nucleo", "..", "meu", "dados")],
  ])("recusa %s", (_nome, pasta) => {
    expect(() => conferirPastaDeDados(pasta, REPO, process.platform)).toThrow(PastaDeDadosInvalida);
  });

  test("recusa caminho relativo", () => {
    expect(() => conferirPastaDeDados("dados", REPO, process.platform)).toThrow(PastaDeDadosInvalida);
  });

  test("recusa pasta do repo com outras maiúsculas no Windows", () => {
    expect(() => conferirPastaDeDados("C:\\Repo\\Secretaria\\Dados", "c:\\repo\\secretaria", "win32")).toThrow(
      PastaDeDadosInvalida,
    );
  });

  test.skipIf(process.platform === "win32")("recusa atalho que aponta para dentro do repo", () => {
    const fora = pastaTemporaria();
    const repo = join(fora, "repo");
    mkdirSync(join(repo, "dados"), { recursive: true });
    symlinkSync(join(repo, "dados"), join(fora, "atalho"));
    expect(() => conferirPastaDeDados(join(fora, "atalho"), repo, process.platform)).toThrow(PastaDeDadosInvalida);
  });

  test("aceita pasta vizinha com nome parecido", () => {
    expect(conferirPastaDeDados(`${REPO}-dados`, REPO, process.platform)).toBe(`${REPO}-dados`);
  });
});

describe("resolverAmbiente", () => {
  test("SECRETARIA_DADOS troca a pasta e o resto fica no padrão", () => {
    const dados = pastaTemporaria();
    const ambiente = resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dados }, home: "/nao/usado" }, REPO);
    expect(ambiente.dirDados).toBe(dados);
    expect(ambiente.porta).toBe(PORTA_PADRAO);
    expect(ambiente.wacli).toEqual([caminhosDosDados(ambiente).wacli]);
    expect(ambiente.crmRecurso.href).toBe(CRM_RECURSO_PADRAO);
    expect(ambiente.crmClientId?.href).toBe("https://www.crmprofills.com.br/oauth/apps/secretaria.json");
    expect(ambiente.caExtra).toBeNull();
  });

  test("ambiente.json troca os alvos externos", () => {
    const dados = pastaTemporaria();
    writeFileSync(join(dados, "ca.pem"), "-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----\n");
    writeFileSync(
      join(dados, "ambiente.json"),
      JSON.stringify({
        porta: 0,
        wacli: [process.execPath, "testes/falsos/wacli.ts"],
        crmRecurso: "http://127.0.0.1:4100/mcp",
        crmClientId: "http://127.0.0.1:4100/cliente-oauth.json",
        caExtra: join(dados, "ca.pem"),
      }),
    );
    const ambiente = resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dados }, home: "/nao/usado" }, REPO);
    expect(ambiente.porta).toBe(0);
    expect(ambiente.wacli).toEqual([process.execPath, "testes/falsos/wacli.ts"]);
    expect(ambiente.crmRecurso.href).toBe("http://127.0.0.1:4100/mcp");
    expect(ambiente.crmClientId?.href).toBe("http://127.0.0.1:4100/cliente-oauth.json");
    expect(ambiente.caExtra).toContain("BEGIN CERTIFICATE");
  });

  test("ambiente.json gravado com BOM, como no Notepad do Windows, é lido", () => {
    const dados = pastaTemporaria();
    writeFileSync(join(dados, "ambiente.json"), '﻿{"porta":47200}');
    const ambiente = resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dados }, home: "/nao/usado" }, REPO);
    expect(ambiente.porta).toBe(47200);
  });

  const escrever = (conteudo: string) => (arquivo: string) => writeFileSync(arquivo, conteudo);
  test.each([
    ["http fora do loopback", escrever('{"crmRecurso":"http://crm.exemplo.com/mcp"}'), "O campo `crmRecurso` do ambiente.json da pasta de dados não serve: precisa ser https, salvo em 127.0.0.1."],
    [
      "dois campos desconhecidos",
      escrever('{"desligarTls":true,"xyz":1}'),
      "O ambiente.json da pasta de dados tem os campos `desligarTls`, `xyz`, que não existem. Os campos que existem são porta, wacli, navegador, crmRecurso, crmClientId e caExtra.",
    ],
    ["JSON quebrado", escrever('{"porta":'), "O ambiente.json da pasta de dados não é um JSON válido."],
    ["porta fora da faixa", escrever('{"porta":70000}'), "O campo `porta` do ambiente.json da pasta de dados não serve."],
    ["navegador em texto", escrever('{"navegador":"firefox"}'), "O campo `navegador` do ambiente.json da pasta de dados não serve."],
    ["lista no lugar do objeto", escrever("[]"), "O ambiente.json da pasta de dados precisa ser um objeto JSON entre chaves."],
    ["pasta no lugar do arquivo", (arquivo: string) => mkdirSync(arquivo), "Não consegui ler o ambiente.json da pasta de dados."],
  ])("ambiente.json com %s é recusado com AmbienteInvalido", (_nome, preparar, mensagem) => {
    const dados = pastaTemporaria();
    preparar(join(dados, "ambiente.json"));
    let erro: unknown = null;
    try {
      resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dados }, home: "/nao/usado" }, REPO);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(AmbienteInvalido);
    expect((erro as Error).message).toBe(mensagem);
  });

  test("SECRETARIA_DADOS dentro do repo é recusada", () => {
    expect(() =>
      resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: join(REPO, "dados") }, home: "/x" }, REPO),
    ).toThrow(PastaDeDadosInvalida);
  });
});
