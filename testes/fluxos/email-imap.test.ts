import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Segredo } from "../../nucleo/cofre";
import {
  MAXIMO_DO_CORPO_BYTES,
  TETO_POR_PASTA,
  coletarCabecalhos,
  lerCorpoDoEmail,
  type EntradaDaColeta,
} from "../../nucleo/conectores/email/imap";
import type { ConhecidoDaConta, ConfigEmail, EnderecoEmail, Instante } from "../../nucleo/dominio";
import { gerarCertificado } from "../falsos/certificado";
import { iniciarImapFalso, type ImapFalso, type MensagemDoFalso, type PastaDoFalso } from "../falsos/imap";

setDefaultTimeout(30_000);

const certificado = gerarCertificado();
const ENDERECO = "vendedor@exemplo.test";
const SENHA = "CANARIO-senha-imap-leitura-4d8";
const AGORA = "2026-11-13T12:00:00.000Z" as Instante;
const servidores: ImapFalso[] = [];

afterEach(async () => {
  await Promise.all(servidores.splice(0).map((servidor) => servidor.parar()));
});

const diasAtras = (dias: number) => new Date(Date.parse(AGORA) - dias * 86_400_000).toISOString();

function mensagem(uid: number, extra: Partial<MensagemDoFalso> = {}): MensagemDoFalso {
  return {
    uid,
    dataInterna: diasAtras(1),
    de: { nome: "Compras Canário", endereco: "compras@cliente.exemplo.test" },
    para: [ENDERECO],
    assunto: `Pedido número ${uid}`,
    messageId: `<m${uid}@exemplo.test>`,
    corpo: { texto: `Corpo ${uid}` },
    ...extra,
  };
}

const entrada = (mensagens: MensagemDoFalso[], uidValidity = 1731500000): PastaDoFalso => ({ caminho: "INBOX", uidValidity, mensagens });
const enviados = (mensagens: MensagemDoFalso[], uidValidity = 77): PastaDoFalso => ({ caminho: "Enviados", specialUse: "\\Sent", uidValidity, mensagens });

async function subir(pastas: PastaDoFalso[], extra: { objectId?: boolean; modo?: "trava_no_fetch" } = {}): Promise<{ servidor: ImapFalso; config: ConfigEmail }> {
  const servidor = await iniciarImapFalso({ seguranca: "tls", certificado, contas: { [ENDERECO]: SENHA }, caixas: { [ENDERECO]: pastas }, ...extra });
  servidores.push(servidor);
  return { servidor, config: { endereco: ENDERECO as EnderecoEmail, servidor: "127.0.0.1", porta: servidor.porta, seguranca: "tls" } };
}

const SEM_NADA: ConhecidoDaConta = {
  entrada: { caminho: null, uidValidity: null, uids: new Set() },
  enviados: { caminho: null, uidValidity: null, uids: new Set() },
};

function entradaDaColeta(config: ConfigEmail, extra: Partial<EntradaDaColeta> = {}): EntradaDaColeta {
  return { config, senha: Segredo.de(SENHA), caExtra: certificado.certificado, janelaDias: 30, agora: AGORA, conhecido: SEM_NADA, ...extra };
}

async function coletar(config: ConfigEmail, extra: Partial<EntradaDaColeta> = {}, sinal?: AbortSignal) {
  const resultado = await coletarCabecalhos(entradaDaColeta(config, extra), sinal);
  if (!resultado.ok) throw new Error(`coleta falhou: ${resultado.motivo}`);
  return resultado.coleta;
}

