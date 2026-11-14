import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject } from "imapflow";
import tls from "node:tls";
import type { Segredo } from "../../cofre";
import {
  corteDaJanela,
  lerCabecalhosDeTexto,
  montarCabecalho,
  textoDoHtml,
  textoExterno,
  type CabecalhoCru,
  type CabecalhoDeEmail,
  type ColetaDaConta,
  type ColetaDaPasta,
  type ConfigEmail,
  type ConhecidoDaConta,
  type CorpoLido,
  type EnderecoCru,
  type FalhaDeLeitura,
  type FalhaDoImap,
  type Instante,
  type JanelaDias,
  type PastaDeEmail,
  type ResultadoDaColeta,
  type ResultadoDoCorpo,
  type ResultadoDoTesteImap,
} from "../../dominio";

/** Cada espera cabe no prazo de 30 s que a máquina dá à fase `testando`. */
const ESPERAS_MS = { conexao: 12_000, saudacao: 8_000, soquete: 15_000 } as const;

const ERROS_DE_CERTIFICADO =
  /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_|ERR_TLS_CERT_ALTNAME_INVALID|HOSTNAME_MISMATCH)/;

interface ErroDoImap {
  readonly message?: unknown;
  readonly code?: unknown;
  readonly authenticationFailed?: unknown;
  readonly responseText?: unknown;
  readonly _err?: unknown;
}

function codigoDe(erro: ErroDoImap): string {
  if (typeof erro.code === "string") return erro.code;
  const interno = erro._err as ErroDoImap | undefined;
  return typeof interno?.code === "string" ? interno.code : "";
}

/** O Gmail com verificação em duas etapas recusa a senha da conta com este texto, pedindo senha de app. */
const PEDE_SENHA_DE_APP = /application-specific password|app password/i;

function motivoDe(erro: ErroDoImap): FalhaDoImap {
  if (erro.authenticationFailed === true) {
    return typeof erro.responseText === "string" && PEDE_SENHA_DE_APP.test(erro.responseText) ? "senha_de_app_exigida" : "senha_recusada";
  }
  return ERROS_DE_CERTIFICADO.test(codigoDe(erro)) ? "certificado_invalido" : "servidor_inacessivel";
}

/** Teto de mensagens pedidas ao servidor por pasta e por rodada. O que passa fica para a rodada seguinte. */
export const TETO_POR_PASTA = 500;
/** Tamanho máximo de um corpo lido. */
export const MAXIMO_DO_CORPO_BYTES = 262_144;
/** Uids por `UID FETCH`: comandos curtos, e o sinal de aborto corta entre um lote e outro. */
const LOTE_DO_FETCH = 100;
const CABECALHOS_PEDIDOS = ["list-unsubscribe", "auto-submitted", "precedence", "references"];

/**
 * O cliente IMAP de toda leitura: teste, coleta e corpo. `starttls` exige a troca para TLS antes do
 * login: a senha nunca cruza a rede em texto puro. Não existe opção de desligar a verificação do
 * certificado; `caExtra` só acrescenta uma CA.
 */
function criarCliente(config: ConfigEmail, senha: Segredo, caExtra: string | null): ImapFlow {
  const cliente = new ImapFlow({
    host: config.servidor,
    port: config.porta,
    secure: config.seguranca === "tls",
    doSTARTTLS: config.seguranca === "starttls" ? true : undefined,
    auth: { user: config.endereco, pass: senha.revelar() },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(caExtra === null ? {} : { ca: [...tls.rootCertificates, caExtra] }),
    },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: ESPERAS_MS.conexao,
    greetingTimeout: ESPERAS_MS.saudacao,
    socketTimeout: ESPERAS_MS.soquete,
  });
  // Erro de soquete depois do `connect` chega como evento; sem ouvinte, derrubaria o processo.
  cliente.on("error", () => {});
  return cliente;
}

