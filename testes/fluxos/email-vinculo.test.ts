import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { decidirVinculoDoVendedor, gravarVinculoConsultado, lerVinculo, listarVinculos } from "../../nucleo/banco";
import type { Conectores, ResultadoDaFonte, Sincronizacao } from "../../nucleo/conectores";
import { CONSULTAS_DE_ENDERECO_POR_RODADA } from "../../nucleo/conectores/sincronizacao";
import { escolherNoVinculo, vinculoDe } from "../../nucleo/dominio";
import { contaAssentada, esperar, montarBancada, type Bancada } from "../falsos/bancada";
import { gerarCertificado } from "../falsos/certificado";
import { clienteFalso, iniciarCrmFalso, type CrmFalso } from "../falsos/crm";
import { iniciarImapFalso, type ImapFalso, type MensagemDoFalso, type PastaDoFalso } from "../falsos/imap";

// Cada conta abre conexão de verdade; num runner lento de CI os 5 s padrão não bastam.
setDefaultTimeout(30_000);

const certificado = gerarCertificado();
const PROFILLS = "vendedor@exemplo.test";
const SENHA = "CANARIO-senha-profills-2k9";
const UM_DIA_MS = 86_400_000;
const ASSUNTO_CANARIO = "CANARIO-ASSUNTO-do-cliente";
const NOME_CANARIO = "CANARIO-NOME-do-remetente";

const ENDERECO = {
  comProva: "compras@cliente.exemplo.test",
  semProva: "geral@semprova.exemplo.test",
  doisClientes: "duplo@cliente.exemplo.test",
  semCliente: "desconhecido@nada.exemplo.test",
  automatico: "novidades@cliente.exemplo.test",
};

let bancada: Bancada;
let crm: CrmFalso;
const servidores: ImapFalso[] = [];

afterEach(async () => {
  await bancada.limpar();
  await crm.parar();
  await Promise.all(servidores.splice(0).map((servidor) => servidor.parar()));
});

const minutosAtras = (minutos: number) => new Date(Date.parse(bancada.ambiente.agora()) - minutos * 60_000).toISOString();

function mensagem(uid: number, de: string, extra: Partial<MensagemDoFalso> = {}): MensagemDoFalso {
  return {
    uid,
    dataInterna: minutosAtras(60 + uid),
    de: { nome: NOME_CANARIO, endereco: de },
    para: [PROFILLS],
    assunto: `${ASSUNTO_CANARIO} ${uid}`,
    messageId: `<m${uid}@exemplo.test>`,
    corpo: { texto: `CANARIO-CORPO ${uid}` },
    ...extra,
  };
}

function cadastrar(): void {
  crm.dados.carteira.push(
    clienteFalso(9301, null, { contatos: [{ id: 1, id_cliente: 9301, nome: "CANARIO Contato", telefone: null, email: ENDERECO.comProva, cargo: null }] }),
    clienteFalso(9302, null, { email: ENDERECO.semProva }),
    clienteFalso(9303, null, { contatos: [{ id: 2, id_cliente: 9303, nome: "CANARIO Contato", telefone: null, email: ENDERECO.doisClientes, cargo: null }] }),
    clienteFalso(9304, null, { contatos: [{ id: 3, id_cliente: 9304, nome: "CANARIO Contato", telefone: null, email: ENDERECO.doisClientes, cargo: null }] }),
  );
}

/** Sobe os conectores, o IMAP falso com `mensagens` na entrada e a conta Profills, e liga o CRM quando `comCrm`. */
async function ligado(mensagens: (() => MensagemDoFalso[]) | MensagemDoFalso[], comCrm = true): Promise<{ conectores: Conectores; entrada: PastaDoFalso; contaId: string }> {
  crm = iniciarCrmFalso({ agora: () => Date.parse(bancada?.ambiente.agora() ?? new Date().toISOString()) });
  bancada = montarBancada({ caExtra: certificado.certificado, crmRecurso: crm.recurso, crmClientId: crm.clientId });
  cadastrar();
  const conectores = bancada.ligar();
  await conectores.pronto;
  if (comCrm) {
    const pedido = await conectores.agir("crm", "conectar");
    if (!pedido.ok || pedido.dados.urlAutorizacao === null) throw new Error("o CRM não devolveu a URL de login");
    await conectores.retornoDoCrm(await crm.autorizar(pedido.dados.urlAutorizacao));
  }
  const entrada: PastaDoFalso = { caminho: "INBOX", uidValidity: 1731500000, mensagens: typeof mensagens === "function" ? mensagens() : mensagens };
  const servidor = await iniciarImapFalso({ seguranca: "tls", certificado, contas: { [PROFILLS]: SENHA }, caixas: { [PROFILLS]: [entrada] } });
  servidores.push(servidor);
  const pedido = await conectores.email.adicionar({ rotulo: "Profills", provedor: "outro", endereco: PROFILLS, servidor: "127.0.0.1", porta: servidor.porta, seguranca: "tls", senha: SENHA, janelaDias: 90 });
  if (!pedido.ok) throw new Error(`adicionar falhou: ${pedido.erro.codigo}`);
  const contaId = pedido.dados.id;
  await esperar(conectores, (e) => e.email.contas.some((c) => c.id === contaId && c.estado.fase !== "testando"), "fim do teste da conta");
  await contaAssentada(conectores, contaId);
  return { conectores, entrada, contaId };
}

