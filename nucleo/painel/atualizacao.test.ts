import { describe, expect, test } from "bun:test";
import type { EstadoDaAtualizacao, VersaoPublicada } from "../atualizacao";
import { lerNaVolta, vistaDaAtualizacao } from "./atualizacao";

const NOVA: VersaoPublicada = { versao: "0.2.0", data: "2026-11-20", bunMinimo: "1.4.4", oQueMuda: ["O painel avisa quando tem versão nova da Secretária."] };
const EM = "2026-11-15T12:00:00.000Z";
const EM_DIA: EstadoDaAtualizacao = { fase: "em_dia", instalada: "0.1.0", conferidaEm: EM };
const VERSAO_NOVA: EstadoDaAtualizacao = { fase: "versao_nova", instalada: "0.1.0", conferidaEm: EM, nova: NOVA, impedimento: null, bloqueio: null };
const ATUALIZANDO: EstadoDaAtualizacao = { fase: "atualizando", instalada: "0.1.0", para: "0.2.0", passo: "baixando" };
const ATUALIZADO: EstadoDaAtualizacao = { fase: "atualizado", instalada: "0.2.0", de: "0.1.0", nucleoMudado: 0, em: EM };
const FALHOU: EstadoDaAtualizacao = {
  fase: "falhou",
  instalada: "0.1.0",
  para: "0.2.0",
  motivo: "sem_internet",
  explicacao: "Não deu para baixar a versão nova. Confira a internet e tente de novo.",
  em: EM,
  nova: NOVA,
  bloqueio: null,
};
const SEM_INTERNET: EstadoDaAtualizacao = { fase: "sem_internet", instalada: "0.1.0", tentadaEm: EM };

const vista = (estado: EstadoDaAtualizacao, conferindo = false) => {
  const lida = vistaDaAtualizacao(estado, conferindo);
  if (lida === null) throw new Error("sem vista");
  return lida;
};

