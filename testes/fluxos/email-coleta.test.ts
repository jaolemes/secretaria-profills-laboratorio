import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { conhecidoDaConta, lidoEmDasContas, listarCabecalhos, lerCabecalhoDeEmail } from "../../nucleo/banco";
import type { Conectores, OpcoesDosConectores, ResultadoDaFonte, Sincronizacao } from "../../nucleo/conectores";
import type { ContaEmailComEstado, IdContaEmail } from "../../nucleo/dominio";
import { contaAssentada, esperar, montarBancada, type Bancada } from "../falsos/bancada";
import { gerarCertificado } from "../falsos/certificado";
import { iniciarImapFalso, type ImapFalso, type MensagemDoFalso, type PastaDoFalso } from "../falsos/imap";

// Cada conta abre conexão de verdade; num runner lento de CI os 5 s padrão não bastam.
setDefaultTimeout(30_000);

const certificado = gerarCertificado();
const PROFILLS = "vendedor@exemplo.test";
const PESSOAL = "pessoal@exemplo.test";
const TERCEIRA = "terceira@exemplo.test";
const SENHAS: Record<string, string> = {
  [PROFILLS]: "CANARIO-senha-profills-2k9",
  [PESSOAL]: "CANARIO-senha-pessoal-7m4",
  [TERCEIRA]: "CANARIO-senha-terceira-5p1",
};
const ASSUNTO_CANARIO = "CANARIO-ASSUNTO-do-cliente";
const CLIENTE = "compras@cliente.exemplo.test";

let bancada: Bancada;
const servidores: ImapFalso[] = [];

afterEach(async () => {
  await bancada.limpar();
  await Promise.all(servidores.splice(0).map((servidor) => servidor.parar()));
});

function nova(): Bancada {
  bancada = montarBancada({ caExtra: certificado.certificado });
  return bancada;
}

const minutosAtras = (minutos: number) => new Date(Date.parse(bancada.ambiente.agora()) - minutos * 60_000).toISOString();
const diasAtras = (dias: number) => minutosAtras(dias * 1440);

function mensagem(uid: number, extra: Partial<MensagemDoFalso> = {}): MensagemDoFalso {
  return {
    uid,
    dataInterna: diasAtras(1),
    de: { nome: "Compras Canário", endereco: CLIENTE },
    para: [PROFILLS],
    assunto: `${ASSUNTO_CANARIO} ${uid}`,
    messageId: `<m${uid}@exemplo.test>`,
    corpo: { texto: `CANARIO-CORPO ${uid}` },
    ...extra,
  };
}

const entrada = (mensagens: MensagemDoFalso[], uidValidity = 1731500000): PastaDoFalso => ({ caminho: "INBOX", uidValidity, mensagens });
const enviados = (mensagens: MensagemDoFalso[], uidValidity = 77): PastaDoFalso => ({ caminho: "Enviados", specialUse: "\\Sent", uidValidity, mensagens });

async function imap(caixas: Record<string, PastaDoFalso[]>, extra: { modo?: "trava_no_fetch" } = {}): Promise<ImapFalso> {
  const servidor = await iniciarImapFalso({ seguranca: "tls", certificado, contas: SENHAS, caixas, ...extra });
  servidores.push(servidor);
  return servidor;
}

async function adicionar(conectores: Conectores, servidor: ImapFalso, endereco: string, rotulo: string, extra: Record<string, unknown> = {}): Promise<ContaEmailComEstado> {
  const pedido = await conectores.email.adicionar({ rotulo, provedor: "outro", endereco, servidor: "127.0.0.1", porta: servidor.porta, seguranca: "tls", senha: SENHAS[endereco], ...extra });
  if (!pedido.ok) throw new Error(`adicionar falhou: ${pedido.erro.codigo}`);
  const id = pedido.dados.id;
  await esperar(conectores, (e) => e.email.contas.some((c) => c.id === id && c.estado.fase !== "testando"), "fim do teste da conta");
  await contaAssentada(conectores, id);
  return conectores.estado().email.contas.find((c) => c.id === id)!;
}

function fonteEmail(rodada: Sincronizacao): ResultadoDaFonte {
  const fonte = rodada.fontes.find((candidata) => candidata.fonte === "email");
  if (fonte === undefined) throw new Error("a rodada não tem a fonte email");
  return fonte;
}

