import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Segredo } from "../../cofre";
import { textoExterno, type MotivoDaRecusa, type TextoExterno } from "../../dominio";

/**
 * Cliente OAuth 2.1 do CRM: descoberta, PKCE S256, autorização no navegador e troca de tokens.
 * A Secretária é um client público identificado por CIMD: o `client_id` é a URL https do
 * documento `cliente-oauth.json`, e o CRM só o aceita quando a URL está na allowlist dele.
 *
 * Regras conferidas contra o CRM em 11/11/2026, nos dois `.well-known` de produção e na documentação do MCP:
 * - o authorize responde 400 com página de erro, sem redirecionar, quando recusa o client ou o
 *   redirect; com o client aceito e sem sessão, redireciona para o login;
 * - o redirect loopback registrado aceita qualquer porta (RFC 8252 §7.3);
 * - o retorno traz `code`, `state` e `iss`;
 * - o token endpoint só aceita `application/x-www-form-urlencoded` e responde
 *   `{access_token, token_type, expires_in, refresh_token, scope}`;
 * - o refresh rotaciona: cada troca devolve um refresh novo, e a Secretária guarda só o último.
 */

export const CAMINHO_DE_RETORNO = "/oauth/crm/retorno";
export const ESCOPO = "crm.leitura";
/** Prazo da conexão: depois dele, o vendedor conecta o CRM de novo no painel. */
export const VIDA_DA_CONEXAO_MS = 90 * 24 * 3_600_000;

const ESPERA_MS = 10_000;
const LIMITE_DO_CORPO = 65_536;

export interface Falha {
  readonly motivo: MotivoDaRecusa;
  readonly detalhe: TextoExterno;
}

export interface ServidorDeAutorizacao {
  readonly emissor: string;
  readonly autorizacao: URL;
  readonly token: URL;
}

export interface Cliente {
  /** URL pública do documento CIMD. */
  readonly clientId: URL;
  /** URL do recurso MCP, que vai como `resource`. */
  readonly recurso: URL;
}

export interface Pendente {
  readonly state: string;
  readonly verificador: Segredo;
  readonly redirectUri: string;
  readonly servidor: ServidorDeAutorizacao;
  /** O navegador do vendedor abre esta URL. */
  readonly url: URL;
}

export interface Tokens {
  readonly acesso: Segredo;
  readonly refresh: Segredo;
  readonly acessoValeMs: number;
}

type Tentativa<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly falha: Falha };

function falhou(motivo: MotivoDaRecusa, detalhe: string): { readonly ok: false; readonly falha: Falha } {
  return { ok: false, falha: { motivo, detalhe: textoExterno(detalhe.slice(0, 300)) } };
}

/** https, ou http só em loopback (o CRM falso dos testes). */
function urlSegura(texto: unknown): URL | null {
  if (typeof texto !== "string") return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  return url.protocol === "https:" || (local && url.protocol === "http:") ? url : null;
}

function semBarraFinal(texto: string): string {
  return texto.replace(/\/+$/, "");
}

function bemConhecida(base: URL, sufixo: string): URL {
  const caminho = base.pathname === "/" ? "" : semBarraFinal(base.pathname);
  return new URL(`/.well-known/${sufixo}${caminho}`, base.origin);
}

function comPrazo(sinal: AbortSignal): AbortSignal {
  return AbortSignal.any([sinal, AbortSignal.timeout(ESPERA_MS)]);
}

type Corpo = { readonly status: number; readonly json: unknown; readonly cabecalhos: Headers };

async function pedirJson(url: URL, init: RequestInit, sinal: AbortSignal): Promise<Corpo | null> {
  try {
    const resposta = await fetch(url, { ...init, redirect: "manual", signal: comPrazo(sinal) });
    const texto = await resposta.text();
    let json: unknown = null;
    if (texto.length <= LIMITE_DO_CORPO) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = null;
      }
    }
    return { status: resposta.status, json, cabecalhos: resposta.headers };
  } catch {
    return null;
  }
}

const metadadosDoRecurso = z.object({ resource: z.string(), authorization_servers: z.array(z.string()).min(1) });
const metadadosDoServidor = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  code_challenge_methods_supported: z.array(z.string()),
});

