/**
 * wacli falso. Roda como `[process.execPath, "testes/falsos/wacli.ts", "--falso=<pasta>", ...args]`.
 * Fala o protocolo do wacli 0.26.0: envelope `{success, data, error}` em stdout com `--json`
 * e NDJSON `{event, data, ts}` em stderr com `--events`.
 *
 * `<pasta>/roteiro.json` diz o que `auth` e `sync` fazem; `<pasta>/chamadas.ndjson` recebe uma
 * linha por invocação. O que o falso "sabe" da conta mora em `<store>/falso.json`, então apagar
 * a store desloga, como no wacli real.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PassoDoWacliFalso =
  /** Uma linha NDJSON em stderr. */
  | { readonly emitir: string; readonly dados?: Readonly<Record<string, unknown>> }
  /** Uma linha crua em stderr, para simular aviso humano ou lixo. */
  | { readonly texto: string }
  /** Espera `<pasta>/<nome>` existir e apaga o arquivo: é o teste fazendo o papel do celular. */
  | { readonly aguardar: string }
  /** A store passa a estar autenticada com este telefone (só dígitos). */
  | { readonly parear: { readonly telefone: string } }
  /** O WhatsApp revogou a sessão: marca a store e emite `logged_out`. */
  | { readonly revogar: true }
  /** Fica de pé até receber o sinal de parada. */
  | { readonly ficarVivo: true }
  | { readonly sair: number };

export interface RoteiroDoWacliFalso {
  readonly auth: readonly PassoDoWacliFalso[];
  readonly sync: readonly PassoDoWacliFalso[];
  /** O que as leituras (`chats list`, `messages list`, ...) devolvem. Sem ele, o falso responde com tudo vazio. */
  readonly leituras?: LeiturasDoWacliFalso;
}

const ZERO_DO_GO = "0001-01-01T00:00:00Z";

/** `store.Chat` do wacli 0.26.0, com os nomes do JSON dele. */
export interface ChatDoWacli {
  jid: string;
  kind: string;
  name: string;
  last_message_ts: string;
  archived: boolean;
  pinned: boolean;
  muted_until: number;
  unread: boolean;
  unread_count: number;
}

/** `store.Message` do wacli 0.26.0. Sem tags JSON, o Go usa o nome do campo. */
export interface MensagemDoWacli {
  ChatJID: string;
  ChatName: string;
  MsgID: string;
  SenderJID: string;
  SenderName: string;
  Timestamp: string;
  FromMe: boolean;
  Text: string;
  DisplayText: string;
  Buttons?: readonly { type: string; display_text: string; id?: string; url?: string; description?: string }[];
  IsForwarded: boolean;
  ForwardingScore: number;
  ReactionToID: string;
  ReactionEmoji: string;
  MediaType: string;
  MediaCaption: string;
  Filename: string;
  MimeType: string;
  DirectPath: string;
  LocalPath: string;
  DownloadedAt: string;
  Starred: boolean;
  StarredAt: string;
  Edited: boolean;
  Revoked: boolean;
  DeletedForMe: boolean;
  DeliveredTo: number;
  ReadBy: number;
  Snippet: string;
}

/** `store.Contact` do wacli 0.26.0. */
export interface ContatoDoWacli {
  jid: string;
  phone: string;
  name: string;
  alias: string;
  system_name: string;
  updated_at: string;
}

/** `contactResolution` de `wacli contacts resolve`. Os campos vazios saem do JSON (`omitempty`). */
export interface IdentidadeDoWacli {
  input: string;
  jid?: string;
  phone?: string;
  lid?: string;
  name?: string;
  resolved: boolean;
  error?: string;
}

export interface LeiturasDoWacliFalso {
  readonly chats?: readonly ChatDoWacli[];
  readonly mensagens?: readonly MensagemDoWacli[];
  readonly contatos?: readonly ContatoDoWacli[];
  /** Uma resposta por entrada de `contacts resolve`, achada pelo `input`. Entrada sem resposta sai `resolved: false`. */
  readonly identidades?: readonly IdentidadeDoWacli[];
  /** O `data` do envelope, no lugar da resposta calculada, para testar formato quebrado. A chave é o comando, como `chats list`. */
  readonly respostaCrua?: Readonly<Record<string, unknown>>;
}

export function chatDoWacli(parcial: Partial<ChatDoWacli> & Pick<ChatDoWacli, "jid">): ChatDoWacli {
  return { kind: "dm", name: "", last_message_ts: "2026-11-13T12:00:00Z", archived: false, pinned: false, muted_until: 0, unread: false, unread_count: 0, ...parcial };
}

