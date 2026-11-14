import { z } from "zod";
import {
  lerTelefone,
  payloadQr,
  telefoneDoJid,
  textoExterno,
  type ContaWhatsapp,
  type EntradaConectar,
  type EventoWhatsapp,
} from "../../dominio";

/**
 * Borda com o wacli 0.26.0. Único arquivo que conhece flags, variáveis e formatos dele.
 * Formatos conferidos em 11/11/2026 no binário da release e na fonte da tag v0.26.0:
 * eventos em `internal/out/events.go` e `internal/app/sync_events.go`, `auth status` em
 * `cmd/wacli/auth.go`, `doctor` em `cmd/wacli/doctor.go`. O formato das leituras (`chats`, `messages`,
 * `contacts`) fica em `leitura.ts`.
 */

/** Quanto do histórico o pareamento pede ao celular. */
const DIAS_DE_HISTORICO = "90";
/** Teto de `wacli.db`. Ao bater nele o `sync` para e o conector pede atenção. */
const TETO_DO_BANCO = "2GB";

/**
 * Tudo o que a Secretária faz com o wacli. Não existe variante de envio: o tipo não tem
 * como pedir que uma mensagem saia.
 */
export type UsoDoWacli =
  | { readonly uso: "pareamento"; readonly entrada: EntradaConectar["whatsapp"] }
  | { readonly uso: "espelho" }
  | { readonly uso: "sondar_auth" }
  | { readonly uso: "sondar_doctor" }
  | { readonly uso: "encerrar_sessao" }
  | { readonly uso: "leitura"; readonly leitura: LeituraPermitida }
  | { readonly uso: "leitura_do_servidor"; readonly leitura: LeituraDoServidor };

/**
 * Leituras que só o servidor pede, fora da lista do agente: ele não escolhe flag nem argumento.
 * `contacts resolve` lê o mapa de telefone e `@lid` da sessão; `messages show` acha uma mensagem pelo id.
 */
export type LeituraDoServidor =
  | { readonly comando: "contacts resolve"; readonly identidades: readonly string[] }
  | { readonly comando: "messages show"; readonly conversa: string; readonly id: string };

const SOMENTE_LEITURA = ["--read-only", "--json"] as const;

export function argumentosDoWacli(pedido: UsoDoWacli): readonly string[] {
  switch (pedido.uso) {
    case "pareamento": {
      const base = ["auth", "--events", "--history-days", DIAS_DE_HISTORICO];
      return pedido.entrada.meio === "codigo" ? [...base, "--phone", pedido.entrada.telefone] : base;
    }
    case "espelho":
      // `quiet` não marca o aparelho como ativo, então o celular do vendedor segue notificando.
      return ["sync", "--follow", "--events", "--presence-mode", "quiet", "--max-reconnect", "0"];
    case "sondar_auth":
      return [...SOMENTE_LEITURA, "auth", "status"];
    case "sondar_doctor":
      return [...SOMENTE_LEITURA, "doctor"];
    case "encerrar_sessao":
      return ["auth", "logout"];
    case "leitura":
      return [...SOMENTE_LEITURA, ...pedido.leitura.args];
    case "leitura_do_servidor": {
      const { leitura } = pedido;
      // `--` antes das identidades: nenhuma vira flag do wacli.
      if (leitura.comando === "contacts resolve") return [...SOMENTE_LEITURA, "contacts", "resolve", "--", ...leitura.identidades];
      return [...SOMENTE_LEITURA, "messages", "show", `--chat=${leitura.conversa}`, `--id=${leitura.id}`];
    }
  }
}

export function ambienteDoWacli(dirStore: string, pedido: UsoDoWacli): Record<string, string> {
  const base = { WACLI_STORE_DIR: dirStore, WACLI_SYNC_MAX_DB_SIZE: TETO_DO_BANCO };
  const escreve = pedido.uso === "pareamento" || pedido.uso === "espelho" || pedido.uso === "encerrar_sessao";
  return escreve ? base : { ...base, WACLI_READONLY: "1" };
}

interface Leitura {
  readonly comando: readonly string[];
  /** Quantos argumentos sem traço o comando leva. */
  readonly posicionais: number;
  readonly comValor: readonly string[];
  readonly semValor: readonly string[];
}

