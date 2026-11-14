import { describe, expect, test } from "bun:test";
import { instante, listarNaoClientes, montarBlocosDeConversas, type Instante } from "../../dominio";
import { ehDoWhatsapp } from "../conversas";
import { criarConversasDeMentira } from "./conversas";

const agora = instante(new Date("2026-11-13T15:00:00Z")) as Instante;
const conectado = { fase: "conectado" } as never;
const telefones = (blocos: ReturnType<typeof montarBlocosDeConversas>["responder"]) => blocos.itens.filter(ehDoWhatsapp).map((i) => i.telefone);

describe("conversas de mentira do dev server", () => {
  test("sem o parâmetro, não há leitura até a primeira sincronização", () => {
    const conversas = criarConversasDeMentira(null);
    expect(conversas.dados(agora)).toBeNull();
    expect(conversas.sincronizar(agora)).toBe(9);
    expect(conversas.dados(agora)?.leitura?.itens).toHaveLength(9);
  });

  test("cheio traz uma conversa de cada tipo, e vazio, a leitura sem nenhuma", () => {
    const cheio = montarBlocosDeConversas(criarConversasDeMentira("cheio").dados(agora)!, conectado);
    expect(
      cheio.responder.itens.filter(ehDoWhatsapp).map((i) => [i.telefone.slice(-2), i.vinculo, i.vinculo === "ambiguo" ? i.motivo_da_duvida : null, i.em_quarentena, i.tem_ilegiveis, i.mais_que_o_lido]),
    ).toEqual([
      ["11", "auto", null, false, false, true],
      ["01", "auto", null, false, false, false],
      ["02", "ambiguo", "varios_clientes", false, false, false],
      ["03", "ambiguo", "variante_do_9", false, false, false],
      ["04", "ambiguo", "sem_prova_do_telefone", false, false, false],
      ["06", "auto", null, true, false, false],
      ["09", "auto", null, true, false, false],
      ["10", "auto", null, false, true, false],
    ]);
    expect(cheio.esperando_cliente.itens.filter(ehDoWhatsapp).map((i) => i.dias_uteis)).toEqual([5]);
    const vazio = montarBlocosDeConversas(criarConversasDeMentira("vazio").dados(agora)!, conectado);
    expect([vazio.responder.motivo, vazio.esperando_cliente.motivo]).toEqual(["sem_itens", "sem_itens"]);
  });

  test("escolher confirma, repetir devolve o mesmo, e outra decisão pede desfazer antes", () => {
    const conversas = criarConversasDeMentira("cheio");
    const primeira = conversas.escolher("+5541999990002", { chave: "+5541999990002", clienteId: 9203 }, agora);
    expect(primeira).toMatchObject({ ok: true, dados: { estado: "confirmado", cliente: { id: 9203 } } });
    expect(conversas.escolher("+5541999990002", { chave: "+5541999990002", clienteId: 9203 }, agora)).toEqual(primeira);
    expect(conversas.escolher("+5541999990002", { chave: "+5541999990002", naoCliente: true }, agora)).toMatchObject({ ok: false, erro: { codigo: "vinculo_decidido" } });
    expect(conversas.escolher("+5541999990002", { chave: "+5541999990002", clienteId: 1 }, agora)).toMatchObject({ ok: false });
    const blocos = montarBlocosDeConversas(conversas.dados(agora)!, conectado);
    expect(blocos.responder.itens.filter(ehDoWhatsapp).find((i) => i.telefone === "+5541999990002")).toMatchObject({ vinculo: "confirmado", cliente: { id: 9203 } });
  });

  test("não é cliente tira a conversa e a põe em nao_clientes, e desfazer a devolve a Responder com Qual cliente?", () => {
    const conversas = criarConversasDeMentira("cheio");
    expect(conversas.escolher("+5541999990003", { chave: "+5541999990003", naoCliente: true }, agora)).toMatchObject({ ok: true, dados: { estado: "nao_cliente", cliente: null } });
    expect(telefones(montarBlocosDeConversas(conversas.dados(agora)!, conectado).responder)).not.toContain("+5541999990003");
    expect(listarNaoClientes(conversas.dados(agora)!).filter(ehDoWhatsapp).map((n) => [n.telefone, n.nome_no_whatsapp])).toEqual([["+5541999990003", "Nome Canário Três"]]);
    expect(conversas.desfazerVinculo("+5541999990003", agora)).toBe(true);
    expect(conversas.desfazerVinculo("+5541999990003", agora)).toBe(true);
    const volta = montarBlocosDeConversas(conversas.dados(agora)!, conectado).responder.itens.filter(ehDoWhatsapp).find((i) => i.telefone === "+5541999990003");
    expect(volta).toMatchObject({ vinculo: "ambiguo", motivo_da_duvida: "variante_do_9", candidatos: [{ id: 9204 }] });
    expect(listarNaoClientes(conversas.dados(agora)!)).toEqual([]);
  });

  test("Trocar cliente: o confirmado volta na hora a perguntar, com o cliente de candidato", () => {
    const conversas = criarConversasDeMentira("cheio");
    conversas.escolher("+5541999990002", { chave: "+5541999990002", clienteId: 9203 }, agora);
    expect(conversas.desfazerVinculo("+5541999990002", agora)).toBe(true);
    expect(conversas.desfazerVinculo("+5541999990002", agora)).toBe(true);
    const item = montarBlocosDeConversas(conversas.dados(agora)!, conectado).responder.itens.find((i) => i.canal === "whatsapp" && i.telefone === "+5541999990002");
    expect(item).toMatchObject({ vinculo: "ambiguo", motivo_da_duvida: "desfeito_pelo_vendedor", candidatos: [{ id: 9203 }] });
    conversas.sincronizar(agora);
    const sincronizado = montarBlocosDeConversas(conversas.dados(agora)!, conectado).responder.itens.find((i) => i.canal === "whatsapp" && i.telefone === "+5541999990002");
    expect(sincronizado).toMatchObject({ vinculo: "ambiguo", motivo_da_duvida: "varios_clientes", candidatos: [{ id: 9202 }, { id: 9203 }] });
  });

  test("ignorar tira a conversa do bloco, conta no bloco e volta com o Desfazer", () => {
    const conversas = criarConversasDeMentira("cheio");
    expect(conversas.ignorar("+5541999990001", agora)).toMatchObject({ ok: true, dados: { tipo: "conversa", id: "+5541999990001", ate: "2026-11-20", quem: "vendedor", motivo: null } });
    const blocos = montarBlocosDeConversas(conversas.dados(agora)!, conectado);
    expect(blocos.responder.ignorados).toBe(1);
    expect(telefones(blocos.responder)).not.toContain("+5541999990001");
    expect(conversas.ignorar("+5541999990099", agora)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
    expect(conversas.desfazerIgnorado("+5541999990001")).toBe(true);
    expect(telefones(montarBlocosDeConversas(conversas.dados(agora)!, conectado).responder)).toContain("+5541999990001");
  });

  test("a mensagem em quarentena vem com as marcas no lugar dos caracteres invisíveis", () => {
    const conversas = criarConversasDeMentira("cheio");
    const mensagem = conversas.mensagem("5541999990009@s.whatsapp.net", "3EB0CANARIO0002", agora);
    expect(mensagem).toMatchObject({ ok: true, dados: { id: "3EB0CANARIO0002", sinais: ["caractere_invisivel", "fala_com_o_agente", "pede_comando"] } });
    expect(mensagem.ok && mensagem.dados.texto).toContain("⟦U+200B⟧");
    expect(conversas.mensagem("x@s.whatsapp.net", "nao-existe", agora)).toMatchObject({ ok: false });
  });
});