export function mensagemDoWacli(parcial: Partial<MensagemDoWacli> & Pick<MensagemDoWacli, "ChatJID" | "MsgID">): MensagemDoWacli {
  const texto = parcial.Text ?? "";
  return {
    ChatName: "",
    SenderJID: "",
    SenderName: "",
    Timestamp: "2026-11-13T12:00:00Z",
    FromMe: false,
    Text: texto,
    DisplayText: parcial.DisplayText ?? texto,
    IsForwarded: false,
    ForwardingScore: 0,
    ReactionToID: "",
    ReactionEmoji: "",
    MediaType: "",
    MediaCaption: "",
    Filename: "",
    MimeType: "",
    DirectPath: "",
    LocalPath: "",
    DownloadedAt: ZERO_DO_GO,
    Starred: false,
    StarredAt: ZERO_DO_GO,
    Edited: false,
    Revoked: false,
    DeletedForMe: false,
    DeliveredTo: 0,
    ReadBy: 0,
    Snippet: "",
    ...parcial,
  };
}

export function contatoDoWacli(parcial: Partial<ContatoDoWacli> & Pick<ContatoDoWacli, "jid">): ContatoDoWacli {
  return { phone: "", name: "", alias: "", system_name: "", updated_at: "2026-11-13T12:00:00Z", ...parcial };
}

export interface ChamadaDoWacliFalso {
  readonly pid: number;
  readonly args: readonly string[];
  readonly store: string;
  readonly env: Readonly<Record<string, string | null>>;
}

interface Conta {
  autenticado: boolean;
  jid: string | null;
  revogada: boolean;
}

const INTERVALO_MS = 10;

const LEITURAS = ["messages search", "messages list", "messages show", "chats list", "contacts search", "contacts resolve"];

interface FlagsLidas {
  readonly valores: ReadonlyMap<string, string>;
  readonly ligadas: ReadonlySet<string>;
  readonly posicionais: readonly string[];
}

/** `--flag=valor`, `--flag` e, depois de `--`, os posicionais: o formato que `lerLeitura` monta. */
function lerFlags(args: readonly string[]): FlagsLidas {
  const valores = new Map<string, string>();
  const ligadas = new Set<string>();
  const posicionais: string[] = [];
  let soPosicionais = false;
  for (const arg of args) {
    if (soPosicionais) posicionais.push(arg);
    else if (arg === "--") soPosicionais = true;
    else if (arg.startsWith("--") && arg.includes("=")) valores.set(arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1));
    else if (arg.startsWith("--")) ligadas.add(arg.slice(2));
    else posicionais.push(arg);
  }
  return { valores, ligadas, posicionais };
}

const inteiro = (valor: string | undefined, padrao: number) => (valor !== undefined && /^\d+$/.test(valor) ? Number(valor) : padrao);
const minusculas = (texto: string) => texto.toLowerCase();

function paginar<T>(itens: readonly T[], limite: number) {
  const pagina = itens.slice(0, limite);
  const temMais = itens.length > limite;
  return { pagina, page: { has_more: temMais, next_cursor: temMais ? `CANARIO-cursor-${limite}` : null } };
}

type RespostaDoRoteiro = { readonly ok: true; readonly dados: unknown } | { readonly ok: false; readonly erro: string };

