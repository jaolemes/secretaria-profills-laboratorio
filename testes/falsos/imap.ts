import net from "node:net";
import tls from "node:tls";
import type { Certificado } from "./certificado";

/** Uma mensagem da caixa. `corpo` sem `texto` e sem `html` é uma mensagem sem parte de texto (só anexo). */
export interface MensagemDoFalso {
  readonly uid: number;
  /** ISO 8601. É a data interna, a que o servidor guarda. */
  readonly dataInterna: string;
  readonly de: { readonly nome?: string; readonly endereco: string };
  readonly para: readonly string[];
  readonly cc?: readonly string[];
  /** Com acento, vai em palavra codificada (`=?UTF-8?B?...?=`). */
  readonly assunto: string;
  readonly messageId?: string;
  readonly emRespostaA?: string;
  readonly referencias?: readonly string[];
  readonly listUnsubscribe?: string;
  readonly autoSubmitted?: string;
  readonly precedence?: string;
  /** Só aparece quando o falso anuncia `OBJECTID`. */
  readonly threadId?: string;
  readonly corpo?: {
    readonly texto?: string;
    readonly html?: string;
    /** Parte `text/plain` marcada como anexo, que a leitura não pode escolher. */
    readonly anexoDeTexto?: string;
    /** O texto vai em base64, com o `Content-Transfer-Encoding` dizendo isso. */
    readonly base64?: boolean;
  };
}

export interface PastaDoFalso {
  readonly caminho: string;
  /** Por exemplo `\\Sent`. Sai como marca da pasta no `LIST`. */
  readonly specialUse?: string;
  uidValidity: number;
  readonly mensagens: MensagemDoFalso[];
}

export interface OpcoesDoImapFalso {
  readonly seguranca: "tls" | "starttls";
  readonly certificado: Certificado;
  /** Endereço e senha aceitos. Qualquer outro par recebe `AUTHENTICATIONFAILED`. */
  readonly contas: Readonly<Record<string, string>>;
  readonly caixa?: { readonly mensagens: number; readonly naoLidas: number };
  /**
   * `fecha_na_saudacao` derruba a conexão antes de falar; `ecoa_senha` devolve a senha
   * recebida no texto da recusa, como um servidor mal feito faria; `mudo` aceita a conexão
   * e nunca responde; `sem_starttls` é um servidor em texto puro que não oferece TLS e
   * aceitaria o login assim mesmo.
   */
  readonly modo?: "normal" | "fecha_na_saudacao" | "ecoa_senha" | "mudo" | "sem_starttls" | "trava_no_fetch";
  /**
   * As pastas de cada conta, pelo endereço do login. A lista é viva: o teste muda `uidValidity` e
   * acrescenta ou tira mensagem com o servidor de pé. Conta sem entrada aqui tem só a `INBOX` vazia
   * do `STATUS` antigo.
   */
  readonly caixas?: Readonly<Record<string, readonly PastaDoFalso[]>>;
  /** Anuncia `OBJECTID`: com ele o `FETCH` devolve `THREADID`. Sem a opção, o servidor não conhece conversa. */
  readonly objectId?: boolean;
  /**
   * Responde como o Gmail com verificação em duas etapas: só aceita a senha de app da conta. A senha
   * da conta (a de `contas`) recebe `[ALERT] Application-specific password required`; outra senha,
   * `[AUTHENTICATIONFAILED] Invalid credentials`.
   */
  readonly gmail?: { readonly senhasDeApp: Readonly<Record<string, string>> };
  /** Texto que o servidor põe na recusa do login, no lugar do padrão. Sem CR nem LF: é uma linha do IMAP. */
  readonly textoDaRecusa?: string;
}

