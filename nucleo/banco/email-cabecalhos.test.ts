import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  corteDaJanela,
  lerEnderecoEmail,
  type CabecalhoDeEmail,
  type ColetaDaConta,
  type ColetaDaPasta,
  type ContaEmail,
  type EnderecoEmail,
  type IdContaEmail,
  type Instante,
  type PastaDeEmail,
  type TextoExterno,
} from "../dominio";
import {
  conhecidoDaConta,
  contarCabecalhos,
  garantirInstalacao,
  gravarColetaDeEmail,
  gravarContaEmail,
  inserirContaEmail,
  lerCabecalhoDeEmail,
  lidoEmDasContas,
  listarCabecalhos,
  prepararBanco,
  removerContaEmail,
  type BancoAberto,
} from "./index";

const AGORA = "2026-11-13T12:00:00.000Z" as Instante;
const DEPOIS = "2026-11-13T12:05:00.000Z" as Instante;
const CORTE = corteDaJanela(AGORA, 30);
const pastas: string[] = [];
const abertos: BancoAberto[] = [];

afterEach(() => {
  for (const banco of abertos.splice(0)) banco.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function preparar(): BancoAberto {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-cabecalhos-"));
  pastas.push(pasta);
  const banco = prepararBanco({
    caminho: join(pasta, "secretaria.db"),
    caminhoDoVendedor: join(pasta, "meu.db"),
    dirBackups: join(pasta, "backups"),
    pastaDoVendedor: join(pasta, "meu"),
    agora: AGORA,
  });
  abertos.push(banco);
  garantirInstalacao(banco, AGORA);
  return banco;
}

function conta(banco: BancoAberto, rotulo: string, endereco: string): ContaEmail {
  const nova: ContaEmail = {
    id: crypto.randomUUID() as IdContaEmail,
    rotulo,
    provedor: "outro",
    config: { endereco: lerEnderecoEmail(endereco)!, servidor: "imap.exemplo.test", porta: 993, seguranca: "tls" },
    janelaDias: 30,
  };
  const inserida = inserirContaEmail(banco, nova, AGORA);
  if (!inserida.ok) throw new Error("conta não inserida");
  gravarContaEmail(banco, nova.id, CONECTADO, undefined, "teste_ok", AGORA);
  return nova;
}

const CONECTADO = { fase: "conectado", verificadoEm: AGORA, caixaDeEntrada: { mensagens: 1, naoLidas: 0 } } as const;

function cabecalho(pasta: PastaDeEmail, uid: number, instante: string, extra: Partial<CabecalhoDeEmail> = {}): CabecalhoDeEmail {
  return {
    pasta,
    uid,
    messageId: `m${uid}@exemplo.test`,
    conversa: `m:m${uid}@exemplo.test`,
    remetente: "compras@cliente.exemplo.test" as EnderecoEmail,
    remetenteNome: "Compras Canário" as TextoExterno,
    destinatarios: ["vendedor@exemplo.test" as EnderecoEmail],
    instante: instante as Instante,
    assunto: `Assunto ${uid}` as TextoExterno,
    daConta: pasta === "enviados",
    automatico: false,
    sinaisDoAssunto: [],
    sinaisDoNome: [],
    ...extra,
  };
}

function pasta(pastaDeEmail: PastaDeEmail, uidValidity: string, cabecalhos: CabecalhoDeEmail[], extra: Partial<ColetaDaPasta> = {}): ColetaDaPasta {
  return { pasta: pastaDeEmail, caminho: pastaDeEmail === "entrada" ? "INBOX" : "Sent", uidValidity, cabecalhos, cortado: false, ilegiveis: 0, ...extra };
}

const coleta = (...pastasDaColeta: ColetaDaPasta[]): ColetaDaConta => ({ pastas: pastasDaColeta, semEnviados: false });

function retrato(banco: BancoAberto) {
  return {
    cabecalhos: banco.sqlite.query("SELECT * FROM email_cabecalho ORDER BY conta_id, pasta, uid").all(),
    cursores: banco.sqlite.query("SELECT * FROM email_cursor ORDER BY conta_id, pasta").all(),
  };
}

describe("gravar a coleta", () => {
  test("grava cabeçalhos e cursor, e lista do mais novo para o mais antigo com o id da pasta", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(
      banco,
      a.id,
      coleta(
        pasta("entrada", "1731500000", [cabecalho("entrada", 1, "2026-11-10T10:00:00.000Z"), cabecalho("entrada", 2, "2026-11-12T10:00:00.000Z")]),
        pasta("enviados", "77", [cabecalho("enviados", 1, "2026-11-11T10:00:00.000Z")]),
      ),
      CORTE,
      AGORA,
    );
    const lista = listarCabecalhos(banco, { limite: 50 });
    expect(lista.map((item) => [item.pasta, item.uid, item.uidValidity])).toEqual([
      ["entrada", 2, "1731500000"],
      ["enviados", 1, "77"],
      ["entrada", 1, "1731500000"],
    ]);
    expect(lista[0]).toMatchObject({ contaId: a.id, assunto: "Assunto 2", destinatarios: ["vendedor@exemplo.test"], daConta: false, automatico: false });
    expect(banco.sqlite.query("SELECT pasta, caminho, uid_validity, ultimo_uid, lido_em FROM email_cursor ORDER BY pasta").all()).toEqual([
      { pasta: "entrada", caminho: "INBOX", uid_validity: "1731500000", ultimo_uid: 2, lido_em: AGORA },
      { pasta: "enviados", caminho: "Sent", uid_validity: "77", ultimo_uid: 1, lido_em: AGORA },
    ]);
  });

  test("filtros de conta, remetente e limite", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    const b = conta(banco, "Pessoal", "pessoal@exemplo.test");
    const outro = { remetente: "outra@cliente.exemplo.test" as EnderecoEmail };
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "1", [cabecalho("entrada", 1, "2026-11-10T10:00:00.000Z"), cabecalho("entrada", 2, "2026-11-12T10:00:00.000Z", outro)])), CORTE, AGORA);
    gravarColetaDeEmail(banco, b.id, coleta(pasta("entrada", "1", [cabecalho("entrada", 1, "2026-11-11T10:00:00.000Z")])), CORTE, AGORA);
    expect(listarCabecalhos(banco, { contaId: b.id, limite: 50 })).toHaveLength(1);
    expect(listarCabecalhos(banco, { de: "outra@cliente.exemplo.test" as EnderecoEmail, limite: 50 }).map((item) => item.uid)).toEqual([2]);
    expect(listarCabecalhos(banco, { de: "OUTRA@cliente.exemplo.test" as EnderecoEmail, limite: 50 })).toHaveLength(1);
    expect(listarCabecalhos(banco, { limite: 2 })).toHaveLength(2);
    expect(listarCabecalhos(banco, { limite: 1 })[0]?.instante).toBe("2026-11-12T10:00:00.000Z" as Instante);
  });

  test("rodar duas vezes com o mesmo resultado deixa o banco igual", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    const dados = coleta(pasta("entrada", "5", [cabecalho("entrada", 3, "2026-11-12T10:00:00.000Z")]));
    gravarColetaDeEmail(banco, a.id, dados, CORTE, AGORA);
    const primeiro = retrato(banco);
    gravarColetaDeEmail(banco, a.id, dados, CORTE, AGORA);
    expect(retrato(banco)).toEqual(primeiro);
  });

  test("a segunda coleta acrescenta sem duplicar e o ultimo_uid só sobe", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 10, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 4, "2026-11-12T11:00:00.000Z")])), CORTE, DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 }).map((item) => item.uid)).toEqual([4, 10]);
    expect(banco.sqlite.query("SELECT ultimo_uid, lido_em FROM email_cursor").get()).toEqual({ ultimo_uid: 10, lido_em: DEPOIS });
  });

  test("UIDVALIDITY novo apaga a pasta e recomeça; o id antigo deixa de achar a mensagem", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(
      banco,
      a.id,
      coleta(pasta("entrada", "5", [cabecalho("entrada", 1, "2026-11-12T10:00:00.000Z")]), pasta("enviados", "9", [cabecalho("enviados", 1, "2026-11-12T10:00:00.000Z")])),
      CORTE,
      AGORA,
    );
    expect(lerCabecalhoDeEmail(banco, a.id, { pasta: "entrada", uidValidity: "5", uid: 1 })?.caminho).toBe("INBOX");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "6", [cabecalho("entrada", 2, "2026-11-12T12:00:00.000Z")])), CORTE, DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 }).map((item) => [item.pasta, item.uid, item.uidValidity])).toEqual([
      ["entrada", 2, "6"],
      ["enviados", 1, "9"],
    ]);
    expect(lerCabecalhoDeEmail(banco, a.id, { pasta: "entrada", uidValidity: "5", uid: 1 })).toBeNull();
    expect(lerCabecalhoDeEmail(banco, a.id, { pasta: "entrada", uidValidity: "6", uid: 2 })).not.toBeNull();
    expect(banco.sqlite.query("SELECT ultimo_uid FROM email_cursor WHERE pasta = 'entrada'").get()).toEqual({ ultimo_uid: 2 });
  });

  test("apaga o que tem instante antes do corte, nas duas pastas", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    const velho = "2026-09-01T10:00:00.000Z";
    gravarColetaDeEmail(
      banco,
      a.id,
      coleta(pasta("entrada", "5", [cabecalho("entrada", 1, velho), cabecalho("entrada", 2, "2026-11-12T10:00:00.000Z")]), pasta("enviados", "9", [cabecalho("enviados", 1, velho)])),
      corteDaJanela(AGORA, 90),
      AGORA,
    );
    expect(contarCabecalhos(banco).get(a.id)).toBe(3);
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", []), pasta("enviados", "9", [])), CORTE, DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 }).map((item) => [item.pasta, item.uid])).toEqual([["entrada", 2]]);
  });

  test("sem pasta de enviados, a pasta e o cursor dela saem", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", []), pasta("enviados", "9", [cabecalho("enviados", 1, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    gravarColetaDeEmail(banco, a.id, { pastas: [pasta("entrada", "5", [])], semEnviados: true }, CORTE, DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 })).toEqual([]);
    expect(banco.sqlite.query("SELECT pasta FROM email_cursor").all()).toEqual([{ pasta: "entrada" }]);
  });

  test("conhecido da conta: uids e UIDVALIDITY por pasta, vazio sem cursor", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    expect(conhecidoDaConta(banco, a.id).entrada).toEqual({ caminho: null, uidValidity: null, uids: new Set() });
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 1, "2026-11-12T10:00:00.000Z"), cabecalho("entrada", 8, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    const conhecido = conhecidoDaConta(banco, a.id);
    expect(conhecido.entrada).toEqual({ caminho: "INBOX", uidValidity: "5", uids: new Set([1, 8]) });
    expect(conhecido.enviados.uidValidity).toBeNull();
  });
});