/** Do recurso MCP até os endpoints do servidor de autorização (RFC 9728 e RFC 8414). */
export async function descobrir(recurso: URL, sinal: AbortSignal): Promise<Tentativa<ServidorDeAutorizacao>> {
  const doRecurso = await pedirJson(bemConhecida(recurso, "oauth-protected-resource"), {}, sinal);
  if (doRecurso === null || doRecurso.status !== 200) return falhou("inacessivel", "o CRM não entregou os metadados do recurso");
  const lidoDoRecurso = metadadosDoRecurso.safeParse(doRecurso.json);
  if (!lidoDoRecurso.success || semBarraFinal(lidoDoRecurso.data.resource) !== semBarraFinal(recurso.href)) {
    return falhou("retorno_invalido", "os metadados do recurso não são deste CRM");
  }
  const emissor = urlSegura(lidoDoRecurso.data.authorization_servers[0]);
  if (emissor === null) return falhou("retorno_invalido", "o servidor de autorização anunciado não é https");

  const doServidor = await pedirJson(bemConhecida(emissor, "oauth-authorization-server"), {}, sinal);
  if (doServidor === null || doServidor.status !== 200) {
    return falhou("inacessivel", "o CRM não entregou os metadados do servidor de autorização");
  }
  const lido = metadadosDoServidor.safeParse(doServidor.json);
  const autorizacao = lido.success ? urlSegura(lido.data.authorization_endpoint) : null;
  const token = lido.success ? urlSegura(lido.data.token_endpoint) : null;
  if (!lido.success || autorizacao === null || token === null) {
    return falhou("retorno_invalido", "os metadados do servidor de autorização estão incompletos");
  }
  if (semBarraFinal(lido.data.issuer) !== semBarraFinal(emissor.href)) {
    return falhou("retorno_invalido", "o emissor dos metadados difere do servidor anunciado");
  }
  if (!lido.data.code_challenge_methods_supported.includes("S256")) {
    return falhou("retorno_invalido", "o servidor de autorização não aceita PKCE S256");
  }
  return { ok: true, valor: { emissor: lido.data.issuer, autorizacao, token } };
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function desafioS256(verificador: Segredo): Promise<string> {
  const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador.revelar()));
  return base64url(new Uint8Array(resumo));
}

/**
 * Pergunta ao CRM, sem sessão, o que ele faria com este pedido. Um client fora da allowlist
 * recebe uma página de erro no navegador e a Secretária nunca saberia: esta consulta traz a
 * recusa para o cartão.
 */
async function conferirPedido(url: URL, redirectUri: string, sinal: AbortSignal): Promise<Falha | null> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { redirect: "manual", signal: comPrazo(sinal) });
    await resposta.body?.cancel();
  } catch {
    return falhou("inacessivel", "o CRM não respondeu ao pedido de autorização").falha;
  }
  // 404 também: o CRM respondeu, então conferir a internet não resolve; quem resolve é o administrador.
  if (resposta.status === 400 || resposta.status === 401 || resposta.status === 403 || resposta.status === 404) {
    return falhou("app_nao_liberado", `o CRM recusou o aplicativo (HTTP ${resposta.status})`).falha;
  }
  if (resposta.status >= 300 && resposta.status < 400) {
    const destino = resposta.headers.get("location") ?? "";
    if (!destino.startsWith(redirectUri)) return null;
    const erro = new URL(destino).searchParams.get("error") ?? "sem código";
    return falhou("retorno_invalido", `o CRM recusou o pedido de autorização: ${erro}`).falha;
  }
  return resposta.ok ? null : falhou("inacessivel", `o CRM respondeu HTTP ${resposta.status}`).falha;
}

/** Descobre o servidor, gera `state` e PKCE, monta a URL e confere se o CRM aceita o aplicativo. */
export async function prepararAutorizacao(
  cliente: Cliente,
  portaLocal: number,
  sinal: AbortSignal,
): Promise<Tentativa<Pendente>> {
  const descoberta = await descobrir(cliente.recurso, sinal);
  if (!descoberta.ok) return descoberta;
  const servidor = descoberta.valor;

  const verificador = Segredo.de(base64url(crypto.getRandomValues(new Uint8Array(32))));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = `http://127.0.0.1:${portaLocal}${CAMINHO_DE_RETORNO}`;

  const url = new URL(servidor.autorizacao);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cliente.clientId.href);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await desafioS256(verificador));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", cliente.recurso.href);
  url.searchParams.set("scope", ESCOPO);

  const recusa = await conferirPedido(url, redirectUri, sinal);
  if (recusa !== null) return { ok: false, falha: recusa };
  return { ok: true, valor: { state, verificador, redirectUri, servidor, url } };
}

/** Comparação em tempo constante: o `state` do retorno chega de fora. */
export function mesmoState(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MOTIVO_DO_ERRO: Readonly<Record<string, MotivoDaRecusa>> = {
  access_denied: "acesso_negado",
  invalid_client: "app_nao_liberado",
  unauthorized_client: "app_nao_liberado",
};

const respostaDeToken = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
});
const respostaDeErro = z.object({ error: z.string() });

type RespostaDoToken =
  | { readonly tipo: "ok"; readonly tokens: Tokens }
  | { readonly tipo: "erro"; readonly erro: string }
  /** Sem resposta, ou resposta de um intermediário: não dá para saber se o CRM processou. */
  | { readonly tipo: "sem_resposta"; readonly detalhe: string };

