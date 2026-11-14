import { z } from "zod";
import type { Segredo } from "../../cofre";
import { textoExterno, type TextoExterno } from "../../dominio";

/** Cliente mínimo do MCP do CRM (Streamable HTTP): abre a sessão e chama métodos dela. */

const ESPERA_MS = 10_000;
const VERSAO_DO_PROTOCOLO = "2025-06-18";
const PAGINAS_NO_MAXIMO = 10;

export type ContagemDeFerramentas =
  | { readonly tipo: "ok"; readonly ferramentas: number }
  /** 401: o access token não vale mais. */
  | { readonly tipo: "nao_autorizado" }
  | { readonly tipo: "indeterminado"; readonly detalhe: TextoExterno };

const respostaRpc = z.object({ result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });
const listaDeFerramentas = z.object({ tools: z.array(z.unknown()), nextCursor: z.string().optional() });

/** O servidor pode responder JSON puro ou um fluxo SSE com a resposta em `data:`. */
function lerCorpo(texto: string, tipo: string): unknown {
  const bruto = tipo.includes("text/event-stream")
    ? texto
        .split(/\r?\n/)
        .filter((linha) => linha.startsWith("data:"))
        .map((linha) => linha.slice(5).trim())
        .findLast((dado) => dado !== "")
    : texto;
  try {
    return bruto === undefined ? null : JSON.parse(bruto);
  } catch {
    return null;
  }
}

/** `Retry-After` em segundos ou em data HTTP. Sem o cabeçalho, ou ilegível, `null`. */
function lerEspera(valor: string | null, agoraMs: number): number | null {
  if (valor === null) return null;
  if (/^\d+$/.test(valor.trim())) return Number(valor.trim());
  const quando = Date.parse(valor);
  return Number.isNaN(quando) ? null : Math.max(0, Math.ceil((quando - agoraMs) / 1000));
}

/** Uma resposta do MCP. `resultado` é o `result` do JSON-RPC; `erroRpc`, a mensagem do `error`. */
export interface RespostaMcp {
  readonly status: number;
  readonly resultado: unknown;
  readonly erroRpc: string | null;
  /** Segundos do `Retry-After`, quando veio. */
  readonly esperaS: number | null;
}

export interface SessaoMcp {
  /** `null` quando a rede caiu, o prazo venceu ou o pedido foi cortado. */
  chamar(metodo: string, params: Record<string, unknown>): Promise<RespostaMcp | null>;
  /** O texto repete o token da sessão. Quem guarda ou mostra texto do MCP o descarta nesse caso. */
  levaOToken(texto: string): boolean;
}

export type AberturaDaSessao =
  | { readonly tipo: "ok"; readonly sessao: SessaoMcp }
  | { readonly tipo: "rede" }
  | { readonly tipo: "http"; readonly resposta: RespostaMcp };

/** Faz o `initialize` e o `notifications/initialized`. Toda chamada da sessão leva o mesmo token. */
export async function abrirSessao(recurso: URL, acesso: Segredo, sinal: AbortSignal): Promise<AberturaDaSessao> {
  let idDaSessao: string | null = null;
  let id = 0;

  async function enviar(metodo: string, params: Record<string, unknown>, esperaResposta: boolean): Promise<RespostaMcp | null> {
    try {
      const resposta = await fetch(recurso, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([sinal, AbortSignal.timeout(ESPERA_MS)]),
        headers: {
          authorization: `Bearer ${acesso.revelar()}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": VERSAO_DO_PROTOCOLO,
          ...(idDaSessao === null ? {} : { "mcp-session-id": idDaSessao }),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: metodo, params, ...(esperaResposta ? { id: (id += 1) } : {}) }),
      });
      const texto = await resposta.text();
      const lido = respostaRpc.safeParse(lerCorpo(texto, resposta.headers.get("content-type") ?? ""));
      idDaSessao ??= resposta.headers.get("mcp-session-id");
      return {
        status: resposta.status,
        resultado: lido.success && lido.data.error === undefined ? lido.data.result : undefined,
        erroRpc: lido.success ? (lido.data.error?.message ?? null) : null,
        esperaS: lerEspera(resposta.headers.get("retry-after"), Date.now()),
      };
    } catch {
      return null;
    }
  }

  const abertura = await enviar(
    "initialize",
    { protocolVersion: VERSAO_DO_PROTOCOLO, capabilities: {}, clientInfo: { name: "secretaria-profills", version: "1" } },
    true,
  );
  if (abertura === null) return { tipo: "rede" };
  if (abertura.status !== 200 || abertura.resultado === undefined) return { tipo: "http", resposta: abertura };
  await enviar("notifications/initialized", {}, false);
  return { tipo: "ok", sessao: { chamar: (metodo, params) => enviar(metodo, params, true), levaOToken: (texto) => texto.includes(acesso.revelar()) } };
}

export async function contarFerramentas(recurso: URL, acesso: Segredo, sinal: AbortSignal): Promise<ContagemDeFerramentas> {
  const indeterminado = (detalhe: string): ContagemDeFerramentas => ({ tipo: "indeterminado", detalhe: textoExterno(detalhe) });

  const aberta = await abrirSessao(recurso, acesso, sinal);
  if (aberta.tipo === "rede") return indeterminado("o MCP do CRM não respondeu");
  if (aberta.tipo === "http") {
    if (aberta.resposta.status === 401) return { tipo: "nao_autorizado" };
    return indeterminado(`o MCP respondeu HTTP ${aberta.resposta.status} ao initialize`);
  }

  let ferramentas = 0;
  let cursor: string | undefined;
  for (let pagina = 0; pagina < PAGINAS_NO_MAXIMO; pagina += 1) {
    const lista = await aberta.sessao.chamar("tools/list", cursor === undefined ? {} : { cursor });
    if (lista === null) return indeterminado("o MCP do CRM parou de responder");
    if (lista.status === 401) return { tipo: "nao_autorizado" };
    const lida = listaDeFerramentas.safeParse(lista.resultado);
    if (lista.status !== 200 || !lida.success) return indeterminado(`o MCP respondeu HTTP ${lista.status} ao tools/list`);
    ferramentas += lida.data.tools.length;
    cursor = lida.data.nextCursor;
    if (cursor === undefined) break;
  }
  return { tipo: "ok", ferramentas };
}