describe("lido_em", () => {
  test("a conta lida inteira tem o lido_em mais antigo das pastas", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [])), CORTE, AGORA);
    gravarColetaDeEmail(banco, a.id, coleta(pasta("enviados", "9", [])), CORTE, DEPOIS);
    expect(lidoEmDasContas(banco).get(a.id)).toBe(AGORA);
  });

  test("pasta cortada no teto não atualiza o lido_em, e a conta nunca lida inteira fica de fora", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 9, "2026-11-12T10:00:00.000Z")], { cortado: true })), CORTE, AGORA);
    expect(lidoEmDasContas(banco).has(a.id)).toBe(false);
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 3, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    expect(lidoEmDasContas(banco).get(a.id)).toBe(AGORA);
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [], { cortado: true })), CORTE, DEPOIS);
    expect(lidoEmDasContas(banco).get(a.id)).toBe(AGORA);
  });
});

describe("a tabela", () => {
  test("remover a conta leva os cabeçalhos e os cursores pela cascata", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    const b = conta(banco, "Pessoal", "pessoal@exemplo.test");
    for (const c of [a, b]) gravarColetaDeEmail(banco, c.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 1, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    removerContaEmail(banco, a.id);
    expect(banco.sqlite.query("SELECT DISTINCT conta_id FROM email_cabecalho").all()).toEqual([{ conta_id: b.id }]);
    expect(banco.sqlite.query("SELECT conta_id FROM email_cursor").all()).toEqual([{ conta_id: b.id }]);
  });

  test("desconectar a conta apaga os cabeçalhos e os cursores dela, e a coleta que chega depois não grava", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    const b = conta(banco, "Pessoal", "pessoal@exemplo.test");
    const dados = coleta(pasta("entrada", "5", [cabecalho("entrada", 1, "2026-11-12T10:00:00.000Z")]));
    for (const c of [a, b]) gravarColetaDeEmail(banco, c.id, dados, CORTE, AGORA);
    gravarContaEmail(banco, a.id, { fase: "desconectado" }, undefined, "pedido_desconectar", DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 }).map((item) => item.contaId)).toEqual([b.id]);
    expect(conhecidoDaConta(banco, a.id).entrada.uids.size).toBe(0);
    expect(banco.sqlite.query("SELECT conta_id FROM email_cursor").all()).toEqual([{ conta_id: b.id }]);
    gravarColetaDeEmail(banco, a.id, dados, CORTE, DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 }).map((item) => item.contaId)).toEqual([b.id]);
    expect(lidoEmDasContas(banco).has(a.id)).toBe(false);
  });

  test("conta em atenção guarda o que já leu", () => {
    const banco = preparar();
    const a = conta(banco, "Profills", "vendedor@exemplo.test");
    gravarColetaDeEmail(banco, a.id, coleta(pasta("entrada", "5", [cabecalho("entrada", 1, "2026-11-12T10:00:00.000Z")])), CORTE, AGORA);
    gravarContaEmail(banco, a.id, { fase: "atencao", problema: { codigo: "email_senha_recusada", desde: DEPOIS } }, undefined, "sondagem", DEPOIS);
    expect(listarCabecalhos(banco, { limite: 50 })).toHaveLength(1);
  });

  describe("os CHECKs recusam INSERT direto", () => {
    const valido: Record<string, string | number | null> = {
      pasta: "entrada",
      uid: 1,
      message_id: null,
      conversa: "u:entrada:1",
      remetente: "x@exemplo.test",
      remetente_nome: null,
      destinatarios: "[]",
      instante: "2026-11-12T10:00:00.000Z",
      assunto: null,
      da_conta: 0,
      automatico: 0,
      sinais_do_assunto: "[]",
      sinais_do_nome: "[]",
    };

    function inserir(banco: BancoAberto, contaId: string, mudanca: Record<string, string | number | null>) {
      const linha = { conta_id: contaId, ...valido, ...mudanca };
      const colunas = Object.keys(linha);
      banco.sqlite.run(`INSERT INTO email_cabecalho (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`, Object.values(linha));
    }

    test("a linha válida entra", () => {
      const banco = preparar();
      const a = conta(banco, "Profills", "vendedor@exemplo.test");
      inserir(banco, a.id, {});
      expect(contarCabecalhos(banco).get(a.id)).toBe(1);
    });

    test.each([
      ["pasta fora da lista", { pasta: "rascunhos" }],
      ["uid zero", { uid: 0 }],
      ["da_conta fora de 0 e 1", { da_conta: 2 }],
      ["automatico fora de 0 e 1", { automatico: -1 }],
      ["destinatarios que não é JSON", { destinatarios: "[x" }],
      ["sinais do assunto que não é JSON", { sinais_do_assunto: "não" }],
      ["sinais do nome que não é JSON", { sinais_do_nome: "{" }],
      ["remetente com maiúscula", { remetente: "Compras@exemplo.test" }],
      ["conversa nula", { conversa: null }],
    ] as const)("%s", (_nome, mudanca) => {
      const banco = preparar();
      const a = conta(banco, "Profills", "vendedor@exemplo.test");
      expect(() => inserir(banco, a.id, mudanca)).toThrow();
    });

    test("conta que não existe é recusada pela chave estrangeira", () => {
      const banco = preparar();
      expect(() => inserir(banco, crypto.randomUUID(), {})).toThrow();
    });

    test("a chave composta recusa o uid repetido na mesma pasta e aceita em outra", () => {
      const banco = preparar();
      const a = conta(banco, "Profills", "vendedor@exemplo.test");
      inserir(banco, a.id, {});
      expect(() => inserir(banco, a.id, {})).toThrow();
      inserir(banco, a.id, { pasta: "enviados" });
    });

    test("o cursor recusa pasta fora da lista e ultimo_uid negativo", () => {
      const banco = preparar();
      const a = conta(banco, "Profills", "vendedor@exemplo.test");
      const cursor = (pastaDoCursor: string, ultimo: number) =>
        banco.sqlite.run("INSERT INTO email_cursor (conta_id, pasta, caminho, uid_validity, ultimo_uid, lido_em) VALUES (?, ?, 'INBOX', '1', ?, NULL)", [a.id, pastaDoCursor, ultimo]);
      expect(() => cursor("lixo", 0)).toThrow();
      expect(() => cursor("entrada", -1)).toThrow();
      cursor("entrada", 0);
    });
  });
});