export interface ImapFalso {
  readonly porta: number;
  /** Nomes dos comandos recebidos, em ordem, sem argumentos. `UID FETCH` e os outros de `UID` vêm pelo nome inteiro. */
  comandos(): readonly string[];
  /** As linhas recebidas, inteiras, na ordem. A senha do `LOGIN` sai oculta. */
  linhas(): readonly string[];
  /** A pasta viva de uma conta: o teste muda `uidValidity` e as mensagens com o servidor de pé. */
  caixa(endereco: string, caminho: string): PastaDoFalso;
  /** Quantos `LOGIN` chegaram por canal cifrado e quantos em texto puro. */
  logins(): { readonly cifrados: number; readonly emTextoPuro: number };
  /** O maior número de conexões abertas ao mesmo tempo desde que o servidor subiu. */
  maximoDeConexoes(): number;
  parar(): Promise<void>;
}

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dataInterna(iso: string): string {
  const d = new Date(iso);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(d.getUTCDate())}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())} +0000`;
}

/** Texto de cabeçalho: ASCII vai como está, o resto em palavra codificada. */
function palavra(texto: string): string {
  return /^[\x20-\x7e]*$/.test(texto) ? texto : `=?UTF-8?B?${Buffer.from(texto, "utf8").toString("base64")}?=`;
}

function citado(texto: string): string {
  return `"${palavra(texto).replace(/[\\"]/g, "\\$&")}"`;
}

function enderecos(lista: readonly { readonly nome?: string; readonly endereco: string }[]): string {
  if (lista.length === 0) return "NIL";
  const itens = lista.map(({ nome, endereco }) => {
    const [caixa = "", servidor = ""] = endereco.split("@");
    return `(${nome === undefined ? "NIL" : citado(nome)} NIL ${citado(caixa)} ${citado(servidor)})`;
  });
  return `(${itens.join("")})`;
}

const comoEndereco = (endereco: string) => ({ endereco });

function envelope(m: MensagemDoFalso): string {
  const de = enderecos([m.de]);
  const opcional = (valor: string | undefined) => (valor === undefined ? "NIL" : citado(valor));
  return `(${citado(new Date(m.dataInterna).toUTCString())} ${citado(m.assunto)} ${de} ${de} ${de} ${enderecos(m.para.map(comoEndereco))} ${enderecos((m.cc ?? []).map(comoEndereco))} NIL ${opcional(m.emRespostaA)} ${opcional(m.messageId)})`;
}

/** Os cabeçalhos que o `FETCH` pede por nome, como o servidor os devolve: só os que a mensagem tem. */
function cabecalhosPedidos(m: MensagemDoFalso, nomes: readonly string[]): string {
  const valores: Readonly<Record<string, string | undefined>> = {
    "list-unsubscribe": m.listUnsubscribe,
    "auto-submitted": m.autoSubmitted,
    precedence: m.precedence,
    references: m.referencias?.join(" "),
  };
  const linhas = nomes.flatMap((nome) => {
    const valor = valores[nome.toLowerCase()];
    return valor === undefined ? [] : [`${nome}: ${valor}`];
  });
  return `${linhas.join("\r\n")}${linhas.length === 0 ? "" : "\r\n"}\r\n`;
}

interface ParteDoFalso {
  readonly numero: string;
  readonly tipo: string;
  readonly subtipo: string;
  readonly conteudo: Buffer;
  readonly codificacao: "8BIT" | "BASE64";
  readonly anexo: boolean;
}

