import { describe, expect, test } from "bun:test";
import { criarApiDeTarefas, type Buscar } from "./api";

interface Chamada {
  readonly url: string;
  readonly init: RequestInit;
}

/** Uma API que guarda os pedidos e responde sempre o mesmo envelope. */
function comResposta(dados: unknown = {}): { readonly buscar: Buscar; readonly chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const buscar: Buscar = async (url, init) => {
    chamadas.push({ url, init });
    return Response.json({ v: 1, ok: true, dados });
  };
  return { buscar, chamadas };
}

const corpoDe = (chamada: Chamada | undefined) => JSON.parse(String(chamada?.init.body));

describe("pedidos das conversas de e-mail", () => {
  const ID = "e-0123456789abcdef";

  test("ignorar, desfazer e criar tarefa mandam o canal e o id do item", async () => {
    const { buscar, chamadas } = comResposta();
    const api = criarApiDeTarefas(buscar);
    await api.ignorar({ tipo: "conversa", canal: "email", id: ID });
    await api.desfazerIgnorado({ tipo: "conversa", canal: "email", id: ID });
    await api.criarDoMeuDia({ tipo: "conversa", canal: "email", id: ID }, "id-do-rascunho");
    expect(chamadas.map((c) => [c.url, corpoDe(c)])).toEqual([
      ["/api/ignorados", { tipo: "conversa", canal: "email", id: ID }],
      ["/api/ignorados/desfazer", { tipo: "conversa", canal: "email", id: ID }],
      ["/api/meu-dia/tarefas", { tipo: "conversa", canal: "email", id: ID, tarefaId: "id-do-rascunho" }],
    ]);
  });

  test("escolher o cliente e desfazer mandam o canal e o endereço como chave", async () => {
    const { buscar, chamadas } = comResposta();
    const api = criarApiDeTarefas(buscar);
    const alvo = { canal: "email", chave: "compras@cliente.exemplo.test" } as const;
    await api.escolherCliente(alvo, { clienteId: 9304 });
    await api.escolherCliente(alvo, { naoCliente: true });
    await api.desfazerEscolha(alvo);
    expect(chamadas.map((c) => [c.url, corpoDe(c)])).toEqual([
      ["/api/vinculos/escolher", { canal: "email", chave: "compras@cliente.exemplo.test", clienteId: 9304 }],
      ["/api/vinculos/escolher", { canal: "email", chave: "compras@cliente.exemplo.test", naoCliente: true }],
      ["/api/vinculos/desfazer", { canal: "email", chave: "compras@cliente.exemplo.test" }],
    ]);
  });

  test("ler o e-mail é um GET com a conta e o id escapados, sem corpo", async () => {
    const { buscar, chamadas } = comResposta();
    await criarApiDeTarefas(buscar).corpoDoEmail("conta/1 &x", "<entrada 1@exemplo.test>?a=b");
    expect(chamadas[0]?.url).toBe("/api/email/corpo?conta=conta%2F1%20%26x&id=%3Centrada%201%40exemplo.test%3E%3Fa%3Db");
    expect(chamadas[0]?.init.method).toBe("GET");
    expect(chamadas[0]?.init.body).toBeUndefined();
  });
});

describe("pedidos das conversas do WhatsApp", () => {
  test("ignorar e desfazer mandam o tipo e o id, texto para conversa e número para o resto", async () => {
    const { buscar, chamadas } = comResposta();
    const api = criarApiDeTarefas(buscar);
    await api.ignorar({ tipo: "conversa", canal: "whatsapp", id: "+5541999990001" });
    await api.ignorar({ tipo: "proposta", id: 81 });
    await api.desfazerIgnorado({ tipo: "conversa", canal: "whatsapp", id: "+5541999990001" });
    expect(chamadas.map((c) => [c.url, corpoDe(c)])).toEqual([
      ["/api/ignorados", { tipo: "conversa", canal: "whatsapp", id: "+5541999990001" }],
      ["/api/ignorados", { tipo: "proposta", id: 81 }],
      ["/api/ignorados/desfazer", { tipo: "conversa", canal: "whatsapp", id: "+5541999990001" }],
    ]);
  });

  test("criar tarefa de conversa leva o tarefaId do rascunho", async () => {
    const { buscar, chamadas } = comResposta();
    await criarApiDeTarefas(buscar).criarDoMeuDia({ tipo: "conversa", canal: "whatsapp", id: "+5541999990001" }, "id-do-rascunho");
    expect(chamadas[0]?.url).toBe("/api/meu-dia/tarefas");
    expect(corpoDe(chamadas[0])).toEqual({ tipo: "conversa", canal: "whatsapp", id: "+5541999990001", tarefaId: "id-do-rascunho" });
  });

  test("escolher o cliente e marcar como não cliente usam só os formatos que a rota aceita", async () => {
    const { buscar, chamadas } = comResposta();
    const api = criarApiDeTarefas(buscar);
    await api.escolherCliente({ canal: "whatsapp", chave: "+5541999990002" }, { clienteId: 9203 });
    await api.escolherCliente({ canal: "whatsapp", chave: "+5541999990002" }, { naoCliente: true });
    await api.desfazerEscolha({ canal: "whatsapp", chave: "+5541999990002" });
    expect(chamadas.map((c) => [c.url, corpoDe(c)])).toEqual([
      ["/api/vinculos/escolher", { canal: "whatsapp", chave: "+5541999990002", clienteId: 9203 }],
      ["/api/vinculos/escolher", { canal: "whatsapp", chave: "+5541999990002", naoCliente: true }],
      ["/api/vinculos/desfazer", { canal: "whatsapp", chave: "+5541999990002" }],
    ]);
    expect(chamadas.every((c) => c.init.method === "POST")).toBe(true);
  });

  test("abrir a mensagem em quarentena é um GET com a conversa e o id escapados", async () => {
    const { buscar, chamadas } = comResposta();
    await criarApiDeTarefas(buscar).mensagemEmQuarentena("198765432109876@lid", "3EB0CANARIO0001");
    expect(chamadas[0]?.url).toBe("/api/whatsapp/quarentena?conversa=198765432109876%40lid&id=3EB0CANARIO0001");
    expect(chamadas[0]?.init.method).toBe("GET");
    expect(chamadas[0]?.init.body).toBeUndefined();
  });

  test("o erro da API chega inteiro, para a gaveta mostrar", async () => {
    const buscar: Buscar = async () => Response.json({ v: 1, ok: false, erro: { codigo: "vinculo_decidido", mensagem: "Este número já tem uma decisão.", acao: "Desfaça a decisão antes." } }, { status: 409 });
    const resposta = await criarApiDeTarefas(buscar).escolherCliente({ canal: "whatsapp", chave: "+5541999990002" }, { clienteId: 9202 });
    expect(resposta).toEqual({ ok: false, erro: { codigo: "vinculo_decidido", mensagem: "Este número já tem uma decisão.", acao: "Desfaça a decisão antes." } });
  });
});