/**
 * Comandos de leitura que o agente pode pedir, cada um com as flags de filtro do próprio
 * `--help` no wacli 0.26.0. Cada um lê só o banco local. Flag global (`--store`, `--account`,
 * `--read-only`, `--json`, `--events`, `--lock-wait`, `--timeout`, `--full`) e `--connect` do
 * `doctor` ficam de fora: trocariam a store, a conta, o modo ou o formato da resposta.
 */
export const LEITURAS_PERMITIDAS: readonly Leitura[] = [
  {
    comando: ["messages", "search"],
    posicionais: 1,
    comValor: ["--after", "--before", "--chat", "--context-after", "--context-before", "--cursor", "--from", "--limit", "--type"],
    semValor: ["--forwarded", "--has-media", "--starred"],
  },
  {
    comando: ["messages", "list"],
    posicionais: 0,
    comValor: ["--after", "--before", "--chat", "--cursor", "--limit", "--sender"],
    semValor: ["--asc", "--forwarded", "--from-me", "--from-them", "--starred"],
  },
  {
    comando: ["chats", "list"],
    posicionais: 0,
    comValor: ["--limit", "--query"],
    semValor: ["--archived", "--muted", "--no-archived", "--no-muted", "--no-pinned", "--no-unread", "--pinned", "--unread"],
  },
  { comando: ["contacts", "search"], posicionais: 1, comValor: ["--limit"], semValor: [] },
  { comando: ["doctor"], posicionais: 0, comValor: [], semValor: [] },
];

declare const validada: unique symbol;
export interface LeituraPermitida {
  readonly args: readonly string[];
  /** O comando da lista, como `chats list`: diz que schema lê a resposta. */
  readonly comando: string;
  readonly [validada]: true;
}

/**
 * Monta o argv da leitura: comando, flags aceitas como `--flag=valor` e `--` antes dos
 * posicionais, para o wacli não ler como flag nada que o agente escreveu. `null` quando o comando
 * está fora da lista, traz qualquer outro argumento com traço ou erra a conta de posicionais.
 */
export function lerLeitura(args: readonly string[]): LeituraPermitida | null {
  const leitura = LEITURAS_PERMITIDAS.find(({ comando }) => comando.every((parte, indice) => args[indice] === parte));
  if (leitura === undefined) return null;
  const flags: string[] = [];
  const posicionais: string[] = [];
  for (let i = leitura.comando.length; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) {
      posicionais.push(arg);
      continue;
    }
    const igual = arg.indexOf("=");
    const nome = igual === -1 ? arg : arg.slice(0, igual);
    if (leitura.semValor.includes(arg)) flags.push(arg);
    else if (leitura.comValor.includes(nome)) {
      const valor = igual === -1 ? args[(i += 1)] : arg.slice(igual + 1);
      if (valor === undefined) return null;
      flags.push(`${nome}=${valor}`);
    } else return null;
  }
  if (posicionais.length !== leitura.posicionais) return null;
  return { args: [...leitura.comando, ...flags, "--", ...posicionais], comando: leitura.comando.join(" ") } as unknown as LeituraPermitida;
}

const linha = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()).optional() });

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

function telefoneDe(valor: unknown) {
  // Valor com `@` é JID: só o de pessoa (`@s.whatsapp.net`) carrega telefone, nunca um `@lid` nem um grupo.
  if (typeof valor === "string" && valor.includes("@")) return telefoneDoJid(valor);
  const digitos = /^\+?(\d{8,15})$/.exec(typeof valor === "string" ? valor.replace(/[\s().-]/g, "") : "")?.[1];
  return digitos === undefined ? null : lerTelefone(`+${digitos}`);
}

/**
 * Traduz uma linha NDJSON `{event, data, ts}` do stderr do wacli para um evento do domínio.
 * Linha que não é JSON, evento desconhecido e dado fora do formato devolvem `null`:
 * aviso humano no meio do stderr ou versão nova do wacli não derrubam o conector.
 */
