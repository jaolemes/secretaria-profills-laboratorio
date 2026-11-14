import { describe, expect, test } from "bun:test";
import type { Telefone } from "../../dominio";
import {
  ambienteDoWacli,
  argumentosDoWacli,
  interpretarLinhaDoWacli,
  lerAuthStatus,
  lerDoctor,
  lerErroDaResposta,
  lerLeitura,
  lerResposta,
  type UsoDoWacli,
} from "./wacli";

/** Saídas copiadas do wacli 0.26.0 de verdade, numa store vazia, em 11/11/2026. */
const DOCTOR_REAL =
  '{"success":true,"data":{"store_dir":"/tmp/store","lock_held":false,"authenticated":false,"session_revoked":false,"connected":false,"connection_state":"disconnected","fts_enabled":true,"store":{"messages":0,"chats":0,"contacts":0,"groups":0}},"error":null}';
const AUTH_STATUS_REAL = '{"success":true,"data":{"authenticated":false},"error":null}';
const ERRO_REAL = '{"event":"error","data":{"message":"not authenticated; run `wacli auth`"},"ts":1794414452178}';
const LEITURA_COM_ERRO_REAL = '{"success":false,"data":null,"error":"stat /tmp/store/wacli.db: no such file or directory"}';

const linha = (event: string, data?: unknown) => JSON.stringify(data === undefined ? { event, ts: 1 } : { event, data, ts: 1 });

describe("eventos do wacli", () => {
  test.each([
    [linha("qr_code", { code: "2@abc,def==" }), { tipo: "qr_emitido", qr: "2@abc,def==" }],
    [linha("pair_code", { phone: "5511912345678", code: "K7QP-2MZX" }), { tipo: "codigo_emitido", codigo: "K7QP-2MZX", telefone: "+5511912345678" }],
    [linha("pair_code", { phone: "+55 (11) 91234-5678", code: "K7QP-2MZX" }), { tipo: "codigo_emitido", codigo: "K7QP-2MZX", telefone: "+5511912345678" }],
    [linha("connected"), { tipo: "ligou" }],
    [linha("disconnected"), { tipo: "caiu" }],
    [linha("reconnecting"), { tipo: "caiu" }],
    [linha("stream_replaced"), { tipo: "caiu" }],
    [linha("progress", { messages_synced: 120 }), { tipo: "progresso", mensagens: 120 }],
    [linha("logged_out", { reason: "device_removed", reason_code: 401, on_connect: false }), { tipo: "sessao_revogada", detalhe: "device_removed" }],
    [
      linha("error", { message: "WhatsApp requires passkey verification, which wacli cannot safely complete yet" }),
      { tipo: "passkey_exigida", detalhe: "WhatsApp requires passkey verification, which wacli cannot safely complete yet" },
    ],
    [
      linha("error", { message: "sync storage limit reached: database size is 3, limit is 2" }),
      { tipo: "limite_do_banco", detalhe: "sync storage limit reached: database size is 3, limit is 2" },
    ],
  ])("%s", (bruta, esperado) => {
    expect<unknown>(interpretarLinhaDoWacli(bruta)).toEqual(esperado);
  });

  test.each([
    ERRO_REAL,
    linha("auth_starting"),
    linha("idle_exit", { messages_synced: 3 }),
    linha("warning", { code: "undecryptable_message", message: "x" }),
    linha("evento_de_uma_versao_futura", { qualquer: 1 }),
    linha("qr_code", { code: "" }),
    linha("qr_code", {}),
    linha("pair_code", { phone: "abc", code: "X" }),
    linha("pair_code", { phone: "55119999988881234", code: "X" }),
    linha("pair_code", { phone: "+5511912345678 ramal 2", code: "X" }),
    linha("progress", { messages_synced: "muitas" }),
    "Connected.",
    "",
    "{",
    "null",
    '"qr_code"',
    '{"event":7}',
  ])("ignora %s", (bruta) => {
    expect(interpretarLinhaDoWacli(bruta)).toBeNull();
  });
});

