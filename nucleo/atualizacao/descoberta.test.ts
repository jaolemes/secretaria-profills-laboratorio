import { describe, expect, test } from "bun:test";
import type { Instante } from "../dominio";
import {
  INTERVALO_DAS_CONFERENCIAS_MS,
  assinarManifesto,
  deveBuscar,
  escreverManifesto,
  estadoDaAtualizacao,
  gerarParDeChaves,
  lerConferenciaGuardada,
  lerResposta,
  type ChavePublica,
  type Conferencia,
  type VersaoPublicada,
} from "./index";

const AGORA = "2026-11-14T12:00:00.000Z" as Instante;
const INSTALACAO = { instalada: "0.1.0", bun: "1.4.4", desenvolvimento: false } as const;
const NOVA: VersaoPublicada = { versao: "0.2.0", data: "2026-11-20", bunMinimo: "1.4.4", oQueMuda: ["O painel avisa quando tem versão nova da Secretária."] };

function depois(ms: number): Instante {
  return new Date(Date.parse(AGORA) + ms).toISOString() as Instante;
}

async function assinada(versao: string, opcoes: { readonly bunMinimo?: string } = {}) {
  const par = await gerarParDeChaves();
  const chaves: ChavePublica[] = [{ papel: "ativa", publica: par.publica }];
  const manifesto = escreverManifesto({
    versao,
    data: "2026-11-20",
    bunMinimo: opcoes.bunMinimo ?? "1.4.4",
    sha256: "ab".repeat(32),
    bytes: 2_300_000,
    oQueMuda: NOVA.oQueMuda,
  });
  return { chaves, envelope: await assinarManifesto(manifesto, par.privada) };
}

describe("lerResposta: o que a busca do versao.json vira", () => {
  test("versão maior com assinatura de uma chave conhecida vira versao_nova, sem aviso", async () => {
    const { chaves, envelope } = await assinada("0.2.0");
    const lida = await lerResposta({ tipo: "http", status: 200, corpo: envelope }, { instalada: "0.1.0", chaves });
    expect(lida).toEqual({ resultado: { tipo: "versao_nova", publicada: NOVA }, aviso: null });
  });

  test.each(["0.1.0", "0.0.9"])("versão %s, igual ou menor que a instalada, vira nada_novo sem aviso", async (versao) => {
    const { chaves, envelope } = await assinada(versao);
    expect(await lerResposta({ tipo: "http", status: 200, corpo: envelope }, { instalada: "0.1.0", chaves })).toEqual({ resultado: { tipo: "nada_novo" }, aviso: null });
  });

  test("assinatura de outra chave vira nada_novo, com o motivo no aviso", async () => {
    const { envelope } = await assinada("0.2.0");
    const outra = await gerarParDeChaves();
    const lida = await lerResposta({ tipo: "http", status: 200, corpo: envelope }, { instalada: "0.1.0", chaves: [{ papel: "ativa", publica: outra.publica }] });
    expect(lida).toEqual({ resultado: { tipo: "nada_novo" }, aviso: "chave_desconhecida" });
  });

  test("manifesto mexido depois de assinado vira nada_novo, com assinatura_invalida", async () => {
    const { chaves, envelope } = await assinada("0.2.0");
    const objeto = JSON.parse(envelope) as Record<string, string>;
    const mexido = JSON.stringify({ ...objeto, manifesto: (objeto.manifesto ?? "").replace("0.2.0", "0.3.0") });
    expect(await lerResposta({ tipo: "http", status: 200, corpo: mexido }, { instalada: "0.1.0", chaves })).toEqual({ resultado: { tipo: "nada_novo" }, aviso: "assinatura_invalida" });
  });

  test("sem chave cadastrada, toda versão vira nada_novo com chave_desconhecida", async () => {
    const { envelope } = await assinada("0.2.0");
    expect(await lerResposta({ tipo: "http", status: 200, corpo: envelope }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "nada_novo" }, aviso: "chave_desconhecida" });
  });

  test("corpo que não é envelope vira nada_novo com envelope_invalido", async () => {
    expect(await lerResposta({ tipo: "http", status: 200, corpo: "<html>" }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "nada_novo" }, aviso: "envelope_invalido" });
  });

  test("404 é repo sem versão publicada: nada_novo, com aviso próprio", async () => {
    expect(await lerResposta({ tipo: "http", status: 404, corpo: "" }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "nada_novo" }, aviso: "sem_versao_publicada" });
  });

  test.each([403, 429])("%i é o GitHub recusando por limite", async (status) => {
    expect(await lerResposta({ tipo: "http", status, corpo: "" }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "recusada_pelo_github" }, aviso: `http_${status}` });
  });

  test.each([500, 502, 410])("%i conta como sem resposta", async (status) => {
    expect(await lerResposta({ tipo: "http", status, corpo: "" }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "sem_resposta" }, aviso: `http_${status}` });
  });

  test("rede fora ou prazo vencido é sem_resposta, sem aviso", async () => {
    expect(await lerResposta({ tipo: "sem_resposta" }, { instalada: "0.1.0", chaves: [] })).toEqual({ resultado: { tipo: "sem_resposta" }, aviso: null });
  });
});