const uidsPedidos = (servidor: ImapFalso) =>
  servidor.linhas().flatMap((linha) => {
    const achado = /UID FETCH ([\d,:*]+) \(UID ENVELOPE/.exec(linha);
    return achado?.[1] === undefined ? [] : achado[1].split(",").map(Number);
  });

const guardados = (b: Bancada, contaId: IdContaEmail) =>
  listarCabecalhos(b.banco, { contaId, limite: 200 }).map((c) => `${c.pasta}:${c.uid}`).toSorted();

const ligar = (opcoes: OpcoesDosConectores = {}): Conectores => nova().ligar(opcoes);

describe("a fonte email da sincronização", () => {
  test("sem conta de e-mail: pulada com email_sem_conta, sem erro e sem conexão", async () => {
    const conectores = ligar();
    await conectores.pronto;
    const rodada = await conectores.sincronizar();
    expect(fonteEmail(rodada)).toEqual({ fonte: "email", situacao: "pulada", motivo: "email_sem_conta" });
    expect(rodada.fontes.at(-1)?.fonte).toBe("email");
  });

  test("duas contas, entrada e enviados: lê, guarda, e a segunda rodada não repete nem duplica", async () => {
    const conectores = ligar();
    const a = await imap({
      [PROFILLS]: [entrada([mensagem(1), mensagem(2)]), enviados([mensagem(1, { de: { endereco: PROFILLS }, para: [CLIENTE], assunto: "Resposta do vendedor", emRespostaA: "<m2@exemplo.test>", referencias: ["<m2@exemplo.test>"] })])],
    });
    const b = await imap({ [PESSOAL]: [entrada([mensagem(7, { para: [PESSOAL] })])] });
    await conectores.pronto;
    const contaA = await adicionar(conectores, a, PROFILLS, "Profills");
    const contaB = await adicionar(conectores, b, PESSOAL, "Pessoal");

    const primeira = await conectores.sincronizar();
    const fonte = fonteEmail(primeira);
    // Sem CRM conectado o endereço do cliente fica sem vínculo: a fonte diz que sobrou consulta, e a coleta não foi cortada.
    expect(fonte).toMatchObject({ situacao: "leu", itens: 4, cortado: true, semConsultaAoCrm: { motivo: "crm_desconectado" } });
    expect(fonte.situacao === "leu" && fonte.contas).toEqual([
      { id: contaA.id, rotulo: "Profills", situacao: "leu", novos: 3, cortado: false, semEnviados: false, ilegiveis: 0 },
      { id: contaB.id, rotulo: "Pessoal", situacao: "leu", novos: 1, cortado: false, semEnviados: true, ilegiveis: 0 },
    ]);
    expect(guardados(bancada, contaA.id)).toEqual(["enviados:1", "entrada:1", "entrada:2"].toSorted());
    expect(guardados(bancada, contaB.id)).toEqual(["entrada:7"]);
    const lista = listarCabecalhos(bancada.banco, { contaId: contaA.id, limite: 10 });
    expect(new Set(lista.map((c) => c.conversa))).toEqual(new Set(["m:m1@exemplo.test", "m:m2@exemplo.test"]));
    expect(lista.find((c) => c.pasta === "enviados")).toMatchObject({ daConta: true, assunto: "Resposta do vendedor", conversa: "m:m2@exemplo.test" });
    expect(lidoEmDasContas(bancada.banco).size).toBe(2);
    const pedidosA = uidsPedidos(a).length;

    const segunda = await conectores.sincronizar();
    expect(fonteEmail(segunda)).toMatchObject({ situacao: "leu", itens: 4 });
    expect(uidsPedidos(a)).toHaveLength(pedidosA);
    expect(guardados(bancada, contaA.id)).toHaveLength(3);
    expect(conhecidoDaConta(bancada.banco, contaA.id).entrada.uids).toEqual(new Set([1, 2]));
  });

  test("mensagem nova entra, a fora da janela não entra, e trocar a janela de 90 para 30 apaga o que saiu", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1, { dataInterna: diasAtras(50) }), mensagem(2, { dataInterna: diasAtras(10) }), mensagem(3, { dataInterna: diasAtras(100) })])] });
    await conectores.pronto;
    const conta = await adicionar(conectores, servidor, PROFILLS, "Profills", { janelaDias: 90 });

    await conectores.sincronizar();
    expect(guardados(bancada, conta.id)).toEqual(["entrada:1", "entrada:2"]);

    servidor.caixa(PROFILLS, "INBOX").mensagens.push(mensagem(4, { dataInterna: minutosAtras(5) }));
    await conectores.sincronizar();
    expect(guardados(bancada, conta.id)).toEqual(["entrada:1", "entrada:2", "entrada:4"]);

    const mudou = await conectores.email.mudar(conta.id, { janelaDias: 30 });
    expect(mudou.ok).toBe(true);
    await conectores.sincronizar();
    expect(guardados(bancada, conta.id)).toEqual(["entrada:2", "entrada:4"]);
  });

  test("mensagem que sumiu do servidor continua no banco até sair da janela", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1), mensagem(2)])] });
    await conectores.pronto;
    const conta = await adicionar(conectores, servidor, PROFILLS, "Profills");
    await conectores.sincronizar();
    servidor.caixa(PROFILLS, "INBOX").mensagens.splice(0, 1);
    await conectores.sincronizar();
    expect(guardados(bancada, conta.id)).toEqual(["entrada:1", "entrada:2"]);
  });

  test("UIDVALIDITY diferente recoleta a pasta, e o id antigo deixa de achar a mensagem", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1), mensagem(2)])] });
    await conectores.pronto;
    const conta = await adicionar(conectores, servidor, PROFILLS, "Profills");
    await conectores.sincronizar();
    expect(lerCabecalhoDeEmail(bancada.banco, conta.id, { pasta: "entrada", uidValidity: "1731500000", uid: 1 })).not.toBeNull();

    const pasta = servidor.caixa(PROFILLS, "INBOX");
    pasta.uidValidity = 424242;
    pasta.mensagens.splice(0, 2, mensagem(1, { assunto: "Outra mensagem, mesmo uid" }));
    const pedidosAntes = uidsPedidos(servidor).length;
    await conectores.sincronizar();
    expect(uidsPedidos(servidor).slice(pedidosAntes)).toEqual([1]);
    expect(lerCabecalhoDeEmail(bancada.banco, conta.id, { pasta: "entrada", uidValidity: "1731500000", uid: 1 })).toBeNull();
    expect(lerCabecalhoDeEmail(bancada.banco, conta.id, { pasta: "entrada", uidValidity: "424242", uid: 1 })?.cabecalho.assunto).toBe("Outra mensagem, mesmo uid" as never);
    expect(guardados(bancada, conta.id)).toEqual(["entrada:1"]);
  });

  test("passou do teto: cortado verdadeiro, e as rodadas seguintes completam", async () => {
    const conectores = ligar({ limites: { tetoDeEmailPorPasta: 2 } });
    const servidor = await imap({ [PROFILLS]: [entrada([1, 2, 3, 4, 5].map((uid) => mensagem(uid)))] });
    await conectores.pronto;
    const conta = await adicionar(conectores, servidor, PROFILLS, "Profills");

    const primeira = fonteEmail(await conectores.sincronizar());
    expect(primeira).toMatchObject({ situacao: "leu", itens: 2, cortado: true });
    expect(primeira.situacao === "leu" && primeira.contas?.[0]).toMatchObject({ situacao: "leu", novos: 2, cortado: true });
    expect(guardados(bancada, conta.id)).toEqual(["entrada:4", "entrada:5"]);
    expect(lidoEmDasContas(bancada.banco).has(conta.id)).toBe(false);

    expect(fonteEmail(await conectores.sincronizar())).toMatchObject({ itens: 4, cortado: true });
    const ultima = fonteEmail(await conectores.sincronizar());
    // O `cortado` da fonte também conta o endereço sem vínculo (sem CRM aqui): o da conta é o da coleta.
    expect(ultima).toMatchObject({ situacao: "leu", itens: 5 });
    expect(ultima.situacao === "leu" && ultima.contas?.[0]).toMatchObject({ cortado: false });
    expect(guardados(bancada, conta.id)).toHaveLength(5);
    expect(lidoEmDasContas(bancada.banco).has(conta.id)).toBe(true);
    expect(uidsPedidos(servidor)).toEqual([5, 4, 3, 2, 1]);
  });

  test("uma conta com a senha recusada e a outra boa: a boa é lida, e a linha da ruim traz o erro", async () => {
    const conectores = ligar();
    const ruim = await imap({ [PESSOAL]: [entrada([mensagem(9, { para: [PESSOAL] })])] });
    const boa = await imap({ [PROFILLS]: [entrada([mensagem(1)])] });
    await conectores.pronto;
    const contaRuim = await adicionar(conectores, ruim, PESSOAL, "Pessoal");
    const contaBoa = await adicionar(conectores, boa, PROFILLS, "Profills");
    // O servidor passa a recusar a senha depois de a conta estar conectada.
    SENHAS[PESSOAL] = "CANARIO-senha-trocada-no-servidor";
    try {
      const rodada = await conectores.sincronizar();
      const fonte = fonteEmail(rodada);
      expect(fonte).toMatchObject({ situacao: "leu", itens: 1 });
      expect(fonte.situacao === "leu" && fonte.contas?.map((c) => [c.rotulo, c.situacao])).toEqual([
        ["Pessoal", "falhou"],
        ["Profills", "leu"],
      ]);
      const linhaRuim = fonte.situacao === "leu" ? fonte.contas?.[0] : undefined;
      expect(linhaRuim).toMatchObject({ situacao: "falhou", erro: { codigo: "email_senha_recusada" } });
      expect(guardados(bancada, contaBoa.id)).toEqual(["entrada:1"]);
      expect(guardados(bancada, contaRuim.id)).toEqual([]);
      // A coleta só pede a reconciliação; é a máquina da conta que a leva a atenção.
      await esperar(conectores, (e) => e.email.contas.find((c) => c.id === contaRuim.id)?.estado.fase === "atencao", "conta com a senha recusada em atenção");
      expect(conectores.estado().email.contas.find((c) => c.id === contaBoa.id)?.estado.fase).toBe("conectado");
    } finally {
      SENHAS[PESSOAL] = "CANARIO-senha-pessoal-7m4";
    }
  });

  test("todas as contas tentadas falharam: a fonte falha com o erro da primeira", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1)])], [PESSOAL]: [entrada([mensagem(2)])] });
    await conectores.pronto;
    await adicionar(conectores, servidor, PROFILLS, "Profills");
    await adicionar(conectores, servidor, PESSOAL, "Pessoal");
    const antes = { ...SENHAS };
    SENHAS[PROFILLS] = "CANARIO-trocada-1";
    SENHAS[PESSOAL] = "CANARIO-trocada-2";
    try {
      const fonte = fonteEmail(await conectores.sincronizar());
      expect(fonte).toMatchObject({ situacao: "falhou", erro: { codigo: "email_senha_recusada" } });
      expect(fonte.situacao === "falhou" && fonte.contas?.map((c) => c.situacao)).toEqual(["falhou", "falhou"]);
    } finally {
      Object.assign(SENHAS, antes);
    }
  });

  test("conta desconectada ou em atenção é pulada sem nenhum comando no IMAP", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1)])], [PESSOAL]: [entrada([mensagem(2)])] });
    await conectores.pronto;
    const desligada = await adicionar(conectores, servidor, PROFILLS, "Profills");
    const SENHA_ERRADA = "CANARIO-senha-errada-xx";
    const atencao = await adicionar(conectores, servidor, PESSOAL, "Pessoal", { senha: SENHA_ERRADA });
    expect(atencao.estado.fase).toBe("atencao");
    expect((await conectores.email.agir(desligada.id, "desconectar")).ok).toBe(true);
    await esperar(conectores, (e) => e.email.contas.find((c) => c.id === desligada.id)?.estado.fase === "desconectado", "conta desconectada");
    await contaAssentada(conectores, desligada.id);

    const antes = servidor.comandos().length;
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(servidor.comandos()).toHaveLength(antes);
    expect(fonte).toMatchObject({ situacao: "pulada", motivo: "email_sem_conta_conectada" });
    expect(fonte.contas?.map((c) => [c.rotulo, c.situacao, c.situacao === "pulada" ? c.motivo : null])).toEqual([
      ["Profills", "pulada", "desconectado"],
      ["Pessoal", "pulada", "em_atencao"],
    ]);
  });

  test("com uma conta conectada e outra desconectada, só a conectada é lida", async () => {
    const conectores = ligar();
    const a = await imap({ [PROFILLS]: [entrada([mensagem(1)])] });
    const b = await imap({ [PESSOAL]: [entrada([mensagem(2)])] });
    await conectores.pronto;
    await adicionar(conectores, a, PROFILLS, "Profills");
    const desligada = await adicionar(conectores, b, PESSOAL, "Pessoal");
    await conectores.email.agir(desligada.id, "desconectar");
    await esperar(conectores, (e) => e.email.contas.find((c) => c.id === desligada.id)?.estado.fase === "desconectado", "conta desconectada");
    await contaAssentada(conectores, desligada.id);
    const antes = b.comandos().length;
    const fonte = fonteEmail(await conectores.sincronizar());
    expect(b.comandos()).toHaveLength(antes);
    expect(fonte).toMatchObject({ situacao: "leu", itens: 1 });
    expect(fonte.situacao === "leu" && fonte.contas?.map((c) => [c.rotulo, c.situacao, c.situacao === "pulada" ? c.motivo : null])).toEqual([
      ["Profills", "leu", null],
      ["Pessoal", "pulada", "desconectado"],
    ]);
  });

  test("o prazo da rodada corta um FETCH travado: nada daquela conta é gravado, as lidas ficam e as que faltam saem puladas", async () => {
    const conectores = ligar({ limites: { prazoDaRodadaMs: 600 } });
    const a = await imap({ [PROFILLS]: [entrada([mensagem(1)])] });
    const travado = await imap({ [PESSOAL]: [entrada([mensagem(2)])] }, { modo: "trava_no_fetch" });
    const c = await imap({ [TERCEIRA]: [entrada([mensagem(3)])] });
    await conectores.pronto;
    const contaA = await adicionar(conectores, a, PROFILLS, "Profills");
    const contaB = await adicionar(conectores, travado, PESSOAL, "Pessoal");
    const contaC = await adicionar(conectores, c, TERCEIRA, "Terceira");
    const comandosDeC = c.comandos().length;

    const fonte = fonteEmail(await conectores.sincronizar());
    expect(fonte).toMatchObject({ situacao: "leu", itens: 1 });
    expect(fonte.situacao === "leu" && fonte.contas?.map((linha) => [linha.rotulo, linha.situacao])).toEqual([
      ["Profills", "leu"],
      ["Pessoal", "falhou"],
      ["Terceira", "pulada"],
    ]);
    const linhas = fonte.situacao === "leu" ? fonte.contas : undefined;
    expect(linhas?.[1]).toMatchObject({ erro: { codigo: "email_prazo_da_leitura" } });
    expect(linhas?.[2]).toMatchObject({ motivo: "prazo" });
    expect(travado.comandos()).toContain("UID FETCH");
    expect(c.comandos()).toHaveLength(comandosDeC);
    expect(guardados(bancada, contaA.id)).toEqual(["entrada:1"]);
    expect(guardados(bancada, contaB.id)).toEqual([]);
    expect(guardados(bancada, contaC.id)).toEqual([]);
    expect(bancada.banco.sqlite.query("SELECT conta_id FROM email_cursor WHERE conta_id = ?").all(contaB.id)).toEqual([]);
  });

  test("o registro leva só código, contagens e o id da conta: nem assunto, nem nome, nem endereço de terceiro, nem corpo", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1), mensagem(2, { de: { endereco: "sem-arroba" } })])] });
    await conectores.pronto;
    await adicionar(conectores, servidor, PROFILLS, "Profills");
    await conectores.sincronizar();
    const registro = bancada.linhasDoRegistro.join("\n");
    expect(registro).toContain("sincronizacao.email_ilegiveis");
    for (const proibido of [ASSUNTO_CANARIO, "Compras Canário", CLIENTE, "CANARIO-CORPO", ...Object.values(SENHAS)]) expect(registro).not.toContain(proibido);
  });

  test("só leitura: depois de sincronizar, nenhum comando que muda a caixa", async () => {
    const conectores = ligar();
    const servidor = await imap({ [PROFILLS]: [entrada([mensagem(1)]), enviados([mensagem(1)])] });
    await conectores.pronto;
    await adicionar(conectores, servidor, PROFILLS, "Profills");
    await conectores.sincronizar();
    const comandos = servidor.comandos();
    expect(comandos).toContain("EXAMINE");
    for (const proibido of ["SELECT", "STORE", "UID STORE", "COPY", "UID COPY", "MOVE", "UID MOVE", "EXPUNGE", "UID EXPUNGE", "APPEND", "DELETE", "CLOSE"]) expect(comandos).not.toContain(proibido);
  });
});