describe("respostas --json", () => {
  test("auth status sem conta, com conta e ilegível", () => {
    expect(lerAuthStatus(AUTH_STATUS_REAL)).toEqual({ autenticado: false });
    const comConta = '{"success":true,"data":{"authenticated":true,"linked_jid":"5511912345678@s.whatsapp.net","phone":"5511912345678"},"error":null}';
    expect<unknown>(lerAuthStatus(comConta)).toEqual({ autenticado: true, conta: { telefone: "+5511912345678" } });
    const longo = '{"success":true,"data":{"authenticated":true,"phone":"55119999988881234"},"error":null}';
    expect<unknown>(lerAuthStatus(longo)).toEqual({ autenticado: true, conta: null });
    const soJid = '{"success":true,"data":{"authenticated":true,"linked_jid":"5511912345678:12@s.whatsapp.net"},"error":null}';
    expect<unknown>(lerAuthStatus(soJid)).toEqual({ autenticado: true, conta: { telefone: "+5511912345678" } });
    expect(lerAuthStatus('{"success":true,"data":{"authenticated":true},"error":null}')).toEqual({ autenticado: true, conta: null });
    for (const lixo of ["", "Not authenticated.", LEITURA_COM_ERRO_REAL, '{"success":true,"data":{},"error":null}']) {
      expect(lerAuthStatus(lixo)).toBeNull();
    }
  });

  test("um JID @lid nunca vira telefone: os dígitos dele são um identificador interno", () => {
    const lid = '{"success":true,"data":{"authenticated":true,"linked_jid":"198765432109876@lid"},"error":null}';
    expect<unknown>(lerAuthStatus(lid)).toEqual({ autenticado: true, conta: null });
    const lidEPhone = '{"success":true,"data":{"authenticated":true,"linked_jid":"198765432109876@lid","phone":"5511912345678"},"error":null}';
    expect<unknown>(lerAuthStatus(lidEPhone)).toEqual({ autenticado: true, conta: { telefone: "+5511912345678" } });
    const grupo = '{"success":true,"data":{"authenticated":true,"linked_jid":"5511912345678-1600000000@g.us"},"error":null}';
    expect<unknown>(lerAuthStatus(grupo)).toEqual({ autenticado: true, conta: null });
    const evento = linha("pair_code", { phone: "198765432109876@lid", code: "K7QP-2MZX" });
    expect(interpretarLinhaDoWacli(evento)).toBeNull();
  });

  test("doctor: lock livre, lock com dono e sessão revogada", () => {
    expect(lerDoctor(DOCTOR_REAL)).toEqual({ donoDoLock: null, revogada: false });
    const preso = '{"success":true,"data":{"lock_held":true,"lock_owner_pid":4242,"authenticated":true,"session_revoked":false},"error":null}';
    expect(lerDoctor(preso)).toEqual({ donoDoLock: 4242, revogada: false });
    const revogada = '{"success":true,"data":{"lock_held":false,"authenticated":false,"session_revoked":true},"error":null}';
    expect(lerDoctor(revogada)).toEqual({ donoDoLock: null, revogada: true });
    expect(lerDoctor("")).toBeNull();
    expect(lerDoctor(LEITURA_COM_ERRO_REAL)).toBeNull();
  });

  test("o erro do envelope só serve para decidir, e só vem de envelope de erro", () => {
    expect(lerErroDaResposta('{"success":false,"data":null,"error":"sql: no rows in result set"}')).toBe("sql: no rows in result set");
    // O wacli real escreve o envelope de erro em stderr, depois de avisos humanos.
    expect(lerErroDaResposta("", 'Note: algo\n{"success":false,"data":null,"error":"sql: no rows in result set"}\n')).toBe("sql: no rows in result set");
    expect(lerErroDaResposta('{"success":false,"data":null,"error":null}')).toBe("");
    expect(lerErroDaResposta('{"success":true,"data":[],"error":null}')).toBeNull();
    expect(lerErroDaResposta("texto")).toBeNull();
  });

  test("resposta de leitura", () => {
    expect(lerResposta('{"success":true,"data":[{"id":1}],"error":null}')).toEqual({ dados: [{ id: 1 }] });
    expect(lerResposta('{"success":true,"data":null,"error":null}')).toEqual({ dados: null });
    expect(lerResposta(LEITURA_COM_ERRO_REAL)).toBeUndefined();
    expect(lerResposta("texto")).toBeUndefined();
  });
});