async function pedirToken(servidor: ServidorDeAutorizacao, campos: Record<string, string>, sinal: AbortSignal): Promise<RespostaDoToken> {
  const resposta = await pedirJson(
    servidor.token,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(campos).toString(),
    },
    sinal,
  );
  if (resposta === null) return { tipo: "sem_resposta", detalhe: "o CRM não respondeu ao pedido de token" };
  if (resposta.status >= 500) return { tipo: "sem_resposta", detalhe: `o CRM respondeu HTTP ${resposta.status}` };
  if (resposta.status === 200) {
    const lido = respostaDeToken.safeParse(resposta.json);
    if (!lido.success) return { tipo: "erro", erro: "resposta_ilegivel" };
    return {
      tipo: "ok",
      tokens: {
        acesso: Segredo.de(lido.data.access_token),
        refresh: Segredo.de(lido.data.refresh_token),
        acessoValeMs: lido.data.expires_in * 1000,
      },
    };
  }
  const erro = respostaDeErro.safeParse(resposta.json);
  return { tipo: "erro", erro: erro.success ? erro.data.error : `http_${resposta.status}` };
}

/**
 * Confere o retorno do navegador (`error`, `iss`, `code`) e troca o código pelos tokens.
 * Quem chama já conferiu o `state` e já tirou o pendente de circulação.
 */
export async function trocarCodigo(
  pendente: Pendente,
  cliente: Cliente,
  retorno: URLSearchParams,
  sinal: AbortSignal,
): Promise<Tentativa<Tokens>> {
  // Um servidor de autorização malicioso pode devolver o code de outro (mix-up): o `iss` denuncia.
  if (semBarraFinal(retorno.get("iss") ?? "") !== semBarraFinal(pendente.servidor.emissor)) {
    return falhou("retorno_invalido", "o retorno veio de outro emissor");
  }
  const erro = retorno.get("error");
  if (erro !== null) return falhou(MOTIVO_DO_ERRO[erro] ?? "retorno_invalido", `o CRM devolveu ${erro}`);
  const codigo = retorno.get("code");
  if (codigo === null || codigo === "") return falhou("retorno_invalido", "o retorno veio sem código");

  const resposta = await pedirToken(
    pendente.servidor,
    {
      grant_type: "authorization_code",
      code: codigo,
      redirect_uri: pendente.redirectUri,
      client_id: cliente.clientId.href,
      code_verifier: pendente.verificador.revelar(),
      resource: cliente.recurso.href,
    },
    sinal,
  );
  if (resposta.tipo === "ok") return { ok: true, valor: resposta.tokens };
  if (resposta.tipo === "sem_resposta") return falhou("inacessivel", resposta.detalhe);
  return falhou(MOTIVO_DO_ERRO[resposta.erro] ?? "retorno_invalido", `o CRM recusou a troca do código: ${resposta.erro}`);
}

export type Renovacao =
  | { readonly tipo: "ok"; readonly tokens: Tokens }
  /** O CRM recusou o refresh: a conexão acabou e só um login novo resolve. */
  | { readonly tipo: "recusado" }
  | { readonly tipo: "indeterminado"; readonly detalhe: TextoExterno };

/**
 * Troca o refresh por um par novo. Quem chama garante uma chamada por vez: duas renovações
 * com o mesmo refresh fazem o CRM revogar a conexão.
 */
export async function renovar(
  servidor: ServidorDeAutorizacao,
  cliente: Cliente,
  refresh: Segredo,
  sinal: AbortSignal,
): Promise<Renovacao> {
  const campos = {
    grant_type: "refresh_token",
    refresh_token: refresh.revelar(),
    client_id: cliente.clientId.href,
    resource: cliente.recurso.href,
  };
  let resposta = await pedirToken(servidor, campos, sinal);
  // A resposta pode ter se perdido depois de o CRM rotacionar. Ele aceita o mesmo refresh mais
  // uma vez em 30 s justamente para isso; esperar a próxima renovação cairia fora da janela.
  if (resposta.tipo === "sem_resposta" && !sinal.aborted) resposta = await pedirToken(servidor, campos, sinal);
  if (resposta.tipo === "ok") return { tipo: "ok", tokens: resposta.tokens };
  if (resposta.tipo === "sem_resposta") return { tipo: "indeterminado", detalhe: textoExterno(resposta.detalhe) };
  if (resposta.erro === "invalid_grant" || resposta.erro === "invalid_client") return { tipo: "recusado" };
  return { tipo: "indeterminado", detalhe: textoExterno(`o CRM respondeu ${resposta.erro}`.slice(0, 300)) };
}
