import { describe, expect, test } from "bun:test";
import type { AndamentoDaSincronizacao } from "../conectores";
import { CONEXAO_INICIAL, chaveDosConectores, esperaParaReconectar, lerAndamento, lerEstadoDaAtualizacao, lerEstadoPainel, podeAgir, reduzirConexao, type EventoDaConexao } from "./conexao";
import { SINCRONIZACAO_PARADA, rotuloDaSincronizacao } from "./meu-dia";
import { montarCena } from "./dev/cenas";

const agora = new Date("2026-11-11T12:00:00Z");
const desconectado = montarCena("tudo-desconectado", agora)!;
const conectado = montarCena("tudo-conectado", agora)!;

describe("conexão com o SSE", () => {
  test("começa conectando, sem estado e sem ações", () => {
    expect(CONEXAO_INICIAL).toEqual({ estado: null, canal: "conectando", mudancasDeTarefas: 0, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0, atualizacao: null });
    expect(podeAgir(CONEXAO_INICIAL)).toBe(false);
  });

  test("cada evento estado troca o snapshot inteiro", () => {
    const primeiro = reduzirConexao(CONEXAO_INICIAL, { tipo: "estado", estado: desconectado });
    const segundo = reduzirConexao(primeiro, { tipo: "estado", estado: conectado });
    expect(segundo).toEqual({ estado: conectado, canal: "aberto", mudancasDeTarefas: 0, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0, atualizacao: null });
    expect(podeAgir(segundo)).toBe(true);
  });

  test("queda mantém o último snapshot à vista, mas trava as ações", () => {
    const aberta = reduzirConexao(CONEXAO_INICIAL, { tipo: "estado", estado: desconectado });
    const caida = reduzirConexao(aberta, { tipo: "caiu" });
    expect(caida).toEqual({ estado: desconectado, canal: "sem_conexao", mudancasDeTarefas: 0, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0, atualizacao: null });
    expect(podeAgir(caida)).toBe(false);
  });

  test("reabrir libera as ações de novo", () => {
    const caida = reduzirConexao({ estado: desconectado, canal: "aberto", mudancasDeTarefas: 0, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0, atualizacao: null }, { tipo: "caiu" });
    expect(podeAgir(reduzirConexao(caida, { tipo: "aberto" }))).toBe(true);
  });

  test("cada event: tarefas conta uma mudança e mantém o snapshot", () => {
    const aberta = reduzirConexao(CONEXAO_INICIAL, { tipo: "estado", estado: conectado });
    const mudou = reduzirConexao(reduzirConexao(aberta, { tipo: "tarefas" }), { tipo: "tarefas" });
    expect(mudou).toEqual({ estado: conectado, canal: "aberto", mudancasDeTarefas: 2, sincronizacao: SINCRONIZACAO_PARADA, rodadasTerminadas: 0, atualizacao: null });
    expect(reduzirConexao(mudou, { tipo: "estado", estado: desconectado }).mudancasDeTarefas).toBe(2);
  });

  test("a espera para reconectar sobe e para em 10 s", () => {
    expect([0, 1, 2, 3, 4, 5].map(esperaParaReconectar)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });
});

describe("leitura do evento estado", () => {
  test("aceita o snapshot que o servidor manda", () => {
    expect(lerEstadoPainel(JSON.stringify(conectado))).toEqual(conectado);
  });

  test.each([
    ["JSON quebrado", "{"],
    ["nulo", "null"],
    ["sem conectores", JSON.stringify({ onboardingCompleto: false })],
    ["conector faltando", JSON.stringify({ ...conectado, conectores: { whatsapp: conectado.conectores.whatsapp } })],
    ["sem acoes", JSON.stringify({ ...conectado, conectores: { ...conectado.conectores, crm: { estado: { fase: "desconectado" } } } })],
  ])("ignora %s", (_nome, texto) => {
    expect(lerEstadoPainel(texto)).toBeNull();
  });
});

describe("sincronização no SSE", () => {
  const passo = (andamento: AndamentoDaSincronizacao): EventoDaConexao => ({ tipo: "sincronizacao", andamento });

  test("cada passo entra no estado, mesmo os que chegam juntos, e o fim conta uma rodada", () => {
    const eventos: EventoDaConexao[] = [
      passo({ id: "r1", etapa: "comecou", fontes: ["agenda", "propostas", "carteira", "conversas", "email"] }),
      passo({ id: "r1", etapa: "fonte", fonte: "agenda", situacao: "lendo" }),
      passo({ id: "r1", etapa: "fonte", fonte: "agenda", situacao: "leu" }),
      passo({ id: "r1", etapa: "fonte", fonte: "propostas", situacao: "lendo" }),
    ];
    const meio = eventos.reduce(reduzirConexao, CONEXAO_INICIAL);
    expect(rotuloDaSincronizacao(meio.sincronizacao)).toBe("Lendo propostas (2 de 5)");
    const fim = reduzirConexao(meio, passo({ id: "r1", etapa: "terminou" }));
    expect(fim.sincronizacao).toEqual(SINCRONIZACAO_PARADA);
    expect(fim.rodadasTerminadas).toBe(1);
  });

  test("o canal caído solta o botão: o fim da rodada pode ter se perdido", () => {
    const rodando = reduzirConexao(CONEXAO_INICIAL, passo({ id: "r1", etapa: "comecou", fontes: ["agenda", "propostas", "carteira", "conversas", "email"] }));
    expect(reduzirConexao(rodando, { tipo: "caiu" }).sincronizacao).toEqual(SINCRONIZACAO_PARADA);
  });

  test("a borda do SSE recusa passo fora da forma", () => {
    expect(lerAndamento('{"id":"r1","etapa":"fonte","fonte":"agenda","situacao":"leu"}')).toEqual({ id: "r1", etapa: "fonte", fonte: "agenda", situacao: "leu" });
    expect(lerAndamento('{"id":"r1","etapa":"fonte","fonte":"conversas","situacao":"pulada"}')).toEqual({ id: "r1", etapa: "fonte", fonte: "conversas", situacao: "pulada" });
    expect(lerAndamento('{"id":"r1","etapa":"comecou"}')).toEqual({ id: "r1", etapa: "comecou", fontes: ["agenda", "propostas", "carteira", "conversas", "email"] });
    expect(lerAndamento('{"id":"r1","etapa":"fonte","fonte":"email","situacao":"leu"}')).toEqual({ id: "r1", etapa: "fonte", fonte: "email", situacao: "leu" });
    for (const texto of ["{", '{"etapa":"terminou"}', '{"id":"r1","etapa":"fonte","fonte":"outra","situacao":"leu"}', '{"id":"r1","etapa":"fonte","fonte":"agenda","situacao":"apagou"}']) {
      expect(lerAndamento(texto)).toBeNull();
    }
  });
});

describe("atualização no SSE", () => {
  const atualizando = { fase: "atualizando", instalada: "0.1.0", para: "0.2.0", passo: "instalando" } as const;

  test("cada passo troca o estado da atualização e mantém o resto", () => {
    const aberta = reduzirConexao(CONEXAO_INICIAL, { tipo: "estado", estado: conectado });
    const mudou = reduzirConexao(aberta, { tipo: "atualizacao", estado: atualizando });
    expect(mudou).toEqual({ ...aberta, atualizacao: atualizando });
  });

  test("a borda do SSE aceita só uma fase que existe, com a versão instalada", () => {
    expect(lerEstadoDaAtualizacao(JSON.stringify(atualizando))).toEqual(atualizando);
    for (const texto of ["{", "null", '{"fase":"outra","instalada":"0.1.0"}', '{"fase":"em_dia"}']) expect(lerEstadoDaAtualizacao(texto)).toBeNull();
  });
});

describe("chave dos conectores", () => {
  test("muda quando o WhatsApp ou o CRM muda de fase, para o Meu dia recarregar o motivo", () => {
    expect(chaveDosConectores(null)).toBe("");
    expect(chaveDosConectores(desconectado)).toBe("desconectado|desconectado");
    expect(chaveDosConectores(conectado)).toBe("conectado|conectado");
    const naoLiberado = montarCena("meu-dia-crm-nao-liberado", agora)!;
    expect(chaveDosConectores(naoLiberado)).toBe("conectado|atencao:crm_app_nao_liberado");
    expect(chaveDosConectores(montarCena("problema-whatsapp_espelho_caindo", agora)!)).toBe("atencao:whatsapp_espelho_caindo|desconectado");
  });

  test("o e-mail não mexe nela: ele não muda o Meu dia", () => {
    expect(chaveDosConectores(montarCena("email-conectado", agora)!)).toBe(chaveDosConectores(montarCena("tudo-desconectado", agora)!));
  });
});
