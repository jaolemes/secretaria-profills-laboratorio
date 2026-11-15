import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LISTA_DO_PACOTE,
  abrirEnvelope,
  assinarManifesto,
  conferirPacote,
  conferirVersaoPublicada,
  gerarParDeChaves,
  nomeDoPacote,
  type ChavePublica,
} from "./index";
import { assinarVersaoMontada, conferirVersaoMontada, gerarChave, montarVersao, prepararVersao } from "./release";

const pastas: string[] = [];

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-release-"));
  pastas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

const NOVIDADES = "---\nversao: 0.2.0\ndata: 2026-11-20\n---\n- O painel avisa quando tem versão nova da Secretária.\n";

function repoDeMentira(arquivos: Record<string, string> = {}): { raiz: string; caminhos: string[] } {
  const raiz = pastaTemporaria();
  const todos: Record<string, string> = {
    "package.json": JSON.stringify({ version: "0.2.0", engines: { bun: ">=1.4.4" } }),
    "novidades/0.2.0.md": NOVIDADES,
    "nucleo/servidor/index.ts": "export const VERSAO = 1;\n",
    "meu/AGENTS.md": "regras do vendedor\n",
    ...arquivos,
  };
  for (const [caminho, conteudo] of Object.entries(todos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  return { raiz, caminhos: Object.keys(todos) };
}

async function chavesDeTeste() {
  const par = await gerarParDeChaves();
  const chaves: ChavePublica[] = [{ papel: "ativa", publica: par.publica }];
  return { par, chaves };
}

describe("versão a publicar", () => {
  test("a tag, o package.json e as novidades dizem a mesma versão", () => {
    const { raiz } = repoDeMentira();
    expect(prepararVersao(raiz, "v0.2.0")).toEqual({
      tag: "v0.2.0",
      versao: "0.2.0",
      deTeste: false,
      data: "2026-11-20",
      bunMinimo: "1.4.4",
      oQueMuda: ["O painel avisa quando tem versão nova da Secretária."],
    });
    expect(prepararVersao(raiz, "v0.2.0-teste")).toMatchObject({ versao: "0.2.0", deTeste: true });
  });

  test.each(["0.2.0", "v0.2", "v0.2.0-beta", "v0.2.0-teste-2", "versao", ""])("recusa a tag %p", (tag) => {
    expect(() => prepararVersao(repoDeMentira().raiz, tag)).toThrow(/tag/);
  });

  test("recusa a tag de outra versão que a do package.json", () => {
    expect(() => prepararVersao(repoDeMentira().raiz, "v0.3.0")).toThrow(/package\.json/);
  });

  test("recusa a versão sem o arquivo de novidades", () => {
    const { raiz } = repoDeMentira({ "package.json": JSON.stringify({ version: "0.3.0", engines: { bun: ">=1.4.4" } }) });
    expect(() => prepararVersao(raiz, "v0.3.0")).toThrow(/novidades/);
  });

  test("recusa novidades fora da regra ou de outra versão", () => {
    expect(() => prepararVersao(repoDeMentira({ "novidades/0.2.0.md": NOVIDADES.replace("O painel", "o painel") }).raiz, "v0.2.0")).toThrow(
      /maiúscula/,
    );
    expect(() => prepararVersao(repoDeMentira({ "novidades/0.2.0.md": NOVIDADES.replace("0.2.0", "0.2.1") }).raiz, "v0.2.0")).toThrow(/novidades/);
  });

  test("recusa o package.json sem o Bun mínimo", () => {
    const { raiz } = repoDeMentira({ "package.json": JSON.stringify({ version: "0.2.0" }) });
    expect(() => prepararVersao(raiz, "v0.2.0")).toThrow(/engines/);
  });
});

describe("release de ponta a ponta", () => {
  test("montar, conferir e assinar dão um versao.json que a Secretária instalada aceita", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    const { par, chaves } = await chavesDeTeste();

    montarVersao({ raiz, tag: "v0.2.0", caminhos, dir });
    const destino = join(pastaTemporaria(), "extraido");
    conferirVersaoMontada({ tag: "v0.2.0", dir, destino });
    expect(readFileSync(join(destino, "nucleo", "servidor", "index.ts"), "utf8")).toBe("export const VERSAO = 1;\n");
    expect(existsSync(join(destino, LISTA_DO_PACOTE))).toBe(true);
    expect(existsSync(join(destino, "meu"))).toBe(false);

    await assinarVersaoMontada({ raiz, tag: "v0.2.0", caminhos, dir, privada: par.privada, chaves });
    const versao = await conferirVersaoPublicada(readFileSync(join(dir, "versao.json"), "utf8"), { instalada: "0.1.0", chaves });
    if (!versao.ok) throw new Error(versao.detalhe);
    expect(versao.manifesto).toMatchObject({ versao: "0.2.0", data: "2026-11-20", bunMinimo: "1.4.4" });
    expect(versao.manifesto.oQueMuda).toEqual(["O painel avisa quando tem versão nova da Secretária."]);
    expect(conferirPacote(readFileSync(join(dir, nomeDoPacote("0.2.0"))), versao.manifesto).ok).toBe(true);
    expect(readFileSync(join(dir, "notas.md"), "utf8")).toBe("- O painel avisa quando tem versão nova da Secretária.\n");
  });

  test("a release de teste é assinada e a Secretária instalada não a aceita", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    const { par, chaves } = await chavesDeTeste();
    montarVersao({ raiz, tag: "v0.2.0-teste", caminhos, dir });
    conferirVersaoMontada({ tag: "v0.2.0-teste", dir, destino: join(pastaTemporaria(), "extraido") });
    await assinarVersaoMontada({ raiz, tag: "v0.2.0-teste", caminhos, dir, privada: par.privada, chaves });
    const envelope = readFileSync(join(dir, "versao.json"), "utf8");
    expect((await abrirEnvelope(envelope, chaves)).ok).toBe(true);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).toMatchObject({
      ok: false,
      motivo: "endereco_fora_do_canonico",
    });
  });

  test("não assina com chave que não está no código", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    const { chaves } = await chavesDeTeste();
    const intrusa = await gerarParDeChaves();
    montarVersao({ raiz, tag: "v0.2.0", caminhos, dir });
    await expect(assinarVersaoMontada({ raiz, tag: "v0.2.0", caminhos, dir, privada: intrusa.privada, chaves })).rejects.toThrow(/chave/);
    await expect(assinarVersaoMontada({ raiz, tag: "v0.2.0", caminhos, dir, privada: intrusa.privada })).rejects.toThrow(/chave/);
    expect(existsSync(join(dir, "versao.json"))).toBe(false);
  });

  test("não assina pacote diferente do que o repo monta", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    const { par, chaves } = await chavesDeTeste();
    montarVersao({ raiz, tag: "v0.2.0", caminhos, dir });
    writeFileSync(join(raiz, "nucleo", "servidor", "index.ts"), "export const VERSAO = 2;\n");
    await expect(assinarVersaoMontada({ raiz, tag: "v0.2.0", caminhos, dir, privada: par.privada, chaves })).rejects.toThrow(/pacote/);
    expect(existsSync(join(dir, "versao.json"))).toBe(false);
  });

  test("não assina manifesto diferente do que o repo monta", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    const { par, chaves } = await chavesDeTeste();
    montarVersao({ raiz, tag: "v0.2.0", caminhos, dir });
    const manifesto = readFileSync(join(dir, "manifesto.json"), "utf8");
    writeFileSync(join(dir, "manifesto.json"), manifesto.replace("O painel avisa", "O painel grita"));
    await expect(assinarVersaoMontada({ raiz, tag: "v0.2.0", caminhos, dir, privada: par.privada, chaves })).rejects.toThrow(/manifesto/);
    expect(existsSync(join(dir, "versao.json"))).toBe(false);
  });

  test("a conferência recusa o pacote trocado depois de montado", () => {
    const { raiz, caminhos } = repoDeMentira();
    const dir = join(pastaTemporaria(), "versao");
    montarVersao({ raiz, tag: "v0.2.0", caminhos, dir });
    const pacote = readFileSync(join(dir, nomeDoPacote("0.2.0")));
    pacote[pacote.length - 5] = (pacote[pacote.length - 5] ?? 0) ^ 1;
    writeFileSync(join(dir, nomeDoPacote("0.2.0")), pacote);
    const destino = join(pastaTemporaria(), "extraido");
    expect(() => conferirVersaoMontada({ tag: "v0.2.0", dir, destino })).toThrow(/pacote_nao_confere/);
    expect(existsSync(destino)).toBe(false);
  });
});

