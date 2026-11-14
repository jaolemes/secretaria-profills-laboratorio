import { describe, expect, test } from "bun:test";
import { montarCena } from "./dev/cenas";
import { hashDaRota, lerRota, rotaInicial, secaoDaRota, type Rota } from "./rota";

const agora = new Date("2026-11-11T12:00:00Z");

describe("rota por hash", () => {
  test.each<[string, Rota]>([
    ["#/meu-dia", { tela: "meu-dia" }],
    ["#/tarefas", { tela: "tarefas" }],
    ["#/tarefas/nova", { tela: "nova" }],
    ["#/tarefas/3f2b-11", { tela: "tarefa", id: "3f2b-11" }],
    ["#/conexoes", { tela: "conexoes" }],
  ])("%s ida e volta", (hash, rota) => {
    expect(lerRota(hash)).toEqual(rota);
    expect(hashDaRota(rota)).toBe(hash);
  });

  test.each(["", "#", "#/", "#/agenda", "#/tarefas/a/b", "#/meu-dia/x", "#/tarefas/%E0%A4%A"])("%s não é rota", (hash) => {
    expect(lerRota(hash)).toBeNull();
  });

  test("o detalhe e a criação marcam Tarefas na navegação", () => {
    expect(secaoDaRota({ tela: "tarefa", id: "x" })).toBe("tarefas");
    expect(secaoDaRota({ tela: "nova" })).toBe("tarefas");
    expect(secaoDaRota({ tela: "meu-dia" })).toBe("meu-dia");
  });
});

describe("tela inicial", () => {
  test.each<[string, Rota["tela"]]>([
    ["tudo-desconectado", "conexoes"],
    ["whatsapp-conectado", "conexoes"],
    ["crm-conectado", "conexoes"],
    ["dois-de-tres", "meu-dia"],
    ["tudo-conectado", "meu-dia"],
  ])("%s abre em %s", (cena, tela) => {
    expect(rotaInicial(montarCena(cena, agora)!).tela).toBe(tela);
  });

  test("CRM em crm_app_nao_liberado com o WhatsApp de pé abre no Meu dia", () => {
    const estado = montarCena("problema-crm_app_nao_liberado", agora)!;
    const comWhatsapp = { ...estado, conectores: { ...estado.conectores, whatsapp: montarCena("whatsapp-conectado", agora)!.conectores.whatsapp } };
    expect(rotaInicial(estado).tela).toBe("conexoes");
    expect(rotaInicial(comWhatsapp).tela).toBe("meu-dia");
  });

  test("outro problema do CRM segura em Conexões", () => {
    const estado = montarCena("problema-crm_conexao_vencida", agora)!;
    const comWhatsapp = { ...estado, conectores: { ...estado.conectores, whatsapp: montarCena("whatsapp-conectado", agora)!.conectores.whatsapp } };
    expect(rotaInicial(comWhatsapp).tela).toBe("conexoes");
  });
});