describe("o cartão do pé por estado", () => {
  test("em dia: nada no cartão, só a linha da versão na lista das conexões, sem ponto", () => {
    expect(vista(EM_DIA)).toEqual({ versao: "Secretária 0.1.0 · em dia", oQueMuda: [], aviso: null, recolhida: null, pontoNoMenu: false });
    expect(vista({ fase: "nao_conferida", instalada: "0.1.0" })).toMatchObject({ versao: "Secretária 0.1.0", aviso: null, pontoNoMenu: false });
  });

  test("versão nova: Tem versão nova e o Atualizar; a versão e o O que muda ficam na lista aberta", () => {
    expect(vista(VERSAO_NOVA)).toEqual({
      versao: "Secretária 0.1.0 · tem a 0.2.0",
      oQueMuda: NOVA.oQueMuda,
      aviso: { icone: "versao_nova", titulo: "Tem versão nova", textos: [], progresso: null, botao: { rotulo: "Atualizar", acao: "aplicar", principal: true }, trava: null },
      recolhida: { girando: false, ponto: true, rotulo: "Tem versão nova da Secretária" },
      pontoNoMenu: true,
    });
  });

  test("algo ocupado agora: o Atualizar fica, apagado, com a explicação embaixo", () => {
    const gravando = { motivo: "gravando_no_crm", explicacao: "A Secretária está gravando um cartão no CRM. Atualize depois que a gravação terminar." } as const;
    expect(vista({ ...VERSAO_NOVA, bloqueio: gravando }).aviso).toMatchObject({ botao: { rotulo: "Atualizar" }, trava: gravando.explicacao, textos: [] });
  });

  test.each([
    ["instalacao_de_desenvolvimento", "Esta pasta é de desenvolvimento e não se atualiza pelo painel. Peça ao seu agente para instalar a Secretária de novo pelo instalador."],
    ["bun_antigo", "Esta versão pede uma atualização do instalador. Peça ao seu agente."],
  ] as const)("impedimento %s: mostra que tem versão nova e a frase, sem botão", (motivo, explicacao) => {
    const aviso = vista({ ...VERSAO_NOVA, impedimento: motivo, bloqueio: { motivo, explicacao } }).aviso;
    expect(aviso).toMatchObject({ titulo: "Tem versão nova", textos: [explicacao], botao: null, trava: null });
  });

  test.each([
    ["baixando", "Baixando a versão nova", 20],
    ["instalando", "Instalando a versão nova", 55],
    ["reiniciando", "Reiniciando a Secretária", 85],
  ] as const)("atualizando, %s: o passo, a barra e nenhum botão; recolhida, o ícone gira sem ponto", (passo, texto, progresso) => {
    expect(vista({ ...ATUALIZANDO, passo })).toEqual({
      versao: "Secretária 0.1.0 · atualizando",
      oQueMuda: [],
      aviso: { icone: "girando", titulo: "Atualizando para a 0.2.0", textos: [`${texto}. Vai reiniciar; nada do que você aprovou se perde.`], progresso, botao: null, trava: null },
      recolhida: { girando: true, ponto: false, rotulo: "Atualizando a Secretária" },
      pontoNoMenu: false,
    });
  });

  test("atualizado: a versão nova, a linha do agente aberto e nenhum botão", () => {
    expect(vista(ATUALIZADO)).toMatchObject({
      versao: "Secretária 0.2.0 · atualizada",
      aviso: { icone: "feito", titulo: "Atualizada para a 0.2.0", textos: ["O agente que já estava aberto segue com as regras antigas até você abrir uma conversa nova."], botao: null },
      recolhida: { ponto: true },
      pontoNoMenu: true,
    });
  });

  test.each([
    [1, "1 arquivo da Secretária tinha sido mudado neste computador. A versão nova o trocou e guardou uma cópia."],
    [3, "3 arquivos da Secretária tinham sido mudados neste computador. A versão nova os trocou e guardou uma cópia."],
  ])("atualizado com %i arquivo do núcleo mudado: diz quantos e que a cópia ficou", (nucleoMudado, frase) => {
    expect(vista({ ...ATUALIZADO, nucleoMudado }).aviso?.textos).toContain(frase);
  });

  test("atualizado sem a lista para comparar não fala de arquivo mudado", () => {
    expect(vista({ ...ATUALIZADO, nucleoMudado: null }).aviso?.textos).toHaveLength(1);
  });

  test("falhou: o motivo, que a versão de antes segue e Tentar de novo", () => {
    expect(vista(FALHOU)).toMatchObject({
      versao: "Secretária 0.1.0 · não deu para atualizar",
      oQueMuda: NOVA.oQueMuda,
      aviso: {
        icone: "alerta",
        titulo: "Não deu para atualizar",
        textos: ["Não deu para baixar a versão nova. Confira a internet e tente de novo. A Secretária continua na 0.1.0 e funciona normalmente."],
        botao: { rotulo: "Tentar de novo", acao: "aplicar", principal: true },
        trava: null,
      },
      pontoNoMenu: true,
    });
  });

  test("sem internet: a frase do desenho e o Tentar agora, que vira Conferindo enquanto busca", () => {
    expect(vista(SEM_INTERNET)).toMatchObject({
      versao: "Secretária 0.1.0 · sem internet para conferir",
      aviso: {
        icone: "sem_rede",
        titulo: "Não deu para ver se tem versão nova",
        textos: ["Sem internet agora. A Secretária confere de novo quando você abrir o painel."],
        botao: { rotulo: "Tentar agora", acao: "conferir", principal: false },
      },
      recolhida: { ponto: true },
      pontoNoMenu: false,
    });
    expect(vista(SEM_INTERNET, true).aviso?.botao?.rotulo).toBe("Conferindo");
  });

  test("antes da primeira leitura, nada aparece", () => {
    expect(vistaDaAtualizacao(null, false)).toBeNull();
  });
});

describe("a volta do servidor depois do restart", () => {
  test("a mesma versão da página: o estado se mostra, seja a falha da volta ou outro", () => {
    expect(lerNaVolta("0.1.0", ATUALIZANDO, FALHOU)).toBe("mostrar");
    expect(lerNaVolta("0.1.0", VERSAO_NOVA, VERSAO_NOVA)).toBe("mostrar");
  });

  test("outra versão já atualizada: recarrega para pegar o painel novo", () => {
    expect(lerNaVolta("0.1.0", ATUALIZANDO, ATUALIZADO)).toBe("recarregar");
  });

  test("outra versão que ainda não gravou o fim: espera, sem trocar o Atualizando", () => {
    expect(lerNaVolta("0.1.0", ATUALIZANDO, { fase: "em_dia", instalada: "0.2.0", conferidaEm: EM })).toBe("esperar");
  });

  test("outra versão sem atualização em curso nesta página: recarrega", () => {
    expect(lerNaVolta("0.1.0", VERSAO_NOVA, { fase: "em_dia", instalada: "0.2.0", conferidaEm: EM })).toBe("recarregar");
  });
});