const uidsPedidos = (servidor: ImapFalso) =>
  servidor.linhas().flatMap((linha) => {
    const achado = /UID FETCH ([\d,:*]+) \(UID ENVELOPE/.exec(linha);
    return achado?.[1] === undefined ? [] : achado[1].split(",").map(Number);
  });

describe("coleta de cabeçalhos pelo IMAP", () => {
  test("lê a entrada e a pasta com \\Sent, sem corpo, e acha a pasta pelo specialUse", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1), mensagem(2)]), enviados([mensagem(1, { de: { endereco: ENDERECO }, para: ["compras@cliente.exemplo.test"] })])]);
    const coleta = await coletar(config);
    expect(coleta.semEnviados).toBe(false);
    expect(coleta.pastas.map((p) => [p.pasta, p.caminho, p.uidValidity, p.cabecalhos.length, p.cortado, p.ilegiveis])).toEqual([
      ["entrada", "INBOX", "1731500000", 2, false, 0],
      ["enviados", "Enviados", "77", 1, false, 0],
    ]);
    expect(coleta.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([2, 1]);
    expect(coleta.pastas[0]?.cabecalhos[0]).toMatchObject({ assunto: "Pedido número 2", remetenteNome: "Compras Canário", messageId: "m2@exemplo.test" });
    expect(coleta.pastas[1]?.cabecalhos[0]).toMatchObject({ pasta: "enviados", daConta: true });
    expect(servidor.linhas().join("\n")).not.toContain("BODY.PEEK[1");
  });

  test("a pasta de enviados acha-se pelo specialUse, qualquer que seja o nome", async () => {
    const { config } = await subir([entrada([mensagem(1)]), { caminho: "Itens do vendedor", specialUse: "\\Sent", uidValidity: 3, mensagens: [mensagem(5)] }]);
    const coleta = await coletar(config);
    expect(coleta.pastas[1]).toMatchObject({ pasta: "enviados", caminho: "Itens do vendedor" });
  });

  test("sem pasta de enviados, lê só a entrada e diz semEnviados", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1)]), { caminho: "Rascunhos", specialUse: "\\Drafts", uidValidity: 2, mensagens: [mensagem(9)] }]);
    const coleta = await coletar(config);
    expect(coleta.semEnviados).toBe(true);
    expect(coleta.pastas.map((p) => p.pasta)).toEqual(["entrada"]);
    expect(servidor.linhas().filter((linha) => linha.includes("EXAMINE"))).toHaveLength(1);
  });

  test("mensagem fora da janela não entra e uma só dentro entra, com o corte exato pelo instante", async () => {
    const { config } = await subir([
      entrada([mensagem(1, { dataInterna: diasAtras(45) }), mensagem(2, { dataInterna: diasAtras(29) }), mensagem(3, { dataInterna: diasAtras(30.4) }), mensagem(4, { dataInterna: diasAtras(29.9) })]),
    ]);
    const coleta = await coletar(config);
    expect(coleta.pastas[0]?.cabecalhos.map((c) => c.uid).toSorted()).toEqual([2, 4]);
    const larga = await coletar(config, { janelaDias: 60 });
    expect(larga.pastas[0]?.cabecalhos.map((c) => c.uid).toSorted()).toEqual([1, 2, 3, 4]);
  });

  test("pede só os uids que o banco ainda não tem, dos mais novos para os mais antigos", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1), mensagem(2), mensagem(3), mensagem(4)])]);
    const conhecido: ConhecidoDaConta = { ...SEM_NADA, entrada: { caminho: "INBOX", uidValidity: "1731500000", uids: new Set([1, 3]) } };
    const coleta = await coletar(config, { conhecido });
    expect(coleta.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([4, 2]);
    expect(uidsPedidos(servidor)).toEqual([4, 2]);
  });

  test("UIDVALIDITY diferente do guardado trata a pasta como vazia e recoleta a janela", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1), mensagem(2)], 999)]);
    const conhecido: ConhecidoDaConta = { ...SEM_NADA, entrada: { caminho: "INBOX", uidValidity: "1731500000", uids: new Set([1, 2]) } };
    const coleta = await coletar(config, { conhecido });
    expect(coleta.pastas[0]).toMatchObject({ uidValidity: "999", cortado: false });
    expect(coleta.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([2, 1]);
    expect(uidsPedidos(servidor)).toEqual([2, 1]);
  });

  test("passou do teto: cortado verdadeiro e os mais novos primeiro; a rodada seguinte completa", async () => {
    expect(TETO_POR_PASTA).toBe(500);
    const { servidor, config } = await subir([entrada([1, 2, 3, 4, 5].map((uid) => mensagem(uid)))]);
    const primeira = await coletar(config, { teto: 3 });
    expect(primeira.pastas[0]).toMatchObject({ cortado: true });
    expect(primeira.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([5, 4, 3]);
    const conhecido: ConhecidoDaConta = { ...SEM_NADA, entrada: { caminho: "INBOX", uidValidity: "1731500000", uids: new Set([3, 4, 5]) } };
    const segunda = await coletar(config, { teto: 3, conhecido });
    expect(segunda.pastas[0]).toMatchObject({ cortado: false });
    expect(segunda.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([2, 1]);
    expect(uidsPedidos(servidor)).toEqual([5, 4, 3, 2, 1]);
  });

  test("mensagem sem remetente válido não entra e conta como ilegível", async () => {
    const { config } = await subir([entrada([mensagem(1, { de: { endereco: "sem-arroba" } }), mensagem(2)])]);
    const coleta = await coletar(config);
    expect(coleta.pastas[0]).toMatchObject({ ilegiveis: 1 });
    expect(coleta.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([2]);
  });

  test("o servidor muda e o teste muda junto: mensagem nova entra e UIDVALIDITY novo vale", async () => {
    const pasta = entrada([mensagem(1)]);
    const { config } = await subir([pasta]);
    expect((await coletar(config)).pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([1]);
    pasta.mensagens.push(mensagem(2));
    pasta.uidValidity = 4242;
    const depois = await coletar(config);
    expect(depois.pastas[0]?.uidValidity).toBe("4242");
    expect(depois.pastas[0]?.cabecalhos.map((c) => c.uid)).toEqual([2, 1]);
  });

  test("cabeçalhos de automático e References chegam ao cabeçalho montado", async () => {
    const { config } = await subir([
      entrada([
        mensagem(1, { listUnsubscribe: "<mailto:sair@exemplo.test>", precedence: "bulk", referencias: ["<raiz@exemplo.test>", "<meio@exemplo.test>"], emRespostaA: "<meio@exemplo.test>" }),
        mensagem(2, { autoSubmitted: "auto-replied" }),
        mensagem(3),
      ]),
    ]);
    const [tres, dois, um] = (await coletar(config)).pastas[0]!.cabecalhos;
    expect([um?.automatico, dois?.automatico, tres?.automatico]).toEqual([true, true, false]);
    expect(um?.conversa).toBe("m:raiz@exemplo.test");
  });

  test("threadId só aparece quando o servidor anuncia OBJECTID", async () => {
    const mensagens = [mensagem(1, { threadId: "1850" }), mensagem(2, { threadId: "1850" })];
    const sem = await subir([entrada(mensagens)]);
    expect((await coletar(sem.config)).pastas[0]?.cabecalhos.map((c) => c.conversa)).toEqual(["m:m2@exemplo.test", "m:m1@exemplo.test"]);
    const com = await subir([entrada(mensagens)], { objectId: true });
    expect((await coletar(com.config)).pastas[0]?.cabecalhos.map((c) => c.conversa)).toEqual(["t:1850", "t:1850"]);
  });

  test("assunto e nome com acento chegam decodificados da palavra codificada", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1, { assunto: "Orçamento urgente: peça nº 7", de: { nome: "João Canário", endereco: "joao@cliente.exemplo.test" } })])]);
    const coleta = await coletar(config);
    expect(coleta.pastas[0]?.cabecalhos[0]).toMatchObject({ assunto: "Orçamento urgente: peça nº 7", remetenteNome: "João Canário" });
    expect(servidor.linhas().length).toBeGreaterThan(0);
  });

  test("só leitura: depois de coletar e de ler um corpo, só EXAMINE e comandos de leitura", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1)]), enviados([mensagem(1)])]);
    await coletar(config);
    const lido = await lerCorpoDoEmail({ config, senha: Segredo.de(SENHA), caExtra: certificado.certificado, caminho: "INBOX", uidValidity: "1731500000", uid: 1 });
    expect(lido.ok).toBe(true);
    const comandos = servidor.comandos();
    expect(comandos).toContain("EXAMINE");
    for (const proibido of ["SELECT", "STORE", "UID STORE", "COPY", "UID COPY", "MOVE", "UID MOVE", "EXPUNGE", "UID EXPUNGE", "APPEND", "DELETE", "CLOSE", "CREATE", "RENAME"]) {
      expect(comandos).not.toContain(proibido);
    }
    expect(new Set(comandos)).toEqual(new Set(["LOGIN", "LIST", "LSUB", "EXAMINE", "UID SEARCH", "UID FETCH", "LOGOUT"]));
    expect(servidor.linhas().filter((linha) => linha.includes("UID FETCH") && linha.includes("BODY["))).toEqual([]);
    expect(servidor.linhas().filter((linha) => /BODY\[/.test(linha))).toEqual([]);
  });

  test("senha recusada vira FalhaDoImap, sem a senha no detalhe", async () => {
    const { config } = await subir([entrada([])]);
    const resultado = await coletarCabecalhos(entradaDaColeta(config, { senha: Segredo.de("CANARIO-senha-errada") }));
    expect(resultado).toMatchObject({ ok: false, motivo: "senha_recusada" });
    expect(JSON.stringify(resultado)).not.toContain("CANARIO-senha-errada");
  });

  test("o sinal de aborto fecha a conexão num FETCH travado", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1)])], { modo: "trava_no_fetch" });
    const resultado = await coletarCabecalhos(entradaDaColeta(config), AbortSignal.timeout(1500));
    expect(resultado.ok).toBe(false);
    expect(servidor.comandos()).toContain("UID FETCH");
  });

  test("sinal já abortado não abre conexão", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1)])]);
    const resultado = await coletarCabecalhos(entradaDaColeta(config), AbortSignal.abort());
    expect(resultado.ok).toBe(false);
    expect(servidor.comandos()).toEqual([]);
  });
});