/** Filtros e ordem do wacli real, na medida que os testes precisam. A forma do JSON é a do código Go. */
function lerDoRoteiro(leitura: string, args: readonly string[], dados: LeiturasDoWacliFalso): RespostaDoRoteiro {
  const cru = dados.respostaCrua?.[leitura];
  if (cru !== undefined) return { ok: true, dados: cru };
  const { valores, ligadas, posicionais } = lerFlags(args);
  const limite = inteiro(valores.get("limit"), 50);
  const mensagens = dados.mensagens ?? [];
  const mensagensEmOrdem = (conversa: string | undefined) =>
    mensagens
      .filter((m) => conversa === undefined || m.ChatJID === conversa)
      .toSorted((a, b) => (ligadas.has("asc") ? 1 : -1) * (Date.parse(a.Timestamp) - Date.parse(b.Timestamp)));
  const fonte = { last_sync_at: null, scope: "local_archive" };

  switch (leitura) {
    case "chats list": {
      const consulta = minusculas(valores.get("query") ?? "");
      const chats = (dados.chats ?? [])
        .filter((c) => !ligadas.has("unread") || c.unread || c.unread_count > 0)
        .filter((c) => consulta === "" || minusculas(`${c.name} ${c.jid}`).includes(consulta))
        .toSorted((a, b) => Date.parse(b.last_message_ts) - Date.parse(a.last_message_ts));
      return { ok: true, dados: chats.slice(0, limite) };
    }
    case "messages list": {
      const { pagina, page } = paginar(mensagensEmOrdem(valores.get("chat")), limite);
      return { ok: true, dados: { messages: pagina, fts: true, page, source: fonte } };
    }
    case "messages search": {
      const consulta = minusculas(posicionais[0] ?? "");
      const achadas = mensagensEmOrdem(valores.get("chat")).filter((m) => minusculas(`${m.Text} ${m.DisplayText} ${m.MediaCaption}`).includes(consulta));
      const { pagina, page } = paginar(achadas, limite);
      const antes = inteiro(valores.get("context-before"), 0);
      const depois = inteiro(valores.get("context-after"), 0);
      const resposta: Record<string, unknown> = {
        messages: pagina.map((m) => ({ ...m, Snippet: m.Text })),
        fts: true,
        page,
        source: fonte,
      };
      if (antes > 0 || depois > 0) {
        resposta.context = pagina.map((achada) => {
          const conversa = mensagens.filter((m) => m.ChatJID === achada.ChatJID).toSorted((a, b) => Date.parse(a.Timestamp) - Date.parse(b.Timestamp));
          const indice = conversa.findIndex((m) => m.MsgID === achada.MsgID);
          return { chat_jid: achada.ChatJID, msg_id: achada.MsgID, messages: conversa.slice(Math.max(0, indice - antes), indice + depois + 1) };
        });
      }
      return { ok: true, dados: resposta };
    }
    case "messages show": {
      const achada = mensagens.find((m) => m.ChatJID === valores.get("chat") && m.MsgID === valores.get("id"));
      return achada === undefined ? { ok: false, erro: "sql: no rows in result set" } : { ok: true, dados: achada };
    }
    case "contacts search": {
      const consulta = minusculas(posicionais[0] ?? "");
      const contatos = (dados.contatos ?? []).filter((c) => minusculas(`${c.alias} ${c.name} ${c.system_name} ${c.phone} ${c.jid}`).includes(consulta));
      return { ok: true, dados: contatos.slice(0, limite) };
    }
    default:
      return {
        ok: true,
        dados: posicionais.map((input) => (dados.identidades ?? []).find((i) => i.input === input) ?? { input, resolved: false }),
      };
  }
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function principal(argv: readonly string[]): Promise<number> {
  const marcador = argv.find((arg) => arg.startsWith("--falso="));
  if (marcador === undefined) return 64;
  const pasta = marcador.slice("--falso=".length);
  const args = argv.filter((arg) => arg !== marcador);

  const globais = { json: false, eventos: false, somenteLeitura: process.env.WACLI_READONLY === "1" };
  let store = process.env.WACLI_STORE_DIR ?? "";
  const comando: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--json") globais.json = true;
    else if (arg === "--events") globais.eventos = true;
    else if (arg === "--read-only") globais.somenteLeitura = true;
    else if (arg === "--store") store = args[(i += 1)] ?? "";
    else comando.push(arg);
  }
  if (store === "") return 64;

  const chamada: ChamadaDoWacliFalso = {
    pid: process.pid,
    args,
    store,
    env: {
      WACLI_STORE_DIR: process.env.WACLI_STORE_DIR ?? null,
      WACLI_SYNC_MAX_DB_SIZE: process.env.WACLI_SYNC_MAX_DB_SIZE ?? null,
      WACLI_READONLY: process.env.WACLI_READONLY ?? null,
    },
  };
  appendFileSync(join(pasta, "chamadas.ndjson"), JSON.stringify(chamada) + "\n");

  const arquivoDaConta = join(store, "falso.json");
  const arquivoDoLock = join(store, "LOCK");
  const lerConta = (): Conta =>
    existsSync(arquivoDaConta)
      ? (JSON.parse(readFileSync(arquivoDaConta, "utf8")) as Conta)
      : { autenticado: false, jid: null, revogada: false };
  const gravarConta = (conta: Conta) => writeFileSync(arquivoDaConta, JSON.stringify(conta));
  const donoDoLock = (): number | null => {
    if (!existsSync(arquivoDoLock)) return null;
    const pid = Number(/pid=(\d+)/.exec(readFileSync(arquivoDoLock, "utf8"))?.[1]);
    // Como o `flock` do wacli real, o lock some quando o dono morre, mesmo sem limpar o arquivo.
    return Number.isInteger(pid) && pid > 0 && vivo(pid) ? pid : null;
  };

  const evento = (nome: string, dados?: Readonly<Record<string, unknown>>) => {
    if (!globais.eventos) return;
    const linha = dados === undefined ? { event: nome, ts: Date.now() } : { event: nome, data: dados, ts: Date.now() };
    process.stderr.write(JSON.stringify(linha) + "\n");
  };
  const responder = (dados: unknown) => {
    process.stdout.write(JSON.stringify({ success: true, data: dados, error: null }) + "\n");
    return 0;
  };
  const falhar = (mensagem: string) => {
    if (globais.eventos) evento("error", { message: mensagem });
    // O wacli real escreve o envelope de erro em stderr, não em stdout (conferido na 0.26.0).
    else if (globais.json) process.stderr.write(JSON.stringify({ success: false, data: null, error: mensagem }) + "\n");
    else process.stderr.write(mensagem + "\n");
    return 1;
  };

  let comLock = false;
  const soltarLock = () => {
    if (comLock) rmSync(arquivoDoLock, { force: true });
    comLock = false;
  };
  const pegarLock = (): boolean => {
    if (donoDoLock() !== null) return false;
    // Como o wacli real, só quem escreve cria a store: `doctor` e `auth status` não deixam pasta.
    mkdirSync(store, { recursive: true });
    writeFileSync(arquivoDoLock, `pid=${process.pid}\n`);
    comLock = true;
    return true;
  };
  const sairPorSinal = () => {
    evento("signal", { signal: "interrupt", action: "shutdown" });
    soltarLock();
    process.exit(0);
  };
  process.on("SIGINT", sairPorSinal);
  process.on("SIGTERM", sairPorSinal);

  async function rodar(passos: readonly PassoDoWacliFalso[]): Promise<number> {
    for (const passo of passos) {
      if ("emitir" in passo) evento(passo.emitir, passo.dados);
      else if ("texto" in passo) process.stderr.write(passo.texto + "\n");
      else if ("aguardar" in passo) {
        const sinal = join(pasta, passo.aguardar);
        while (!existsSync(sinal)) await new Promise((resolver) => setTimeout(resolver, INTERVALO_MS));
        rmSync(sinal, { force: true });
      } else if ("parear" in passo) {
        gravarConta({ autenticado: true, jid: `${passo.parear.telefone}@s.whatsapp.net`, revogada: false });
      } else if ("revogar" in passo) {
        gravarConta({ ...lerConta(), autenticado: false, revogada: true });
        evento("logged_out", { reason: "device_removed", reason_code: 401, on_connect: false, recovery: "run wacli auth" });
      } else if ("ficarVivo" in passo) {
        await new Promise(() => setInterval(() => {}, 60_000));
      } else return passo.sair;
    }
    return 0;
  }

  const roteiro = JSON.parse(readFileSync(join(pasta, "roteiro.json"), "utf8")) as RoteiroDoWacliFalso;
  const [primeiro, segundo] = comando;
  const escreve = "read-only mode: command would intentionally modify WhatsApp or the local store";
  const trancada = "store is locked (another wacli is running?)";

  if (primeiro === "auth" && segundo === "status") {
    const conta = lerConta();
    const telefone = conta.jid?.split("@")[0];
    return responder(
      conta.autenticado && conta.jid !== null
        ? { authenticated: true, linked_jid: conta.jid, phone: telefone }
        : { authenticated: false },
    );
  }
  if (primeiro === "doctor") {
    const conta = lerConta();
    const dono = donoDoLock();
    return responder({
      store_dir: store,
      lock_held: dono !== null,
      ...(dono === null ? {} : { lock_owner_pid: dono }),
      authenticated: conta.autenticado,
      session_revoked: conta.revogada,
      ...(conta.autenticado && conta.jid !== null ? { linked_jid: conta.jid } : {}),
      connected: false,
      connection_state: conta.revogada ? "logged_out" : dono !== null && conta.autenticado ? "locked_by_other_process" : "disconnected",
      fts_enabled: true,
    });
  }
  if (primeiro === "auth" && segundo === "logout") {
    if (globais.somenteLeitura) return falhar(escreve);
    if (!pegarLock()) return falhar(trancada);
    gravarConta({ autenticado: false, jid: null, revogada: false });
    soltarLock();
    return 0;
  }
  if (primeiro === "auth") {
    if (globais.somenteLeitura) return falhar(escreve);
    if (!pegarLock()) return falhar(trancada);
    evento("auth_starting");
    const codigo = await rodar(roteiro.auth);
    soltarLock();
    return codigo;
  }
  if (primeiro === "sync") {
    if (globais.somenteLeitura) return falhar(escreve);
    if (!lerConta().autenticado) return falhar("not authenticated; run `wacli auth`");
    if (!pegarLock()) return falhar(trancada);
    const codigo = await rodar(roteiro.sync);
    soltarLock();
    return codigo;
  }
  if (primeiro === "send") return falhar(globais.somenteLeitura ? escreve : "o wacli falso não envia");
  const leitura = `${primeiro} ${segundo}`;
  if (LEITURAS.includes(leitura)) {
    const resposta = lerDoRoteiro(leitura, comando.slice(2), roteiro.leituras ?? {});
    return resposta.ok ? responder(resposta.dados) : falhar(resposta.erro);
  }
  return 2;
}

if (import.meta.main) process.exit(await principal(process.argv.slice(2)));