describe("argv do wacli", () => {
  const leitura = lerLeitura(["chats", "list", "--limit", "5"]);
  const usos: UsoDoWacli[] = [
    { uso: "pareamento", entrada: { meio: "qr" } },
    { uso: "pareamento", entrada: { meio: "codigo", telefone: "+5511912345678" as Telefone } },
    { uso: "espelho" },
    { uso: "sondar_auth" },
    { uso: "sondar_doctor" },
    { uso: "encerrar_sessao" },
    ...(leitura === null ? [] : [{ uso: "leitura" as const, leitura }]),
    { uso: "leitura_do_servidor", leitura: { comando: "contacts resolve", identidades: ["+5511900000001", "198765432109876@lid", "--store=/outra"] } },
    { uso: "leitura_do_servidor", leitura: { comando: "messages show", conversa: "5511900000001@s.whatsapp.net", id: "3EB0CANARIO01" } },
  ];

  test("cada uso tem o argv esperado", () => {
    expect(usos.map((uso) => argumentosDoWacli(uso).join(" "))).toEqual([
      "auth --events --history-days 90",
      "auth --events --history-days 90 --phone +5511912345678",
      "sync --follow --events --presence-mode quiet --max-reconnect 0",
      "--read-only --json auth status",
      "--read-only --json doctor",
      "auth logout",
      "--read-only --json chats list --limit=5 --",
      "--read-only --json contacts resolve -- +5511900000001 198765432109876@lid --store=/outra",
      "--read-only --json messages show --chat=5511900000001@s.whatsapp.net --id=3EB0CANARIO01",
    ]);
  });

  test("nenhum uso produz comando de envio, e só três usos escrevem", () => {
    const escrevem = usos.filter((uso) => ambienteDoWacli("/store", uso).WACLI_READONLY !== "1").map((uso) => uso.uso);
    expect(escrevem).toEqual(["pareamento", "pareamento", "espelho", "encerrar_sessao"]);
    for (const uso of usos) {
      const args = argumentosDoWacli(uso);
      expect(args).not.toContain("send");
      expect(ambienteDoWacli("/store", uso)).toMatchObject({ WACLI_STORE_DIR: "/store", WACLI_SYNC_MAX_DB_SIZE: "2GB" });
      if (ambienteDoWacli("/store", uso).WACLI_READONLY === "1") expect(args.slice(0, 2)).toEqual(["--read-only", "--json"]);
    }
  });

  test("contacts resolve é uso do servidor: não está na lista do agente", () => {
    expect(lerLeitura(["contacts", "resolve", "198765432109876@lid"])).toBeNull();
    expect(lerLeitura(["messages", "show", "--chat", "x", "--id", "y"])).toBeNull();
    expect(lerLeitura(["chats", "list"])?.comando).toBe("chats list");
    expect(lerLeitura(["messages", "search", "oi"])?.comando).toBe("messages search");
  });

  test("a leitura sai com as flags aceitas no formato --flag=valor e -- antes dos posicionais", () => {
    const casos: readonly (readonly [readonly string[], string])[] = [
      [["messages", "search", "send"], "messages search -- send"],
      [["messages", "search", "pedido 123", "--limit", "5", "--has-media"], "messages search --limit=5 --has-media -- pedido 123"],
      [["messages", "search", "--chat=5511912345678", "--after", "2026-01-01", "oi"], "messages search --chat=5511912345678 --after=2026-01-01 -- oi"],
      // O valor de uma flag aceita pode começar com traço: ele viaja colado na flag e não vira outra.
      [["messages", "list", "--chat", "--store", "--asc"], "messages list --chat=--store --asc --"],
      [["chats", "list", "--unread", "--query", "ana"], "chats list --unread --query=ana --"],
      [["contacts", "search", "ana", "--limit=3"], "contacts search --limit=3 -- ana"],
      [["doctor"], "doctor --"],
    ];
    for (const [args, esperado] of casos) expect(lerLeitura(args)?.args.join(" ")).toBe(esperado);
  });

  test("a leitura recusa comando fora da lista, flag fora da lista do comando e posicional a mais ou a menos", () => {
    const recusados: readonly (readonly string[])[] = [
      [],
      ["send"],
      ["messages"],
      ["messages", "edit"],
      ["chats", "archive"],
      ["doctor", "--connect"],
      ["chats", "list", "--json=false"],
      ["messages", "list", "--store", "/outra"],
      ["messages", "list", "--store=/outra"],
      ["messages", "list", "--account", "outra"],
      ["messages", "list", "--read-only=false"],
      ["messages", "list", "--timeout", "1h"],
      ["messages", "list", "--events"],
      ["messages", "list", "--full"],
      ["messages", "list", "--help"],
      ["messages", "list", "-h"],
      // Abreviação de flag do Cobra e flag de outro comando.
      ["messages", "list", "--stor", "/outra"],
      ["messages", "list", "--has-media"],
      ["chats", "list", "--chat", "x"],
      ["messages", "list", "--asc=false"],
      ["messages", "list", "--limit"],
      ["messages", "list", "--"],
      ["messages", "list", "sobra"],
      ["messages", "search"],
      ["messages", "search", "um", "dois"],
      ["messages", "search", "-x"],
      ["messages", "search", "--", "--store"],
      ["doctor", "x"],
    ];
    for (const args of recusados) expect({ args, lida: lerLeitura(args) }).toEqual({ args, lida: null });
  });
});
