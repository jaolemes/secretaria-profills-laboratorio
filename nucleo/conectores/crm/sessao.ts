import type { Segredo } from "../../cofre";
import { abrirSessao, type RespostaMcp, type SessaoMcp } from "./mcp";

/** O acesso que a casca do CRM empresta ao leitor e ao escritor. */
export interface AcessoAoCrm {
  /** Access token renovado quando preciso, uma renovação por vez. `null` sem conexão válida. */
  token(): Promise<Segredo | null>;
  /** A origem do emissor do OAuth, como `URL.origin` a escreve. `null` enquanto a descoberta não respondeu. */
  origemDasTelas(): Promise<string | null>;
  /** O MCP recusou este token: a casca o descarta e a próxima chamada renova. */
  recusado(token: Segredo): void;
  /** Recusou também o token novo, ou o CRM diz que a sessão não tem usuário: a casca confere a conexão inteira. */
  vencido(): void;
}

/** Repetir resolve: o token foi recusado (401) ou a sessão do MCP expirou (404 numa sessão aberta). O CRM recusou antes de executar. */
export type Repetir = "token_recusado" | "sessao_expirada";

export interface Aberta {
  readonly sessao: SessaoMcp;
  readonly token: Segredo;
  readonly origemDasTelas: string | null;
}

export type FalhaDaAbertura = { readonly tipo: "rede" } | { readonly tipo: "http"; readonly resposta: RespostaMcp };

/** O que muda entre quem lê e quem escreve: como cada situação vira o resultado de quem chama. */
export interface PoliticaDaSessao<F> {
  semToken(): F;
  /** O resultado final, ou o motivo de abrir outra sessão. */
  aoFalharAAbertura(falha: FalhaDaAbertura): F | Repetir;
  /** As duas tentativas acabaram em motivo de repetir. */
  esgotou(motivo: Repetir): F;
  /** Cada resultado final de uma tentativa, menos o de `esgotou`. */
  aoTerminar?(resultado: unknown): void;
}

type Passo<F> =
  | { readonly tipo: "aberta"; readonly aberta: Aberta }
  | { readonly tipo: "fim"; readonly resultado: F }
  | { readonly tipo: "repetir"; readonly motivo: Repetir; readonly token: Segredo | null };

/**
 * O laço de sessão que a leitura e a escrita dividem. A sessão MCP abre na primeira chamada e se reaproveita.
 * Um 401 descarta o token e tenta uma vez com outro; o segundo 401 chama `esgotou`. Um 404 na sessão
 * aberta é a sessão do MCP que expirou: abre outra, uma vez. Nada além desses dois motivos repete:
 * só eles garantem que o CRM recusou antes de executar.
 */
export function criarCorredor<F extends object>(recurso: URL, acesso: AcessoAoCrm, sinal: AbortSignal, politica: PoliticaDaSessao<F>) {
  let aberta: Aberta | null = null;

  async function abrir(): Promise<Passo<F>> {
    if (aberta !== null) return { tipo: "aberta", aberta };
    const token = await acesso.token();
    if (token === null) return { tipo: "fim", resultado: politica.semToken() };
    const abertura = await abrirSessao(recurso, token, sinal);
    if (abertura.tipo !== "ok") {
      const falhou = politica.aoFalharAAbertura(abertura);
      return typeof falhou === "string" ? { tipo: "repetir", motivo: falhou, token } : { tipo: "fim", resultado: falhou };
    }
    aberta = { sessao: abertura.sessao, token, origemDasTelas: await acesso.origemDasTelas() };
    return { tipo: "aberta", aberta };
  }

  return async function executar<T extends object>(chamar: (aberta: Aberta) => Promise<T | Repetir>): Promise<T | F> {
    let motivo: Repetir = "sessao_expirada";
    for (const tentativa of [1, 2]) {
      const passo = await abrir();
      let proximo: Passo<T | F> | Passo<F>;
      if (passo.tipo === "aberta") {
        const feito = await chamar(passo.aberta);
        proximo = typeof feito === "string" ? { tipo: "repetir", motivo: feito, token: passo.aberta.token } : { tipo: "fim", resultado: feito };
      } else proximo = passo;
      if (proximo.tipo === "fim") {
        politica.aoTerminar?.(proximo.resultado);
        return proximo.resultado;
      }
      motivo = proximo.motivo;
      if (motivo === "token_recusado" && proximo.token !== null) acesso.recusado(proximo.token);
      aberta = null;
      if (tentativa === 2) break;
    }
    return politica.esgotou(motivo);
  };
}