describe("leitura do corpo pelo IMAP", () => {
  async function corpo(m: MensagemDoFalso, uidValidity = "1731500000", uid = m.uid) {
    const { config } = await subir([entrada([m])]);
    return lerCorpoDoEmail({ config, senha: Segredo.de(SENHA), caExtra: certificado.certificado, caminho: "INBOX", uidValidity, uid });
  }

  test("text/plain", async () => {
    const lido = await corpo(mensagem(1, { corpo: { texto: "Bom dia, preciso de orçamento." } }));
    expect(lido).toMatchObject({ ok: true, corpo: { texto: "Bom dia, preciso de orçamento.", origem: "texto", cortadoNoDownload: false, assunto: "Pedido número 1", nomeDoRemetente: "Compras Canário" } });
  });

  test("só HTML: o texto visível, e o completo traz o comentário", async () => {
    const lido = await corpo(mensagem(1, { corpo: { html: "<p>Segue <b>proposta</b>.</p><!-- CANARIO-COMENTARIO -->" } }));
    expect(lido).toMatchObject({ ok: true, corpo: { texto: "Segue proposta.", origem: "html" } });
    expect(lido.ok && lido.corpo.textoParaSinais).toContain("CANARIO-COMENTARIO");
    expect(lido.ok && lido.corpo.texto).not.toContain("CANARIO-COMENTARIO");
  });

  test("os dois: vale o text/plain", async () => {
    const lido = await corpo(mensagem(1, { corpo: { texto: "versão em texto", html: "<p>versão em html</p>" } }));
    expect(lido).toMatchObject({ ok: true, corpo: { texto: "versão em texto", origem: "texto" } });
  });

  test("nenhum: só anexo, e o anexo de texto não é escolhido", async () => {
    expect(await corpo(mensagem(1, { corpo: {} }))).toMatchObject({ ok: true, corpo: { texto: "", origem: "nenhum" } });
    const comAnexo = await corpo(mensagem(2, { corpo: { anexoDeTexto: "CANARIO-ANEXO" } }));
    expect(comAnexo).toMatchObject({ ok: true, corpo: { texto: "", origem: "nenhum" } });
    expect(JSON.stringify(comAnexo)).not.toContain("CANARIO-ANEXO");
  });

  test("texto com anexo ao lado: lê o corpo e não o anexo", async () => {
    const lido = await corpo(mensagem(1, { corpo: { texto: "o corpo", anexoDeTexto: "CANARIO-ANEXO" } }));
    expect(lido).toMatchObject({ ok: true, corpo: { texto: "o corpo", origem: "texto" } });
  });

  test("HTML em base64 sai decodificado", async () => {
    const lido = await corpo(mensagem(1, { corpo: { html: "<p>Olá, ação</p>", base64: true } }));
    expect(lido).toMatchObject({ ok: true, corpo: { texto: "Olá, ação", origem: "html" } });
  });

  test("passou de 256 KiB: baixa até o limite e marca o corte", async () => {
    const lido = await corpo(mensagem(1, { corpo: { texto: "a".repeat(MAXIMO_DO_CORPO_BYTES + 5000) } }));
    expect(lido.ok && lido.corpo.cortadoNoDownload).toBe(true);
    expect(lido.ok && lido.corpo.texto.length).toBe(MAXIMO_DO_CORPO_BYTES);
  });

  test("UIDVALIDITY diferente do id: nao_encontrado, sem ler a mensagem", async () => {
    const { servidor, config } = await subir([entrada([mensagem(1)])]);
    const lido = await lerCorpoDoEmail({ config, senha: Segredo.de(SENHA), caExtra: certificado.certificado, caminho: "INBOX", uidValidity: "1", uid: 1 });
    expect(lido).toEqual({ ok: false, motivo: "nao_encontrado" });
    expect(servidor.comandos()).not.toContain("UID FETCH");
  });

  test("uid que não está na pasta: nao_encontrado", async () => {
    expect(await corpo(mensagem(1), "1731500000", 99)).toEqual({ ok: false, motivo: "nao_encontrado" });
  });

  test("pasta que sumiu do servidor vira falha, não nao_encontrado", async () => {
    const { config } = await subir([entrada([mensagem(1)])]);
    const lido = await lerCorpoDoEmail({ config, senha: Segredo.de(SENHA), caExtra: certificado.certificado, caminho: "Outra", uidValidity: "1", uid: 1 });
    expect(lido.ok).toBe(false);
  });
});