function fonteEmail(rodada: Sincronizacao): ResultadoDaFonte {
  const fonte = rodada.fontes.find((candidata) => candidata.fonte === "email");
  if (fonte === undefined) throw new Error("a rodada não tem a fonte email");
  return fonte;
}

const buscas = () => crm.registro().chamadasDeFerramenta.filter((c) => c.nome === "buscar_clientes");
const consultados = () => buscas().map((c) => String(c.argumentos.q));
const vinculos = () => Object.fromEntries([...listarVinculos(bancada.banco, "email")].map(([chave, v]) => [chave, v.estado]));

const cenario = () => [
  mensagem(1, ENDERECO.comProva),
  mensagem(2, ENDERECO.comProva),
  mensagem(3, ENDERECO.semProva),
  mensagem(4, ENDERECO.doisClientes),
  mensagem(5, ENDERECO.semCliente),
  mensagem(6, ENDERECO.automatico, { listUnsubscribe: "<mailto:sair@exemplo.test>" }),
];

describe("a fonte email consulta o CRM pelo endereço", () => {
  test("vincula cada remetente de conversa com mensagem de fora, uma consulta por endereço, só com o endereço no q", async () => {
    const { conectores } = await ligado(cenario);
    const rodada = await conectores.sincronizar();
    expect(fonteEmail(rodada)).toMatchObject({ situacao: "leu", cortado: false });
    expect("semConsultaAoCrm" in fonteEmail(rodada)).toBe(false);

    expect(vinculos()).toEqual({
      [ENDERECO.comProva]: "auto",
      [ENDERECO.semProva]: "ambiguo",
      [ENDERECO.doisClientes]: "ambiguo",
      [ENDERECO.semCliente]: "sem_cliente",
    });
    const todos = listarVinculos(bancada.banco, "email");
    expect(todos.get(ENDERECO.semProva)).toMatchObject({ motivo: "sem_prova_do_email", candidatos: [{ id: 9302 }] });
    expect(todos.get(ENDERECO.doisClientes)).toMatchObject({ motivo: "varios_clientes", candidatos: [{ id: 9303 }, { id: 9304 }] });
    expect(todos.get(ENDERECO.comProva)).toMatchObject({ cliente: { id: 9301 } });

    // Dois e-mails do mesmo remetente geram uma consulta; o automático não gera nenhuma.
    expect(consultados().toSorted()).toEqual([ENDERECO.comProva, ENDERECO.semProva, ENDERECO.doisClientes, ENDERECO.semCliente].toSorted());
    for (const chamada of buscas()) expect(Object.keys(chamada.argumentos).toSorted()).toEqual(["limite", "q"]);
    const enviado = JSON.stringify(buscas());
    expect(enviado).not.toContain(NOME_CANARIO);
    expect(enviado).not.toContain(ASSUNTO_CANARIO);
    expect(enviado).not.toContain("CANARIO-CORPO");
  });

  test("conversa só com mensagens da conta e remetente em quarentena de nome também seguem a regra: só mensagem de fora vai ao CRM", async () => {
    const { conectores } = await ligado([mensagem(1, PROFILLS, { para: [ENDERECO.semCliente] }), mensagem(2, ENDERECO.comProva)]);
    await conectores.sincronizar();
    expect(consultados()).toEqual([ENDERECO.comProva]);
  });

  test("a consulta de endereços que quebra não derruba a rodada: a fonte email leu, sai cortada, e o registro leva só o nome do erro", async () => {
    const { conectores } = await ligado(cenario);
    bancada.banco.sqlite.exec("DROP TABLE contato_vinculo");
    const rodada = await conectores.sincronizar();
    expect(fonteEmail(rodada)).toMatchObject({ situacao: "leu", cortado: true });
    expect(rodada.fontes.map((fonte) => fonte.fonte)).toContain("email");
    const quebrou = bancada.linhasDoRegistro.filter((linha) => linha.includes("sincronizacao.fonte_quebrou"));
    expect(quebrou).toHaveLength(1);
    expect(quebrou[0]).toContain('"fonte":"email"');
    expect(quebrou[0]).not.toContain("contato_vinculo");
  });

  test("a segunda sincronização não consulta endereço com vínculo válido; sem_cliente volta depois de 7 dias", async () => {
    const { conectores } = await ligado(cenario);
    await conectores.sincronizar();
    const primeira = buscas().length;
    await conectores.sincronizar();
    expect(buscas().length).toBe(primeira);

    bancada.avancar(7 * UM_DIA_MS);
    await conectores.sincronizar();
    expect(consultados().slice(primeira)).toEqual([ENDERECO.semCliente]);
  });

  test("a sincronização não pisa confirmado nem nao_cliente, nem depois de 30 dias", async () => {
    const { conectores } = await ligado(cenario);
    await conectores.sincronizar();
    const agora = bancada.ambiente.agora();
    const confirmado = decidirVinculoDoVendedor(bancada.banco, "email", ENDERECO.semProva, (atual) => escolherNoVinculo(atual, { tipo: "cliente", clienteId: 9302 }, agora));
    const naoCliente = decidirVinculoDoVendedor(bancada.banco, "email", ENDERECO.comProva, (atual) => escolherNoVinculo(atual, { tipo: "nao_cliente" }, agora));
    expect([confirmado.ok, naoCliente.ok]).toEqual([true, true]);
    const antes = buscas().length;
    bancada.avancar(31 * UM_DIA_MS);
    await conectores.sincronizar();
    expect(lerVinculo(bancada.banco, "email", ENDERECO.semProva)).toMatchObject({ estado: "confirmado", cliente: { id: 9302 } });
    expect(lerVinculo(bancada.banco, "email", ENDERECO.comProva)).toMatchObject({ estado: "nao_cliente" });
    // Só os outros dois vencidos foram consultados de novo.
    expect(consultados().slice(antes).toSorted()).toEqual([ENDERECO.doisClientes, ENDERECO.semCliente].toSorted());
  });

  test("teto de 30 consultas: cortado na fonte, e a rodada seguinte consulta o resto", async () => {
    const total = CONSULTAS_DE_ENDERECO_POR_RODADA + 2;
    const { conectores } = await ligado(Array.from({ length: total }, (_, i) => mensagem(i + 1, `cliente${i + 1}@cliente.exemplo.test`)));
    const primeira = fonteEmail(await conectores.sincronizar());
    expect(primeira).toMatchObject({ situacao: "leu", cortado: true });
    expect(buscas().length).toBe(CONSULTAS_DE_ENDERECO_POR_RODADA);
    expect(listarVinculos(bancada.banco, "email").size).toBe(CONSULTAS_DE_ENDERECO_POR_RODADA);
    // As mais recentes primeiro: o uid 1 tem a data mais nova do cenário.
    expect(consultados()[0]).toBe("cliente1@cliente.exemplo.test");

    const segunda = fonteEmail(await conectores.sincronizar());
    expect(segunda).toMatchObject({ situacao: "leu", cortado: false });
    expect(buscas().length).toBe(total);
    expect(new Set(consultados()).size).toBe(total);
  });

  test("endereço com mais de 200 caracteres não é consultado e não deixa a fonte cortada", async () => {
    const longo = `${"a".repeat(190)}@cliente.exemplo.test`;
    const { conectores } = await ligado([mensagem(1, longo), mensagem(2, ENDERECO.comProva)]);
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(consultados()).toEqual([ENDERECO.comProva]);
    expect(fonte).toMatchObject({ situacao: "leu", cortado: false });
    expect(lerVinculo(bancada.banco, "email", longo)).toBeNull();
  });

  test("crm_limite_de_chamadas no meio: as consultas param, o vínculo antigo fica e a fonte sai leu com semConsultaAoCrm", async () => {
    const { conectores } = await ligado(cenario);
    // Um vínculo antigo e vencido de outro endereço: o limite não o apaga.
    const antigo = vinculoDe("email", ENDERECO.semCliente, { estado: "auto", cliente: { id: 9301, nome: "CANARIO Cliente 9301" as never, cidade: null, uf: null } }, new Date(Date.parse(bancada.ambiente.agora()) - 40 * UM_DIA_MS).toISOString() as never);
    gravarVinculoConsultado(bancada.banco, antigo);
    // O limite bate na terceira busca por endereço: as fontes do CRM, antes, passam.
    crm.botoes.aoChamar = (nome) => {
      if (nome !== "buscar_clientes" || buscas().length !== 3) return;
      crm.botoes.chamadasAntesDoLimite = crm.registro().chamadasDeFerramenta.length - 1;
      crm.botoes.limiteNaFerramentaS = 30;
    };
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(fonte).toMatchObject({ situacao: "leu", cortado: true, semConsultaAoCrm: { motivo: "crm_limite_de_chamadas", erro: { esperaS: 30 } } });
    // Duas consultas boas e a que bateu no limite: a quarta nem saiu.
    expect(buscas().length).toBe(3);
    expect(listarVinculos(bancada.banco, "email").size).toBe(3);
    expect(lerVinculo(bancada.banco, "email", ENDERECO.semCliente)).toMatchObject({ estado: "auto", cliente: { id: 9301 } });
  });

  test("falha de conexão que uma fonte anterior achou nesta rodada: a fonte não consulta endereço novo", async () => {
    const { conectores } = await ligado(cenario);
    crm.botoes.chamadasAntesDoLimite = 1;
    crm.botoes.limiteHttpS = 30;
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(buscas()).toEqual([]);
    expect(fonte).toMatchObject({ situacao: "leu", cortado: true, semConsultaAoCrm: { motivo: "crm_limite_de_chamadas", erro: { esperaS: 30 } } });
  });

  test("CRM desconectado: nenhuma consulta, e os vínculos que existem continuam valendo", async () => {
    const { conectores } = await ligado(cenario, false);
    gravarVinculoConsultado(bancada.banco, vinculoDe("email", ENDERECO.comProva, { estado: "auto", cliente: { id: 9301, nome: "CANARIO Cliente 9301" as never, cidade: null, uf: null } }, bancada.ambiente.agora()));
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(buscas()).toEqual([]);
    expect(fonte).toMatchObject({ situacao: "leu", cortado: true, semConsultaAoCrm: { motivo: "crm_desconectado" } });
    expect(vinculos()).toEqual({ [ENDERECO.comProva]: "auto" });
  });

  test("falha de uma consulta que não é de conexão segue para o próximo endereço", async () => {
    const { conectores } = await ligado([mensagem(1, ENDERECO.comProva), mensagem(2, ENDERECO.semCliente)]);
    crm.botoes.ferramentasMalformadas.add("buscar_clientes");
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(buscas().length).toBe(2);
    expect(fonte).toMatchObject({ situacao: "leu", cortado: true });
    expect("semConsultaAoCrm" in fonte).toBe(false);
    expect(listarVinculos(bancada.banco, "email").size).toBe(0);
  });

  test("depois do parar() nenhuma consulta sai e nada é gravado", async () => {
    const { conectores } = await ligado(cenario);
    let soltar: () => void = () => {};
    // Segura a primeira busca por endereço: as fontes do CRM, antes dela, passam.
    const chegou = new Promise<void>((resolver) => {
      crm.botoes.aoChamar = (nome) => {
        if (nome !== "buscar_clientes" || crm.botoes.segurar !== null) return;
        crm.botoes.segurar = new Promise<void>((liberar) => (soltar = liberar));
        resolver();
      };
    });
    const rodada = conectores.sincronizar();
    await chegou;
    const parada = conectores.parar();
    crm.botoes.segurar = null;
    soltar();
    await Promise.all([rodada, parada]);
    expect(buscas().length).toBe(1);
  });

  test("o registro leva só o código do erro: nunca o endereço, o nome nem o assunto", async () => {
    const { conectores } = await ligado([mensagem(1, ENDERECO.comProva)]);
    crm.botoes.ferramentasMalformadas.add("buscar_clientes");
    await conectores.sincronizar();
    const registro = bancada.linhasDoRegistro.join("\n");
    expect(registro).toContain("consulta_de_endereco_falhou");
    for (const proibido of [ENDERECO.comProva, NOME_CANARIO, ASSUNTO_CANARIO, "CANARIO-CORPO"]) expect(registro).not.toContain(proibido);
  });

  test("com o e-mail pulado ou sem conta, não há consulta", async () => {
    crm = iniciarCrmFalso({ agora: () => Date.now() });
    bancada = montarBancada({ crmRecurso: crm.recurso, crmClientId: crm.clientId });
    const conectores = bancada.ligar();
    await conectores.pronto;
    const pedido = await conectores.agir("crm", "conectar");
    if (!pedido.ok || pedido.dados.urlAutorizacao === null) throw new Error("o CRM não devolveu a URL de login");
    await conectores.retornoDoCrm(await crm.autorizar(pedido.dados.urlAutorizacao));
    const rodada = await conectores.sincronizar();
    expect(fonteEmail(rodada)).toEqual({ fonte: "email", situacao: "pulada", motivo: "email_sem_conta" });
    expect(buscas()).toEqual([]);
  });
});