export function interpretarLinhaDoWacli(bruta: string): EventoWhatsapp | null {
  let json: unknown;
  try {
    json = JSON.parse(bruta);
  } catch {
    return null;
  }
  const lida = linha.safeParse(json);
  if (!lida.success) return null;
  const dados = lida.data.data ?? {};
  switch (lida.data.event) {
    case "qr_code": {
      const codigo = texto(dados.code);
      return codigo === null ? null : { tipo: "qr_emitido", qr: payloadQr(codigo) };
    }
    case "pair_code": {
      const codigo = texto(dados.code);
      const telefone = telefoneDe(dados.phone);
      return codigo === null || telefone === null ? null : { tipo: "codigo_emitido", codigo, telefone };
    }
    case "connected":
      return { tipo: "ligou" };
    case "disconnected":
    case "reconnecting":
    case "stream_replaced":
      return { tipo: "caiu" };
    case "progress":
      return typeof dados.messages_synced === "number" ? { tipo: "progresso", mensagens: dados.messages_synced } : null;
    case "logged_out":
      return { tipo: "sessao_revogada", detalhe: textoExterno(texto(dados.reason) ?? "logged_out") };
    case "error": {
      // O wacli não dá código ao erro fatal; o texto é o que distingue os dois casos com saída própria.
      const mensagem = texto(dados.message) ?? "";
      if (/passkey/i.test(mensagem)) return { tipo: "passkey_exigida", detalhe: textoExterno(mensagem) };
      if (/storage limit reached/i.test(mensagem)) return { tipo: "limite_do_banco", detalhe: textoExterno(mensagem) };
      return null;
    }
    default:
      return null;
  }
}

const envelope = z.object({ success: z.boolean(), data: z.unknown() });

function dadosDoEnvelope(stdout: string): unknown {
  try {
    const lido = envelope.safeParse(JSON.parse(stdout));
    return lido.success && lido.data.success ? lido.data.data : undefined;
  } catch {
    return undefined;
  }
}

/** Corpo de qualquer resposta `--json`. `undefined` quando o wacli respondeu erro ou algo ilegível. */
export function lerResposta(stdout: string): { readonly dados: unknown } | undefined {
  const dados = dadosDoEnvelope(stdout);
  return dados === undefined ? undefined : { dados };
}

const envelopeDeErro = z.object({ success: z.literal(false), error: z.string().nullish() });

/**
 * O erro que o wacli escreveu no envelope de erro. Ele sai em stderr, uma linha JSON, mas aceitamos
 * também stdout. É para decidir o que fazer, nunca para repassar. `null` sem envelope de erro.
 */
export function lerErroDaResposta(...saidas: readonly string[]): string | null {
  for (const linha of saidas.flatMap((saida) => saida.split("\n")).reverse()) {
    try {
      const lido = envelopeDeErro.safeParse(JSON.parse(linha));
      if (lido.success) return lido.data.error ?? "";
    } catch {
      // Linha que não é JSON: aviso humano no stderr.
    }
  }
  return null;
}

const authStatus = z.object({
  authenticated: z.boolean(),
  linked_jid: z.string().optional(),
  phone: z.string().optional(),
});

export type AuthStatus = { readonly autenticado: false } | { readonly autenticado: true; readonly conta: ContaWhatsapp | null };

/** `wacli --read-only --json auth status`. É a prova de pareamento: o wacli não emite evento de "pareou". */
export function lerAuthStatus(stdout: string): AuthStatus | null {
  const lido = authStatus.safeParse(dadosDoEnvelope(stdout));
  if (!lido.success) return null;
  if (!lido.data.authenticated) return { autenticado: false };
  const telefone = telefoneDe(lido.data.phone) ?? telefoneDe(lido.data.linked_jid);
  return { autenticado: true, conta: telefone === null ? null : { telefone } };
}

const doctor = z.object({
  lock_held: z.boolean(),
  lock_owner_pid: z.number().int().positive().optional(),
  session_revoked: z.boolean().optional(),
});

export interface Doctor {
  /** Pid de quem segura o lock da store. `null` com a store livre. */
  readonly donoDoLock: number | null;
  readonly revogada: boolean;
}

/** `wacli --read-only --json doctor`. Sem `--connect`, não pega o lock nem fala com o WhatsApp. */
export function lerDoctor(stdout: string): Doctor | null {
  const lido = doctor.safeParse(dadosDoEnvelope(stdout));
  if (!lido.success) return null;
  return {
    donoDoLock: lido.data.lock_held ? (lido.data.lock_owner_pid ?? null) : null,
    revogada: lido.data.session_revoked ?? false,
  };
}
