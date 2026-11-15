import { describe, expect, test } from "bun:test";
import { EXPLICACAO_DA_FALHA, MOTIVOS_DA_FALHA, bloqueioDe, juntarEstado, type EstadoDaDescoberta, type VersaoPublicada } from "./index";

const NOVA: VersaoPublicada = { versao: "0.2.0", data: "2026-11-20", bunMinimo: "1.4.4", oQueMuda: ["O painel avisa quando tem versão nova da Secretária."] };
const CONFERIDA = "2026-11-14T12:00:00.000Z";
const EM = "2026-11-14T12:05:00.000Z";
const VERSAO_NOVA: EstadoDaDescoberta = { fase: "versao_nova", instalada: "0.1.0", conferidaEm: CONFERIDA, nova: NOVA, impedimento: null };
const EM_DIA: EstadoDaDescoberta = { fase: "em_dia", instalada: "0.2.0", conferidaEm: CONFERIDA };

describe("bloqueioDe: o que segura o botão", () => {
  test("nada ocupado nem impedido: sem bloqueio", () => {
    expect(bloqueioDe(null, [])).toBeNull();
  });

  test("o impedimento da máquina vem antes do que está ocupado agora", () => {
    expect(bloqueioDe("bun_antigo", ["sincronizando"])).toEqual({ motivo: "bun_antigo", explicacao: "Esta versão pede uma atualização do instalador. Peça ao seu agente." });
  });

  test.each([
    ["gravando_no_crm", "A Secretária está gravando um cartão no CRM. Atualize depois que a gravação terminar."],
    ["sincronizando", "A Secretária está lendo o CRM, o WhatsApp e o e-mail. Atualize depois que a leitura terminar."],
    ["whatsapp_conectando", "O WhatsApp está no meio da conexão. Termine ou cancele a conexão e depois atualize."],
    ["crm_conectando", "O login do CRM está aberto. Termine ou cancele o login e depois atualize."],
    ["email_testando", "Uma conta de e-mail está em teste. Espere o teste terminar e depois atualize."],
  ] as const)("%s explica em palavras de vendedor", (motivo, explicacao) => {
    expect(bloqueioDe(null, [motivo])).toEqual({ motivo, explicacao });
  });

  test("toda explicação é uma frase de vendedor, sem crase nem travessão", () => {
    const textos = [
      ...MOTIVOS_DA_FALHA.map((motivo) => EXPLICACAO_DA_FALHA[motivo]),
      ...(["instalacao_de_desenvolvimento", "bun_antigo"] as const).map((motivo) => bloqueioDe(motivo, [])?.explicacao ?? ""),
    ];
    for (const texto of textos) expect(texto).toMatch(/^[A-ZÀ-Ú][^`—]*\.$/);
  });
});

describe("juntarEstado: a descoberta, a atualização e o que está ocupado", () => {
  test("sem atualização, versao_nova ganha o bloqueio; as outras fases passam como estão", () => {
    expect(juntarEstado(VERSAO_NOVA, { tipo: "nenhuma" }, [])).toEqual({ ...VERSAO_NOVA, bloqueio: null });
    expect(juntarEstado(VERSAO_NOVA, { tipo: "nenhuma" }, ["gravando_no_crm"])).toMatchObject({ fase: "versao_nova", bloqueio: { motivo: "gravando_no_crm" } });
    expect(juntarEstado(EM_DIA, { tipo: "nenhuma" }, ["sincronizando"])).toEqual(EM_DIA);
  });

  test("em curso: atualizando com o passo, por cima de tudo", () => {
    expect(juntarEstado(VERSAO_NOVA, { tipo: "em_curso", para: "0.2.0", passo: "instalando" }, ["sincronizando"])).toEqual({
      fase: "atualizando",
      instalada: "0.1.0",
      para: "0.2.0",
      passo: "instalando",
    });
  });

  test("falhou: o motivo em palavras, e a versão nova continua para tentar de novo", () => {
    expect(juntarEstado(VERSAO_NOVA, { tipo: "falhou", para: "0.2.0", motivo: "sem_internet", em: EM }, [])).toEqual({
      fase: "falhou",
      instalada: "0.1.0",
      para: "0.2.0",
      motivo: "sem_internet",
      explicacao: "Não deu para baixar a versão nova. Confira a internet e tente de novo.",
      em: EM,
      nova: NOVA,
      bloqueio: null,
    });
    expect(juntarEstado(EM_DIA, { tipo: "falhou", para: "0.3.0", motivo: "interrompida", em: EM }, [])).toMatchObject({ fase: "falhou", nova: null, bloqueio: null });
  });

  test("concluída: atualizado, com a contagem do núcleo mudado; uma versão mais nova ainda vira versao_nova", () => {
    expect(juntarEstado(EM_DIA, { tipo: "concluida", de: "0.1.0", nucleoMudado: 3, em: EM }, [])).toEqual({ fase: "atualizado", instalada: "0.2.0", de: "0.1.0", nucleoMudado: 3, em: EM });
    const maisNova: EstadoDaDescoberta = { ...VERSAO_NOVA, instalada: "0.2.0", nova: { ...NOVA, versao: "0.3.0" } };
    expect(juntarEstado(maisNova, { tipo: "concluida", de: "0.1.0", nucleoMudado: 0, em: EM }, [])).toMatchObject({ fase: "versao_nova", nova: { versao: "0.3.0" } });
  });
});