function falhaDe(erro: unknown, senha: Segredo): FalhaDeLeitura {
  const falha = (erro ?? {}) as ErroDoImap;
  const texto = [falha.responseText, falha.message].find((parte) => typeof parte === "string" && parte !== "") ?? "sem detalhe";
  // O servidor pode devolver a senha no texto da recusa; ela não segue para o estado nem para a trilha.
  const semSenha = String(texto).split(senha.revelar()).join("[segredo]").slice(0, 300);
  return { ok: false, motivo: motivoDe(falha), detalhe: textoExterno(semSenha) };
}

/**
 * Abre a conexão, roda o trabalho e fecha. O sinal de aborto fecha a conexão em voo, e o trabalho
 * que estava esperando o servidor falha. Falha vira `FalhaDoImap`, sem a senha no texto.
 */
async function comConexao<T>(
  config: ConfigEmail,
  senha: Segredo,
  caExtra: string | null,
  sinal: AbortSignal | undefined,
  trabalho: (cliente: ImapFlow) => Promise<T>,
): Promise<{ readonly ok: true; readonly valor: T } | FalhaDeLeitura> {
  let cliente: ImapFlow | null = null;
  const abortar = () => cliente?.close();
  sinal?.addEventListener("abort", abortar, { once: true });
  try {
    if (sinal?.aborted) throw new Error("leitura cancelada");
    cliente = criarCliente(config, senha, caExtra);
    await cliente.connect();
    const valor = await trabalho(cliente);
    await cliente.logout().catch(() => {});
    return { ok: true, valor };
  } catch (erro) {
    cliente?.close();
    return falhaDe(erro, senha);
  } finally {
    sinal?.removeEventListener("abort", abortar);
  }
}

/**
 * Login, `STATUS INBOX (MESSAGES UNSEEN)` e logout. Não lê mensagem.
 */
export async function testarImap(
  config: ConfigEmail,
  senha: Segredo,
  caExtra: string | null,
  sinal?: AbortSignal,
): Promise<ResultadoDoTesteImap> {
  const feito = await comConexao(config, senha, caExtra, sinal, (cliente) => cliente.status("INBOX", { messages: true, unseen: true }));
  if (!feito.ok) return feito;
  const caixa = feito.valor;
  if (caixa === false) return { ok: false, motivo: "servidor_inacessivel", detalhe: textoExterno("o servidor não informou a caixa de entrada") };
  return { ok: true, mensagens: caixa.messages ?? 0, naoLidas: caixa.unseen ?? 0 };
}

const emEnderecos = (lista: readonly MessageAddressObject[] | undefined): readonly EnderecoCru[] =>
  (lista ?? []).map((item) => ({ nome: item.name ?? null, endereco: item.address ?? null }));

function cabecalhoCruDe(mensagem: FetchMessageObject, pasta: PastaDeEmail): CabecalhoCru {
  const envelope = mensagem.envelope;
  const extras = mensagem.headers === undefined ? new Map<string, string>() : lerCabecalhosDeTexto(mensagem.headers.toString("utf8"));
  return {
    uid: mensagem.uid,
    pasta,
    dataInterna: mensagem.internalDate ?? null,
    dataDoEnvelope: envelope?.date ?? null,
    assunto: envelope?.subject ?? null,
    messageId: envelope?.messageId ?? null,
    emRespostaA: envelope?.inReplyTo ?? null,
    referencias: extras.get("references") ?? null,
    de: emEnderecos(envelope?.from),
    para: emEnderecos(envelope?.to),
    cc: emEnderecos(envelope?.cc),
    threadId: mensagem.threadId ?? null,
    listUnsubscribe: extras.get("list-unsubscribe") ?? null,
    autoSubmitted: extras.get("auto-submitted") ?? null,
    precedence: extras.get("precedence") ?? null,
  };
}

export interface EntradaDaColeta {
  readonly config: ConfigEmail;
  readonly senha: Segredo;
  readonly caExtra: string | null;
  readonly janelaDias: JanelaDias;
  readonly agora: Instante;
  /** O que o banco já tem: a coleta pede só o que falta. */
  readonly conhecido: ConhecidoDaConta;
  /** Sem ele, `TETO_POR_PASTA`. */
  readonly teto?: number;
}