/** A árvore da mensagem: lista de partes folha e a estrutura em texto do `BODYSTRUCTURE`. */
function estrutura(m: MensagemDoFalso): { readonly partes: readonly ParteDoFalso[]; readonly texto: string; readonly simples: boolean } {
  const corpo = m.corpo ?? {};
  const codificacao = corpo.base64 === true ? "BASE64" : "8BIT";
  const dados = (texto: string) => (corpo.base64 === true ? Buffer.from(Buffer.from(texto, "utf8").toString("base64"), "latin1") : Buffer.from(texto, "utf8"));
  const folha = (parte: ParteDoFalso) =>
    parte.tipo === "IMAGE"
      ? `("IMAGE" "PNG" NIL NIL NIL "BASE64" ${parte.conteudo.length} NIL ("ATTACHMENT" ("FILENAME" "figura.png")) NIL NIL)`
      : `("TEXT" "${parte.subtipo}" ("CHARSET" "UTF-8") NIL NIL "${parte.codificacao}" ${parte.conteudo.length} 1 NIL ${parte.anexo ? '("ATTACHMENT" ("FILENAME" "nota.txt"))' : "NIL"} NIL NIL)`;

  const nosDoCorpo: ParteDoFalso[] = [];
  if (corpo.texto !== undefined) nosDoCorpo.push({ numero: "", tipo: "TEXT", subtipo: "PLAIN", conteudo: dados(corpo.texto), codificacao, anexo: false });
  if (corpo.html !== undefined) nosDoCorpo.push({ numero: "", tipo: "TEXT", subtipo: "HTML", conteudo: dados(corpo.html), codificacao, anexo: false });
  const extras: ParteDoFalso[] = [];
  if (corpo.anexoDeTexto !== undefined) extras.push({ numero: "", tipo: "TEXT", subtipo: "PLAIN", conteudo: Buffer.from(corpo.anexoDeTexto, "utf8"), codificacao: "8BIT", anexo: true });
  if (nosDoCorpo.length === 0 && extras.length === 0) {
    extras.push({ numero: "", tipo: "IMAGE", subtipo: "PNG", conteudo: Buffer.from("figura"), codificacao: "BASE64", anexo: true });
  }

  if (nosDoCorpo.length <= 1 && extras.length === 0) {
    const unica = { ...nosDoCorpo[0]!, numero: "1" };
    return { partes: [unica], texto: folha(unica), simples: true };
  }
  const partes: ParteDoFalso[] = [];
  let raiz: string;
  if (nosDoCorpo.length === 2) {
    const alternativas = nosDoCorpo.map((parte, i) => ({ ...parte, numero: extras.length === 0 ? String(i + 1) : `1.${i + 1}` }));
    partes.push(...alternativas);
    const alternativa = `(${alternativas.map(folha).join("")} "ALTERNATIVE" ("BOUNDARY" "alt") NIL NIL)`;
    if (extras.length === 0) return { partes, texto: alternativa, simples: false };
    const anexos = extras.map((parte, i) => ({ ...parte, numero: String(i + 2) }));
    partes.push(...anexos);
    raiz = `(${alternativa}${anexos.map(folha).join("")} "MIXED" ("BOUNDARY" "mix") NIL NIL)`;
    return { partes, texto: raiz, simples: false };
  }
  const todos = [...nosDoCorpo, ...extras].map((parte, i) => ({ ...parte, numero: String(i + 1) }));
  return { partes: todos, texto: `(${todos.map(folha).join("")} "MIXED" ("BOUNDARY" "mix") NIL NIL)`, simples: false };
}

/** `5,7:9,12:*` vira a lista de uids que a pasta tem. */
function uidsDoConjunto(conjunto: string, pasta: PastaDoFalso): number[] {
  const maior = Math.max(0, ...pasta.mensagens.map((m) => m.uid));
  const numero = (texto: string) => (texto === "*" ? maior : Number(texto));
  const pedidos = new Set<number>();
  for (const parte of conjunto.split(",")) {
    const [de = "", ate] = parte.split(":");
    const inicio = numero(de);
    const fim = ate === undefined ? inicio : numero(ate);
    for (const m of pasta.mensagens) if (m.uid >= Math.min(inicio, fim) && m.uid <= Math.max(inicio, fim)) pedidos.add(m.uid);
  }
  return [...pedidos].toSorted((a, b) => a - b);
}

