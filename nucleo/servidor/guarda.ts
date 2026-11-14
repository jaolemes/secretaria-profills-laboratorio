import { mesmoTexto } from "../cofre";
import type { CodigoErro } from "../dominio";
import type { Sessoes } from "./sessoes";

/** Quem chama, decidido uma vez por pedido. As rotas recebem isto e não olham cabeçalho. */
export type Chamador = "painel" | "agente" | "anonimo";

export interface ContextoDaGuarda {
  /** `http://127.0.0.1:<porta>`. */
  readonly origem: string;
  /** Bearer do agente, o mesmo do `servidor.json`. */
  readonly token: string;
  readonly sessoes: Pick<Sessoes, "valida">;
}

export type Identificacao = { readonly ok: true; readonly chamador: Chamador } | { readonly ok: false; readonly codigo: CodigoErro };

const SITES_ACEITOS = ["same-origin", "none"];

/**
 * Regras 1 e 2, antes do roteamento, para pedido de outra origem não chegar a código de rota:
 * 1. `Host` diferente de `127.0.0.1:<porta>` é DNS rebinding ou outro programa: 403.
 * 2. `Origin`, quando vem, é a própria origem: 403 se não for.
 */
export function origemAceita(req: Request, contexto: ContextoDaGuarda): boolean {
  const origem = req.headers.get("origin");
  return req.headers.get("host") === new URL(contexto.origem).host && (origem === null || origem === contexto.origem);
}

/**
 * Regras 3 a 5, depois de `origemAceita`:
 * 3. `Sec-Fetch-Site` só `same-origin` ou `none` (outra porta de 127.0.0.1 é `same-site`): 403.
 *    A rota de retorno do OAuth é a exceção, porque o navegador chega vindo do CRM.
 * 4. `Authorization` só vale como Bearer do agente, sem `Origin`: um navegador nunca é agente.
 * 5. Cookie de sessão válido é o painel. O resto é anônimo.
 */
export function identificar(req: Request, contexto: ContextoDaGuarda, entreSites: boolean): Identificacao {
  const recusa = (codigo: CodigoErro): Identificacao => ({ ok: false, codigo });
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && !entreSites && !SITES_ACEITOS.includes(site)) return recusa("origem_recusada");

  const autorizacao = req.headers.get("authorization");
  if (autorizacao !== null) {
    if (req.headers.has("origin") || site !== null) return recusa("origem_recusada");
    return mesmoTexto(autorizacao, `Bearer ${contexto.token}`) ? { ok: true, chamador: "agente" } : recusa("nao_autorizado");
  }
  return { ok: true, chamador: contexto.sessoes.valida(req.headers.get("cookie")) ? "painel" : "anonimo" };
}

/**
 * O navegador manda estes três cabeçalhos quando o vendedor abre um link na barra de endereço
 * ou por outro programa, e não deixa página nenhuma forjá-los. `fetch`, `<img>`, `<iframe>` e um
 * programa que não os escreve de propósito ficam de fora.
 */
export function ehNavegacaoDeTopo(req: Request): boolean {
  return (
    req.headers.get("sec-fetch-site") === "none" &&
    req.headers.get("sec-fetch-mode") === "navigate" &&
    req.headers.get("sec-fetch-dest") === "document"
  );
}

export const LIMITE_DO_CORPO = 64 * 1024;

export type Corpo = { readonly ok: true; readonly valor: unknown } | { readonly ok: false; readonly codigo: CodigoErro };

/**
 * Lê o corpo com teto, sem confiar no `Content-Length`: um corpo em blocos também é cortado.
 * Sem corpo devolve `undefined`. Com corpo, exige JSON.
 */
export async function lerCorpo(req: Request): Promise<Corpo> {
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > LIMITE_DO_CORPO) return { ok: false, codigo: "corpo_grande" };
  if (req.body === null) return { ok: true, valor: undefined };
  const blocos: Uint8Array[] = [];
  let tamanho = 0;
  for await (const bloco of req.body) {
    tamanho += bloco.byteLength;
    if (tamanho > LIMITE_DO_CORPO) return { ok: false, codigo: "corpo_grande" };
    blocos.push(bloco);
  }
  if (tamanho === 0) return { ok: true, valor: undefined };
  const tipo = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (tipo !== "application/json") return { ok: false, codigo: "tipo_de_conteudo" };
  try {
    return { ok: true, valor: JSON.parse(Buffer.concat(blocos).toString("utf8")) };
  } catch {
    return { ok: false, codigo: "entrada_invalida" };
  }
}