/** O primeiro dia que o `SINCE` pede: um dia antes do corte, porque o servidor compara só o dia, no fuso dele. O corte exato vem do `instante`. */
function diaDaBusca(corte: Instante): Date {
  const dia = new Date(Date.parse(corte) - 86_400_000);
  dia.setUTCHours(0, 0, 0, 0);
  return dia;
}

async function coletarPasta(
  cliente: ImapFlow,
  alvo: { readonly pasta: PastaDeEmail; readonly caminho: string },
  entrada: EntradaDaColeta,
  corte: Instante,
): Promise<ColetaDaPasta> {
  // Só leitura: `EXAMINE`, nunca `SELECT`. Nada aqui marca como lido, move ou apaga.
  const trava = await cliente.getMailboxLock(alvo.caminho, { readOnly: true });
  try {
    const caixa = cliente.mailbox;
    if (caixa === false) throw new Error("o servidor não abriu a pasta");
    const uidValidity = String(caixa.uidValidity);
    const conhecido = entrada.conhecido[alvo.pasta];
    // `UIDVALIDITY` novo: os uids guardados apontam para outras mensagens, e a janela é lida de novo.
    const jaTenho = conhecido.uidValidity === uidValidity ? conhecido.uids : new Set<number>();
    const achados = await cliente.search({ since: diaDaBusca(corte) }, { uid: true });
    const faltam = (Array.isArray(achados) ? achados : []).filter((uid) => !jaTenho.has(uid)).toSorted((a, b) => b - a);
    const teto = entrada.teto ?? TETO_POR_PASTA;
    const pedidos = faltam.slice(0, teto);
    const cabecalhos: CabecalhoDeEmail[] = [];
    let ilegiveis = 0;
    for (let inicio = 0; inicio < pedidos.length; inicio += LOTE_DO_FETCH) {
      const lote = pedidos.slice(inicio, inicio + LOTE_DO_FETCH);
      const lidas = await cliente.fetchAll(
        lote,
        { uid: true, envelope: true, internalDate: true, threadId: true, headers: CABECALHOS_PEDIDOS },
        { uid: true },
      );
      for (const mensagem of lidas) {
        const cabecalho = montarCabecalho(cabecalhoCruDe(mensagem, alvo.pasta), entrada.config.endereco);
        if (cabecalho === null) ilegiveis += 1;
        else if (cabecalho.instante >= corte) cabecalhos.push(cabecalho);
      }
    }
    return { pasta: alvo.pasta, caminho: alvo.caminho, uidValidity, cabecalhos: cabecalhos.toSorted((a, b) => b.uid - a.uid), cortado: faltam.length > teto, ilegiveis };
  } finally {
    trava.release();
  }
}

/**
 * Lê só o que a janela da conta pede: lista as pastas, abre `INBOX` e a pasta com `specialUse`
 * `\Sent` (qualquer origem da marca) e traz os cabeçalhos dos uids que o banco ainda não tem, dos
 * mais novos para os mais antigos, até o teto. Não lê corpo. O que sumiu do servidor continua no
 * banco até sair da janela.
 */
export async function coletarCabecalhos(entrada: EntradaDaColeta, sinal?: AbortSignal): Promise<ResultadoDaColeta> {
  const corte = corteDaJanela(entrada.agora, entrada.janelaDias);
  const feito = await comConexao(entrada.config, entrada.senha, entrada.caExtra, sinal, async (cliente) => {
    const pastas = await cliente.list();
    const enviados = pastas.find((pasta) => pasta.specialUse === "\\Sent");
    const alvos = [{ pasta: "entrada" as const, caminho: "INBOX" }, ...(enviados === undefined ? [] : [{ pasta: "enviados" as const, caminho: enviados.path }])];
    const lidas: ColetaDaPasta[] = [];
    for (const alvo of alvos) lidas.push(await coletarPasta(cliente, alvo, entrada, corte));
    return { pastas: lidas, semEnviados: enviados === undefined } satisfies ColetaDaConta;
  });
  return feito.ok ? { ok: true, coleta: feito.valor } : feito;
}