function dataDaBusca(texto: string): number {
  const [dia = "1", mes = "Jan", ano = "1970"] = texto.split("-");
  return Date.UTC(Number(ano), MESES.findIndex((nome) => nome.toLowerCase() === mes.toLowerCase()), Number(dia));
}

const comLiteral = (rotulo: string, conteudo: Buffer) => [Buffer.from(`${rotulo} {${conteudo.length}}\r\n`, "latin1"), conteudo];

/** A resposta `* n FETCH (...)` de uma mensagem, para os itens que o cliente pediu. */
function respostaDoFetch(sequencia: number, m: MensagemDoFalso, itens: string, objectId: boolean): Buffer {
  const pedido = itens.toUpperCase();
  const blocos: (string | Buffer)[] = [`* ${sequencia} FETCH (UID ${m.uid}`];
  const acrescentar = (texto: string) => blocos.push(` ${texto}`);
  if (pedido.includes("RFC822.SIZE")) acrescentar(`RFC822.SIZE ${estrutura(m).partes.reduce((total, parte) => total + parte.conteudo.length, 0) + 200}`);
  if (pedido.includes("INTERNALDATE")) acrescentar(`INTERNALDATE "${dataInterna(m.dataInterna)}"`);
  if (pedido.includes("ENVELOPE")) acrescentar(`ENVELOPE ${envelope(m)}`);
  if (pedido.includes("BODYSTRUCTURE")) acrescentar(`BODYSTRUCTURE ${estrutura(m).texto}`);
  if (objectId) {
    acrescentar(`EMAILID (M${m.uid})`);
    if (pedido.includes("THREADID")) acrescentar(m.threadId === undefined ? "THREADID NIL" : `THREADID (${m.threadId})`);
  }
  for (const achado of itens.matchAll(/BODY\.PEEK\[([^\]]*)\](?:<(\d+)\.(\d+)>)?/gi)) {
    const secao = achado[1] ?? "";
    const inicio = Number(achado[2] ?? 0);
    const tamanho = achado[3] === undefined ? Infinity : Number(achado[3]);
    const campos = /^HEADER\.FIELDS \(([^)]*)\)$/i.exec(secao);
    let conteudo: Buffer | null = null;
    if (campos !== null) conteudo = Buffer.from(cabecalhosPedidos(m, (campos[1] ?? "").split(/\s+/).filter((nome) => nome !== "")), "latin1");
    else if (/^HEADER$/i.test(secao)) {
      const unica = estrutura(m).partes[0];
      const tipo = unica === undefined ? "" : `Content-Type: ${unica.tipo.toLowerCase()}/${unica.subtipo.toLowerCase()}; charset="utf-8"\r\nContent-Transfer-Encoding: ${unica.codificacao.toLowerCase()}\r\n`;
      conteudo = Buffer.from(`${tipo}${cabecalhosPedidos(m, ["References"])}`, "latin1");
    }
    else {
      const { partes, simples } = estrutura(m);
      const mime = /^([\d.]+)\.MIME$/i.exec(secao);
      const numero = mime?.[1] ?? secao;
      const parte = partes.find((p) => p.numero === numero) ?? (simples && /^text$/i.test(secao) ? partes[0] : undefined);
      if (parte !== undefined) {
        conteudo =
          mime === null
            ? parte.conteudo.subarray(inicio, inicio + tamanho)
            : Buffer.from(`Content-Type: ${parte.tipo.toLowerCase()}/${parte.subtipo.toLowerCase()}; charset="utf-8"\r\nContent-Transfer-Encoding: ${parte.codificacao.toLowerCase()}${parte.anexo ? '\r\nContent-Disposition: attachment; filename="nota.txt"' : ""}\r\n\r\n`, "latin1");
      }
    }
    if (conteudo === null) continue;
    const origem = achado[2] === undefined || mimeOuCabecalho(secao) ? "" : `<${inicio}>`;
    blocos.push(" ", ...comLiteral(`BODY[${secao}]${origem}`, conteudo));
  }
  blocos.push(")\r\n");
  return Buffer.concat(blocos.map((bloco) => (typeof bloco === "string" ? Buffer.from(bloco, "latin1") : bloco)));
}

