import { describe, expect, test } from "bun:test";
import {
  ENDERECO_DA_ULTIMA_VERSAO,
  assinarManifesto,
  conferirVersaoPublicada,
  enderecoDoPacote,
  escreverManifesto,
  gerarParDeChaves,
  versaoMaior,
  type ChavePublica,
} from "./index";

const SHA256 = "ab".repeat(32);

function manifestoDa(versao: string, tag?: string): string {
  return escreverManifesto({
    versao,
    data: "2026-11-20",
    bunMinimo: "1.4.4",
    sha256: SHA256,
    bytes: 2_300_000,
    oQueMuda: ["O painel avisa quando tem versão nova da Secretária."],
    ...(tag === undefined ? {} : { tag }),
  });
}

async function bancada() {
  const ativa = await gerarParDeChaves();
  const reserva = await gerarParDeChaves();
  const chaves: ChavePublica[] = [
    { papel: "ativa", publica: ativa.publica },
    { papel: "reserva", publica: reserva.publica },
  ];
  return { ativa, reserva, chaves };
}

/** Troca um caractere dentro do valor de um campo do envelope, sem quebrar o JSON. */
function comCampoMexido(envelope: string, campo: "manifesto" | "assinatura" | "chave", mexer: (valor: string) => string): string {
  const objeto = JSON.parse(envelope) as Record<string, string>;
  return JSON.stringify({ ...objeto, [campo]: mexer(objeto[campo] ?? "") });
}