describe("deveBuscar: quando a abertura do painel busca", () => {
  test("nunca conferida: busca", () => {
    expect(deveBuscar(null, AGORA)).toBe(true);
  });

  test.each([
    ["versao_nova", { tipo: "versao_nova", publicada: NOVA }],
    ["nada_novo", { tipo: "nada_novo" }],
    ["recusada_pelo_github", { tipo: "recusada_pelo_github" }],
  ] as const)("%s: só depois de 6 horas", (_nome, resultado) => {
    const ultima: Conferencia = { em: AGORA, resultado };
    expect(deveBuscar(ultima, depois(1))).toBe(false);
    expect(deveBuscar(ultima, depois(INTERVALO_DAS_CONFERENCIAS_MS - 1))).toBe(false);
    expect(deveBuscar(ultima, depois(INTERVALO_DAS_CONFERENCIAS_MS))).toBe(true);
  });

  test("sem resposta: a próxima abertura já tenta de novo", () => {
    expect(deveBuscar({ em: AGORA, resultado: { tipo: "sem_resposta" } }, depois(1))).toBe(true);
  });

  test("relógio que voltou para antes da conferência busca de novo", () => {
    expect(deveBuscar({ em: AGORA, resultado: { tipo: "nada_novo" } }, depois(-60_000))).toBe(true);
  });
});

describe("estadoDaAtualizacao: o que a API entrega", () => {
  test("sem conferência guardada: nao_conferida", () => {
    expect(estadoDaAtualizacao(null, INSTALACAO)).toEqual({ fase: "nao_conferida", instalada: "0.1.0" });
  });

  test("nada novo: em_dia, com a hora da conferência", () => {
    expect(estadoDaAtualizacao({ em: AGORA, resultado: { tipo: "nada_novo" } }, INSTALACAO)).toEqual({ fase: "em_dia", instalada: "0.1.0", conferidaEm: AGORA });
  });

  test("versão maior numa instalação pelo pacote: versao_nova sem impedimento", () => {
    expect(estadoDaAtualizacao({ em: AGORA, resultado: { tipo: "versao_nova", publicada: NOVA } }, INSTALACAO)).toEqual({
      fase: "versao_nova",
      instalada: "0.1.0",
      conferidaEm: AGORA,
      nova: NOVA,
      impedimento: null,
    });
  });

  test("pasta com .git: versao_nova, mas a instalação é de desenvolvimento", () => {
    const estado = estadoDaAtualizacao({ em: AGORA, resultado: { tipo: "versao_nova", publicada: NOVA } }, { ...INSTALACAO, desenvolvimento: true });
    expect(estado).toMatchObject({ fase: "versao_nova", impedimento: "instalacao_de_desenvolvimento" });
  });

  test("versão que pede Bun mais novo: versao_nova com bun_antigo", () => {
    const publicada = { ...NOVA, bunMinimo: "1.5.0" };
    expect(estadoDaAtualizacao({ em: AGORA, resultado: { tipo: "versao_nova", publicada } }, INSTALACAO)).toMatchObject({ fase: "versao_nova", impedimento: "bun_antigo" });
  });

  test("a versão guardada já instalada depois de atualizar: em_dia", () => {
    expect(estadoDaAtualizacao({ em: AGORA, resultado: { tipo: "versao_nova", publicada: NOVA } }, { ...INSTALACAO, instalada: "0.2.0" })).toEqual({
      fase: "em_dia",
      instalada: "0.2.0",
      conferidaEm: AGORA,
    });
  });

  test.each([["sem_resposta"], ["recusada_pelo_github"]] as const)("%s: sem_internet, com a hora da tentativa", (tipo) => {
    expect(estadoDaAtualizacao({ em: AGORA, resultado: { tipo } }, INSTALACAO)).toEqual({ fase: "sem_internet", instalada: "0.1.0", tentadaEm: AGORA });
  });
});

describe("lerConferenciaGuardada: a linha do banco volta como conferência", () => {
  test("ida e volta pelo JSON", () => {
    const conferencia: Conferencia = { em: AGORA, resultado: { tipo: "versao_nova", publicada: NOVA } };
    expect(lerConferenciaGuardada(AGORA, JSON.stringify(conferencia.resultado))).toEqual(conferencia);
  });

  test.each(['{"tipo":"outro"}', "não é json", '{"tipo":"versao_nova","publicada":{"versao":1}}', "null"])("%s guardado vira nunca conferida", (texto) => {
    expect(lerConferenciaGuardada(AGORA, texto)).toBeNull();
  });
});