describe("gerar a chave de assinatura", () => {
  test("grava a chave privada num arquivo só do dono e devolve a linha da pública", async () => {
    const { raiz } = repoDeMentira();
    const arquivo = join(pastaTemporaria(), "chave-ativa");
    const gerada = await gerarChave({ arquivo, raiz });
    const publica = /publica: "([A-Za-z0-9+/=]+)"/.exec(gerada.linha)?.[1] ?? "";

    const envelope = await assinarManifesto("{}", readFileSync(arquivo, "utf8"));
    expect(await abrirEnvelope(envelope, [{ papel: "ativa", publica }])).toMatchObject({ ok: true });
    expect(gerada.linha).not.toContain(readFileSync(arquivo, "utf8").trim());
    if (process.platform !== "win32") expect(statSync(arquivo).mode & 0o777).toBe(0o600);
  });

  test("não grava por cima de um arquivo nem dentro do repo", async () => {
    const { raiz } = repoDeMentira();
    const arquivo = join(pastaTemporaria(), "chave-ativa");
    writeFileSync(arquivo, "já existe");
    await expect(gerarChave({ arquivo, raiz })).rejects.toThrow();
    expect(readFileSync(arquivo, "utf8")).toBe("já existe");
    await expect(gerarChave({ arquivo: join(raiz, "chave-ativa"), raiz })).rejects.toThrow(/repo/);
    expect(existsSync(join(raiz, "chave-ativa"))).toBe(false);
  });
});