export interface EntradaDoCorpo {
  readonly config: ConfigEmail;
  readonly senha: Segredo;
  readonly caExtra: string | null;
  /** O caminho da pasta no servidor, do cursor. */
  readonly caminho: string;
  readonly uidValidity: string;
  readonly uid: number;
}

/** As partes de texto, na ordem da mensagem. Mensagem encaixada (`message/rfc822`) e anexo não entram. */
function partesDeTexto(no: MessageStructureObject, achadas: MessageStructureObject[] = []): MessageStructureObject[] {
  const tipo = no.type.toLowerCase();
  if (tipo === "message/rfc822" || no.disposition?.toLowerCase() === "attachment") return achadas;
  if (no.childNodes !== undefined && no.childNodes.length > 0) {
    for (const filho of no.childNodes) partesDeTexto(filho, achadas);
  } else if (tipo === "text/plain" || tipo === "text/html") {
    achadas.push(no);
  }
  return achadas;
}

async function lerTexto(conteudo: AsyncIterable<unknown>): Promise<Buffer> {
  const blocos: Buffer[] = [];
  for await (const bloco of conteudo) blocos.push(Buffer.isBuffer(bloco) ? bloco : Buffer.from(String(bloco)));
  return Buffer.concat(blocos);
}

/**
 * O corpo de uma mensagem, agora, pelo IMAP. Abre a pasta só para leitura, confere o
 * `UIDVALIDITY`, escolhe a primeira parte `text/plain` que não é anexo e, sem ela, a primeira
 * `text/html`, e baixa até `MAXIMO_DO_CORPO_BYTES`. Nada de anexo. O texto não é guardado aqui.
 */
export async function lerCorpoDoEmail(entrada: EntradaDoCorpo, sinal?: AbortSignal): Promise<ResultadoDoCorpo> {
  const feito = await comConexao(entrada.config, entrada.senha, entrada.caExtra, sinal, async (cliente): Promise<CorpoLido | null> => {
    const trava = await cliente.getMailboxLock(entrada.caminho, { readOnly: true });
    try {
      const caixa = cliente.mailbox;
      if (caixa === false || String(caixa.uidValidity) !== entrada.uidValidity) return null;
      const mensagem = await cliente.fetchOne(String(entrada.uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
      if (mensagem === false || mensagem.uid !== entrada.uid) return null;
      const partes = mensagem.bodyStructure === undefined ? [] : partesDeTexto(mensagem.bodyStructure);
      const escolhida = partes.find((parte) => parte.type.toLowerCase() === "text/plain") ?? partes.find((parte) => parte.type.toLowerCase() === "text/html");
      const envelope = { assunto: mensagem.envelope?.subject ?? null, nomeDoRemetente: mensagem.envelope?.from?.[0]?.name ?? null };
      if (escolhida === undefined) return { texto: "", textoParaSinais: "", origem: "nenhum", cortadoNoDownload: false, ...envelope };
      const baixado = await cliente.download(String(entrada.uid), escolhida.part ?? "1", { uid: true, maxBytes: MAXIMO_DO_CORPO_BYTES });
      if (baixado.content === undefined) return { texto: "", textoParaSinais: "", origem: "nenhum", cortadoNoDownload: false, ...envelope };
      const bytes = await lerTexto(baixado.content);
      const cortadoNoDownload = bytes.length >= MAXIMO_DO_CORPO_BYTES;
      // O corte em bytes pode partir um caractere ao meio: o resto quebrado sai.
      const bruto = bytes.toString("utf8").replace(/\uFFFD$/, "");
      if (escolhida.type.toLowerCase() === "text/plain") return { texto: bruto, textoParaSinais: bruto, origem: "texto", cortadoNoDownload, ...envelope };
      const { visivel, completo } = textoDoHtml(bruto);
      return { texto: visivel, textoParaSinais: completo, origem: "html", cortadoNoDownload, ...envelope };
    } finally {
      trava.release();
    }
  });
  if (!feito.ok) return feito;
  return feito.valor === null ? { ok: false, motivo: "nao_encontrado" } : { ok: true, corpo: feito.valor };
}
