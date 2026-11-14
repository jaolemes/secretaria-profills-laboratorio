import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Conectores } from "../../nucleo/conectores";
import { STATUS_DO_ATENDIMENTO, type Dia } from "../../nucleo/dominio";
import { montarBancada, type Bancada } from "../falsos/bancada";
import { atendimentoFalso, iniciarCrmFalso, type CrmFalso } from "../falsos/crm";

setDefaultTimeout(30_000);

let bancada: Bancada;
let crm: CrmFalso;
let solto: (() => void) | null = null;

afterEach(async () => {
  solto?.();
  solto = null;
  await bancada.limpar();
  await crm.parar();
});

function nova(opcoes: { readonly prazoDosAtendimentosMs?: number } = {}): Conectores {
  crm = iniciarCrmFalso({ agora: () => Date.parse(bancada.ambiente.agora()) });
  bancada = montarBancada({ crmRecurso: crm.recurso, crmClientId: crm.clientId, porta: 47_117 });
  return bancada.ligar(opcoes);
}

async function conectado(opcoes: { readonly prazoDosAtendimentosMs?: number } = {}): Promise<Conectores> {
  const conectores = nova(opcoes);
  await conectores.pronto;
  const pedido = await conectores.agir("crm", "conectar");
  if (!pedido.ok || pedido.dados.urlAutorizacao === null) throw new Error("conectar não devolveu a URL");
  const retorno = await conectores.retornoDoCrm(await crm.autorizar(pedido.dados.urlAutorizacao));
  expect(retorno.ok && retorno.dados.fase).toBe("conectado");
  return conectores;
}

const chamadas = () => crm.registro().chamadasDeFerramenta.filter((c) => c.nome === "meus_atendimentos");

describe("atendimentosDesde", () => {
  test("com o CRM desconectado devolve sem_crm e não abre a rede", async () => {
    const conectores = nova();
    await conectores.pronto;
    expect(await conectores.atendimentosDesde(crm.dia(-7))).toEqual({ tipo: "sem_crm", motivo: "crm_desconectado" });
    expect(crm.registro().chamadasAoMcp).toBe(0);
  });

  test("lê um status por vez na ordem fixa, todos com o mesmo `desde` e limite 50", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-7);
    crm.dados.atendimentos.push(atendimentoFalso(1, "Cancelado", desde), atendimentoFalso(2, "Pendente", desde), atendimentoFalso(3, "Concluído", desde), atendimentoFalso(4, "Em Andamento", desde));
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido.tipo === "lido" && lido.itens.map((a) => [a.id, a.status])).toEqual([
      [4, "Em Andamento"],
      [3, "Concluído"],
      [2, "Pendente"],
      [1, "Cancelado"],
    ]);
    expect(lido.tipo === "lido" && lido.cortado).toBe(false);
    expect(chamadas().map((c) => c.argumentos)).toEqual(STATUS_DO_ATENDIMENTO.map((status) => ({ status, desde, limite: 50 })));
  });

  test("a segunda página de um status vem por `antes`, o id do último item", async () => {
    const conectores = await conectado();
    const desde: Dia = crm.dia(-1);
    for (let id = 1; id <= 120; id += 1) crm.dados.atendimentos.push(atendimentoFalso(id, "Concluído", desde));
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido.tipo === "lido" && lido.itens).toHaveLength(120);
    expect(chamadas().filter((c) => c.argumentos.status === "Concluído").map((c) => c.argumentos.antes)).toEqual([undefined, 71, 21]);
  });

  test("o mesmo id em duas leituras conta uma vez", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-1);
    crm.dados.atendimentos.push(atendimentoFalso(7, "Pendente", desde), atendimentoFalso(7, "Concluído", desde));
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido.tipo === "lido" && lido.itens).toHaveLength(1);
  });

  test("passou de 20 páginas num status: para nele, segue nos outros e marca `cortado`", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-1);
    for (let id = 1; id <= 1001; id += 1) crm.dados.atendimentos.push(atendimentoFalso(id, "Pendente", desde));
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido.tipo === "lido" && lido.cortado).toBe(true);
    expect(lido.tipo === "lido" && lido.itens).toHaveLength(1000);
    expect(chamadas().filter((c) => c.argumentos.status === "Pendente")).toHaveLength(20);
    expect(chamadas()).toHaveLength(23);
  });

  test("exatas 20 páginas cheias sem `mais` não é cortado", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-1);
    for (let id = 1; id <= 1000; id += 1) crm.dados.atendimentos.push(atendimentoFalso(id, "Pendente", desde));
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido.tipo === "lido" && lido.cortado).toBe(false);
  });

  test("a primeira leitura que falha encerra o pedido, sem nada parcial", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-1);
    crm.dados.atendimentos.push(atendimentoFalso(1, "Em Andamento", desde));
    crm.botoes.limiteHttpS = 30;
    crm.botoes.chamadasAntesDoLimite = 1;
    const lido = await conectores.atendimentosDesde(desde);
    expect(lido).toMatchObject({ tipo: "falhou", erro: { codigo: "crm_limite_de_chamadas", esperaS: 30 } });
    expect(chamadas()).toHaveLength(2);
  });

  test("passou do prazo: falha como CRM fora do ar, sem esperar o CRM responder", async () => {
    const conectores = await conectado({ prazoDosAtendimentosMs: 200 });
    crm.botoes.segurar = new Promise<void>((resolver) => {
      solto = resolver;
    });
    const lido = await conectores.atendimentosDesde(crm.dia(-1));
    expect(lido).toMatchObject({ tipo: "falhou", erro: { codigo: "crm_fora_do_ar" } });
  });

  test("não guarda nada: o cache e o registro ficam sem o texto do CRM", async () => {
    const conectores = await conectado();
    const desde = crm.dia(-1);
    crm.dados.atendimentos.push(atendimentoFalso(1, "Concluído", desde, { assunto: "CANARIO-ASSUNTO-LIMPO", cliente: { id: 8777, nome: "CANARIO-NOME-SO-DO-ATENDIMENTO" } }));
    await conectores.atendimentosDesde(desde);
    const registrado = bancada.linhasDoRegistro.join("\n");
    expect(registrado).not.toContain("CANARIO-ASSUNTO-LIMPO");
    expect(registrado).not.toContain("CANARIO-NOME-SO-DO-ATENDIMENTO");
    expect(conectores.leiturasDoCrm()).toEqual({ agenda: null, propostas: null, carteira: null });
  });
});