const mimeOuCabecalho = (secao: string) => /\.MIME$|^HEADER/i.test(secao);

function argumentos(resto: string): string[] {
  const achados: string[] = [];
  for (const casamento of resto.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    achados.push(casamento[1] !== undefined ? casamento[1].replace(/\\(.)/g, "$1") : (casamento[2] ?? ""));
  }
  return achados;
}

/**
 * Servidor IMAP mínimo: saudação, `CAPABILITY`, `STARTTLS`, `LOGIN`, `STATUS` e `LOGOUT`. Com `caixas`,
 * também `LIST` com `\\Sent`, `EXAMINE`, `UID SEARCH` e `UID FETCH` (cabeçalhos, estrutura e partes de
 * texto). Os comandos que mudam a caixa (`SELECT`, `STORE`, `COPY`, `MOVE`, `EXPUNGE`, `APPEND`, `DELETE`)
 * não existem aqui: recebem `BAD`, e `comandos()` mostra que chegaram.
 */
export function iniciarImapFalso(opcoes: OpcoesDoImapFalso): Promise<ImapFalso> {
  const modo = opcoes.modo ?? "normal";
  const caixa = opcoes.caixa ?? { mensagens: 7, naoLidas: 2 };
  const contexto = { key: opcoes.certificado.chave, cert: opcoes.certificado.certificado };
  const comandos: string[] = [];
  const linhasRecebidas: string[] = [];
  const logins = { cifrados: 0, emTextoPuro: 0 };
  const abertos = new Set<net.Socket>();

  function atender(soquete: net.Socket, cifrado: boolean, saudar: boolean): void {
    abertos.add(soquete);
    soquete.on("close", () => abertos.delete(soquete));
    soquete.on("error", () => soquete.destroy());
    if (modo === "fecha_na_saudacao") {
      soquete.destroy();
      return;
    }
    if (modo === "mudo") return;

    const semTls = modo === "sem_starttls";
    const extras = `${opcoes.caixas === undefined ? "" : " SPECIAL-USE"}${opcoes.objectId === true ? " OBJECTID" : ""}`;
    const capacidades = cifrado || semTls ? `IMAP4rev1${extras}` : "IMAP4rev1 STARTTLS LOGINDISABLED";
    let pastasDaConta: readonly PastaDoFalso[] | null = null;
    let selecionada: PastaDoFalso | null = null;
    if (saudar) soquete.write(`* OK [CAPABILITY ${capacidades}] IMAP falso pronto\r\n`);

    let pendente = "";
    const aoReceber = (bloco: Buffer) => {
      pendente += bloco.toString("utf8");
      let fim: number;
      while ((fim = pendente.indexOf("\r\n")) !== -1) {
        const linha = pendente.slice(0, fim);
        pendente = pendente.slice(fim + 2);
        if (responder(linha) === "trocou_de_canal") return;
      }
    };
    soquete.on("data", aoReceber);

    function responderUid(tag: string, resto: string[]): "segue" {
      const [subcomando = "", ...argumentosDoUid] = resto;
      const nome = `UID ${subcomando.toUpperCase()}`;
      comandos.push(nome);
      const pasta = selecionada;
      if (pasta === null || (nome !== "UID SEARCH" && nome !== "UID FETCH")) {
        soquete.write(`${tag} BAD ${pasta === null ? "nenhuma pasta aberta" : "comando desconhecido"}\r\n`);
        return "segue";
      }
      if (nome === "UID SEARCH") {
        const desde = /\bSINCE (\d{1,2}-[A-Za-z]{3}-\d{4})/i.exec(argumentosDoUid.join(" "));
        const corte = desde?.[1] === undefined ? -Infinity : dataDaBusca(desde[1]);
        const achadas = pasta.mensagens.filter((m) => new Date(m.dataInterna).setUTCHours(0, 0, 0, 0) >= corte).map((m) => m.uid);
        soquete.write(`* SEARCH${achadas.map((uid) => ` ${uid}`).join("")}\r\n${tag} OK feito\r\n`);
        return "segue";
      }
      const [conjunto = "", ...itens] = argumentosDoUid;
      const texto = itens.join(" ");
      const uids = uidsDoConjunto(conjunto, pasta);
      if (modo === "trava_no_fetch" && texto.toUpperCase().includes("ENVELOPE")) {
        // Responde só o começo da primeira mensagem e cala: o cliente fica esperando o resto.
        soquete.write(`* 1 FETCH (UID ${uids[0] ?? 1} `);
        return "segue";
      }
      const respostas = uids.map((uid) => {
        const mensagem = pasta.mensagens.find((candidata) => candidata.uid === uid)!;
        return respostaDoFetch(pasta.mensagens.indexOf(mensagem) + 1, mensagem, texto, opcoes.objectId === true);
      });
      soquete.write(Buffer.concat([...respostas, Buffer.from(`${tag} OK feito\r\n`)]));
      return "segue";
    }

    function responder(linha: string): "segue" | "trocou_de_canal" {
      const [tag = "*", comando = "", ...resto] = linha.split(" ");
      const nome = comando.toUpperCase();
      linhasRecebidas.push(nome === "LOGIN" ? `${tag} LOGIN [oculto]` : linha);
      if (nome === "UID") return responderUid(tag, resto);
      comandos.push(nome);
      switch (nome) {
        case "CAPABILITY":
          soquete.write(`* CAPABILITY ${capacidades}\r\n${tag} OK feito\r\n`);
          return "segue";
        case "STARTTLS": {
          if (cifrado || semTls || opcoes.seguranca !== "starttls") {
            soquete.write(`${tag} BAD sem STARTTLS aqui\r\n`);
            return "segue";
          }
          soquete.off("data", aoReceber);
          soquete.write(`${tag} OK comece o TLS\r\n`);
          const seguro = new tls.TLSSocket(soquete, { isServer: true, secureContext: tls.createSecureContext(contexto) });
          atender(seguro, true, false);
          return "trocou_de_canal";
        }
        case "LOGIN": {
          const [usuario = "", senha = ""] = argumentos(resto.join(" "));
          if (cifrado) logins.cifrados += 1;
          else logins.emTextoPuro += 1;
          pastasDaConta = opcoes.caixas?.[usuario] ?? null;
          if (opcoes.gmail !== undefined && cifrado) {
            if (opcoes.gmail.senhasDeApp[usuario] === senha) soquete.write(`${tag} OK [CAPABILITY ${capacidades}] logado\r\n`);
            else if (opcoes.contas[usuario] === senha) {
              soquete.write(`${tag} NO [ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)\r\n`);
            } else soquete.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`);
          } else if ((cifrado || semTls) && opcoes.contas[usuario] === senha) {
            soquete.write(`${tag} OK [CAPABILITY ${capacidades}] logado\r\n`);
          } else {
            const eco = modo === "ecoa_senha" ? ` para a senha ${senha}` : "";
            soquete.write(`${tag} NO [AUTHENTICATIONFAILED] ${opcoes.textoDaRecusa ?? "credenciais recusadas"}${eco}\r\n`);
          }
          return "segue";
        }
        case "LIST":
        case "LSUB": {
          const [referencia = "", padrao = "*"] = argumentos(resto.join(" "));
          if (padrao === "") {
            soquete.write(`* ${nome} (\\Noselect) "/" ""\r\n${tag} OK feito\r\n`);
            return "segue";
          }
          if (pastasDaConta === null) {
            soquete.write(`* ${nome} (\\HasNoChildren) "/" INBOX\r\n${tag} OK feito\r\n`);
            return "segue";
          }
          const regra = new RegExp(`^${`${referencia}${padrao}`.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/%/g, "[^/]*")}$`);
          const marcas = (pasta: PastaDoFalso) => `\\HasNoChildren${pasta.specialUse === undefined ? "" : ` ${pasta.specialUse}`}`;
          const listadas = pastasDaConta
            .filter((pasta) => regra.test(pasta.caminho))
            .map((pasta) => `* ${nome} (${marcas(pasta)}) "/" ${pasta.caminho === "INBOX" ? "INBOX" : `"${pasta.caminho}"`}\r\n`);
          soquete.write(`${listadas.join("")}${tag} OK feito\r\n`);
          return "segue";
        }
        case "EXAMINE": {
          const [caminho = ""] = argumentos(resto.join(" "));
          const pasta = pastasDaConta?.find((candidata) => candidata.caminho === caminho);
          if (pasta === undefined) {
            soquete.write(`${tag} NO [NONEXISTENT] pasta não existe\r\n`);
            return "segue";
          }
          selecionada = pasta;
          const proximo = Math.max(0, ...pasta.mensagens.map((m) => m.uid)) + 1;
          soquete.write(
            `* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)\r\n* OK [PERMANENTFLAGS ()] sem marcas\r\n* ${pasta.mensagens.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY ${pasta.uidValidity}] ok\r\n* OK [UIDNEXT ${proximo}] ok\r\n${tag} OK [READ-ONLY] EXAMINE feito\r\n`,
          );
          return "segue";
        }
        case "NAMESPACE":
          soquete.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK feito\r\n`);
          return "segue";
        case "STATUS":
          soquete.write(`* STATUS INBOX (MESSAGES ${caixa.mensagens} UNSEEN ${caixa.naoLidas})\r\n${tag} OK feito\r\n`);
          return "segue";
        case "LOGOUT":
          soquete.write(`* BYE até logo\r\n${tag} OK feito\r\n`);
          soquete.end();
          return "segue";
        default:
          soquete.write(`${tag} BAD comando desconhecido\r\n`);
          return "segue";
      }
    }
  }

  const conexoes = { agora: 0, maximo: 0 };
  function contar(soquete: net.Socket): void {
    conexoes.agora += 1;
    conexoes.maximo = Math.max(conexoes.maximo, conexoes.agora);
    soquete.once("close", () => (conexoes.agora -= 1));
  }

  const servidor =
    opcoes.seguranca === "tls"
      ? tls.createServer(contexto, (soquete) => (contar(soquete), atender(soquete, true, true)))
      : net.createServer((soquete) => (contar(soquete), atender(soquete, false, true)));
  // Aperto de mão que falha (cliente sem a CA) não pode derrubar o processo do teste.
  servidor.on("tlsClientError", () => {});

  return new Promise((resolver, rejeitar) => {
    servidor.once("error", rejeitar);
    servidor.listen(0, "127.0.0.1", () => {
      const endereco = servidor.address();
      if (endereco === null || typeof endereco === "string") {
        rejeitar(new Error("o IMAP falso não recebeu uma porta"));
        return;
      }
      resolver({
        porta: endereco.port,
        comandos: () => [...comandos],
        linhas: () => [...linhasRecebidas],
        caixa(endereco, caminho) {
          const pasta = opcoes.caixas?.[endereco]?.find((candidata) => candidata.caminho === caminho);
          if (pasta === undefined) throw new Error(`o IMAP falso não tem a pasta ${caminho} de ${endereco}`);
          return pasta;
        },
        logins: () => ({ ...logins }),
        maximoDeConexoes: () => conexoes.maximo,
        parar: () =>
          new Promise((feito) => {
            for (const soquete of abertos) soquete.destroy();
            servidor.close(() => feito());
          }),
      });
    });
  });
}