describe("pedidos da fila de aprovação", () => {
  const ID = "0b0e6f0e-1c1c-4c1c-9c1c-000000000001";
  const HASH = "26801a7a".repeat(8);

  test("ver o cartão é um GET sem corpo, com o id escapado", async () => {
    const { buscar, chamadas } = comResposta();
    await criarApiDeTarefas(buscar).verEscrita("id com/barra?e=1");
    expect(chamadas[0]?.url).toBe("/api/escritas/id%20com%2Fbarra%3Fe%3D1");
    expect(chamadas[0]?.init.method).toBe("GET");
    expect(chamadas[0]?.init.body).toBeUndefined();
  });

  test("editar manda o hash, a versão e só os campos que mudaram", async () => {
    const { buscar, chamadas } = comResposta();
    await criarApiDeTarefas(buscar).editarEscrita(ID, { hash: HASH, versao: 2, campos: { assunto: "CANARIO novo", descricao: "" } });
    expect(chamadas[0]?.url).toBe(`/api/escritas/${ID}/editar`);
    expect(chamadas[0]?.init.method).toBe("POST");
    expect(corpoDe(chamadas[0])).toEqual({ hash: HASH, versao: 2, campos: { assunto: "CANARIO novo", descricao: "" } });
  });

  test("descartar, aprovar, tentar de novo e já está no CRM são POST com { hash, versao }", async () => {
    const { buscar, chamadas } = comResposta();
    const api = criarApiDeTarefas(buscar);
    const corpo = { hash: HASH, versao: 3 };
    await api.descartarEscrita(ID, corpo);
    await api.aprovarEscrita(ID, corpo);
    await api.tentarDeNovo(ID, corpo);
    await api.jaEstaNoCrm(ID, corpo);
    expect(chamadas.map((c) => [c.init.method, c.url, corpoDe(c)])).toEqual([
      ["POST", `/api/escritas/${ID}/descartar`, corpo],
      ["POST", `/api/escritas/${ID}/aprovar`, corpo],
      ["POST", `/api/escritas/${ID}/tentar_de_novo`, corpo],
      ["POST", `/api/escritas/${ID}/ja_esta_no_crm`, corpo],
    ]);
    expect(chamadas.every((c) => new Headers(c.init.headers).get("Content-Type") === "application/json")).toBe(true);
  });

  test("a recusa mantém erro.atual, para a gaveta mostrar o cartão que está valendo", async () => {
    const atual = { id: ID, estado: "rascunho", versao: 2, hash: HASH };
    const buscar: Buscar = async () => Response.json({ v: 1, ok: false, erro: { codigo: "conflito_da_escrita", mensagem: "Este cartão mudou desde que você o abriu.", acao: "Leia o cartão de novo e decida.", atual } }, { status: 409 });
    const resposta = await criarApiDeTarefas(buscar).aprovarEscrita(ID, { hash: HASH, versao: 1 });
    expect(resposta).toEqual({ ok: false, erro: { codigo: "conflito_da_escrita", mensagem: "Este cartão mudou desde que você o abriu.", acao: "Leia o cartão de novo e decida.", atual } });
  });

  test("o pedido de aprovar espera a resposta, sem prazo do painel", async () => {
    let solta: (resposta: Response) => void = () => {};
    const buscar: Buscar = (_url, init) => {
      expect(init.signal).toBeUndefined();
      return new Promise<Response>((resolver) => {
        solta = resolver;
      });
    };
    const pendente = criarApiDeTarefas(buscar).aprovarEscrita(ID, { hash: HASH, versao: 1 });
    solta(Response.json({ v: 1, ok: true, dados: { id: ID, estado: "gravado" } }));
    expect(await pendente).toEqual({ ok: true, dados: { id: ID, estado: "gravado" } as never });
  });
});