describe("envelope da versão", () => {
  test("o endereço da última versão é o do repo da Profills", () => {
    expect(ENDERECO_DA_ULTIMA_VERSAO).toBe("https://github.com/profillsbrasil/secretaria-profills/releases/latest/download/versao.json");
    expect(enderecoDoPacote("0.2.0")).toBe(
      "https://github.com/profillsbrasil/secretaria-profills/releases/download/v0.2.0/secretaria-0.2.0.tar.gz",
    );
  });

  test("manifesto assinado pela chave ativa confere e devolve o que foi assinado", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    const conferencia = await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves });
    expect(conferencia).toEqual({
      ok: true,
      manifesto: {
        v: 1,
        versao: "0.2.0",
        data: "2026-11-20",
        bunMinimo: "1.4.4",
        pacote: { url: enderecoDoPacote("0.2.0"), sha256: SHA256, bytes: 2_300_000 },
        oQueMuda: ["O painel avisa quando tem versão nova da Secretária."],
      },
    });
  });

  test("a chave reserva também assina", async () => {
    const { reserva, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), reserva.privada);
    expect((await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).ok).toBe(true);
  });

  test("um byte trocado no manifesto é recusado", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    const mexido = comCampoMexido(envelope, "manifesto", (texto) => texto.replace("0.2.0", "0.2.1"));
    expect(await conferirVersaoPublicada(mexido, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  test("um byte trocado no sha256 do pacote é recusado", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    const mexido = comCampoMexido(envelope, "manifesto", (texto) => texto.replace(SHA256, `ac${SHA256.slice(2)}`));
    expect(await conferirVersaoPublicada(mexido, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  test("um byte trocado na URL do pacote é recusado", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    const mexido = comCampoMexido(envelope, "manifesto", (texto) => texto.replace("profillsbrasil", "profillsbrasi1"));
    expect(await conferirVersaoPublicada(mexido, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  test("um byte trocado na assinatura é recusado", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    const mexido = comCampoMexido(envelope, "assinatura", (texto) => (texto.startsWith("A") ? "B" : "A") + texto.slice(1));
    expect(await conferirVersaoPublicada(mexido, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  test("assinatura de chave que não está no código é recusada", async () => {
    const { chaves } = await bancada();
    const intrusa = await gerarParDeChaves();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), intrusa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "chave_desconhecida" });
  });

  test("a chave intrusa não passa dizendo o id de uma chave do código", async () => {
    const { ativa, chaves } = await bancada();
    const intrusa = await gerarParDeChaves();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), intrusa.privada);
    const mexido = comCampoMexido(envelope, "chave", () => ativa.id);
    expect(await conferirVersaoPublicada(mexido, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  test("sem chave no código, nada confere", async () => {
    const { ativa } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0"), ativa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves: [] })).toMatchObject({ ok: false, motivo: "chave_desconhecida" });
  });

  test.each([
    ["outro repo", (texto: string) => texto.replace("profillsbrasil/secretaria-profills", "outro/secretaria-profills")],
    ["outro site", (texto: string) => texto.replace("https://github.com/", "https://github.com.exemplo.com.br/")],
    ["pacote de outra versão", (texto: string) => texto.replace("download/v0.2.0/", "download/v0.1.9/")],
    ["http", (texto: string) => texto.replace("https://", "http://")],
  ])("manifesto bem assinado com a URL de %s é recusado", async (_nome, trocar) => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(trocar(manifestoDa("0.2.0")), ativa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).toMatchObject({
      ok: false,
      motivo: "endereco_fora_do_canonico",
    });
  });

  test("a release de teste, bem assinada, não é instalável", async () => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa("0.2.0", "v0.2.0-teste"), ativa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).toMatchObject({
      ok: false,
      motivo: "endereco_fora_do_canonico",
    });
  });

  test.each(["0.2.0", "0.1.9", "0.10.0"])("versão %s publicada não passa por cima da 0.10.0 instalada", async (versao) => {
    const { ativa, chaves } = await bancada();
    const envelope = await assinarManifesto(manifestoDa(versao), ativa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.10.0", chaves })).toMatchObject({ ok: false, motivo: "versao_nao_e_maior" });
  });

  test("a ordem das versões é numérica", () => {
    expect(versaoMaior("0.10.0", "0.9.0")).toBe(true);
    expect(versaoMaior("1.0.0", "0.99.99")).toBe(true);
    expect(versaoMaior("0.2.1", "0.2.0")).toBe(true);
    expect(versaoMaior("0.2.0", "0.2.0")).toBe(false);
    expect(versaoMaior("0.9.0", "0.10.0")).toBe(false);
  });

  test.each([
    ["texto que não é JSON", "<html>404</html>"],
    ["JSON sem os campos", JSON.stringify({ manifesto: "{}" })],
    ["campo que não é texto", JSON.stringify({ manifesto: {}, chave: "a", assinatura: "b" })],
    ["arquivo gigante", JSON.stringify({ manifesto: "x".repeat(70_000), chave: "a", assinatura: "b" })],
  ])("envelope com %s é recusado", async (_nome, texto) => {
    const { chaves } = await bancada();
    expect(await conferirVersaoPublicada(texto, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "envelope_invalido" });
  });

  test.each([
    ["versão fora do formato", (m: Record<string, unknown>) => ({ ...m, versao: "0.2" })],
    ["formato de manifesto que esta versão não conhece", (m: Record<string, unknown>) => ({ ...m, v: 2 })],
    ["sha256 curto", (m: Record<string, unknown>) => ({ ...m, pacote: { ...(m.pacote as object), sha256: "abc" } })],
    ["tamanho zero", (m: Record<string, unknown>) => ({ ...m, pacote: { ...(m.pacote as object), bytes: 0 } })],
    ["novidades que não são lista de frases", (m: Record<string, unknown>) => ({ ...m, oQueMuda: "tudo" })],
    ["frase longa demais", (m: Record<string, unknown>) => ({ ...m, oQueMuda: ["x".repeat(141)] })],
  ])("manifesto bem assinado com %s é recusado", async (_nome, mudar) => {
    const { ativa, chaves } = await bancada();
    const manifesto = JSON.stringify(mudar(JSON.parse(manifestoDa("0.2.0")) as Record<string, unknown>));
    const envelope = await assinarManifesto(manifesto, ativa.privada);
    expect(await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves })).toMatchObject({ ok: false, motivo: "manifesto_invalido" });
  });

  test("a chave privada gerada tem 48 bytes e a pública, 32", async () => {
    const par = await gerarParDeChaves();
    expect(Buffer.from(par.privada, "base64")).toHaveLength(48);
    expect(Buffer.from(par.publica, "base64")).toHaveLength(32);
    expect(par.id).toMatch(/^[0-9a-f]{16}$/);
  });
});
