import { randomBytes } from "node:crypto";
import { Segredo, type Cofre } from "../cofre";

export const NOME_DO_COOKIE = "secretaria_sessao";
const VIDA_DO_BILHETE_MS = 60_000;
export const VIDA_DA_SESSAO_MS = 30 * 24 * 3600 * 1000;
/** Abas e navegadores com sessão ao mesmo tempo. A mais antiga sai quando entra uma além do teto. */
export const TETO_DE_SESSOES = 5;

export interface Sessoes {
  /** Bilhete de uso único que `bun secretaria abrir` põe na URL de entrada. */
  emitirBilhete(): string;
  /** Troca o bilhete pelo valor do cookie `Set-Cookie`, ou `null` se ele já foi usado ou venceu. */
  trocarBilhete(bilhete: string): Promise<string | null>;
  valida(cookies: string | null): boolean;
  /**
   * Faz desta sessão a guardada no cofre, a única que o servidor seguinte aceita. É a aba que pediu
   * a atualização: as outras pedem entrada nova depois do restart. `false` quando o cookie não vale.
   */
  guardarParaORestart(cookies: string | null): Promise<boolean>;
}

function aleatorio(): string {
  return randomBytes(32).toString("base64url");
}

/** O valor da sessão é `<vencimento em base 36>.<aleatório>`. */
function vencimentoDe(valor: string): number | null {
  const venceEm = Number.parseInt(valor.split(".")[0] ?? "", 36);
  return Number.isSafeInteger(venceEm) ? venceEm : null;
}

/**
 * A sessão é um valor que o servidor gera e guarda no cofre como `Segredo`. Conferir por `igual`
 * dispensa revelar o valor guardado, e o guardado sobrevive a um restart, então a aba aberta
 * continua valendo depois que o servidor sobe de novo. O vencimento viaja dentro do valor: só
 * conta depois de o cookie bater com um valor emitido, então quem o adultera perde a sessão.
 * Cada bilhete troca a sessão guardada; as `TETO_DE_SESSOES` mais novas desta execução seguem valendo.
 */
export async function criarSessoes(cofre: Cofre, agora: () => number = Date.now): Promise<Sessoes> {
  const bilhetes = new Map<string, number>();
  const emitidas: Segredo[] = [];
  const guardada = await cofre.ler("servidor.chave_de_sessao");
  if (guardada !== null) emitidas.push(guardada);

  return {
    emitirBilhete() {
      for (const [bilhete, venceEm] of bilhetes) if (venceEm <= agora()) bilhetes.delete(bilhete);
      const bilhete = aleatorio();
      bilhetes.set(bilhete, agora() + VIDA_DO_BILHETE_MS);
      return bilhete;
    },
    async trocarBilhete(bilhete) {
      const venceEm = bilhetes.get(bilhete);
      bilhetes.delete(bilhete);
      if (venceEm === undefined || venceEm <= agora()) return null;
      const valor = `${(agora() + VIDA_DA_SESSAO_MS).toString(36)}.${aleatorio()}`;
      const sessao = Segredo.de(valor);
      await cofre.gravar("servidor.chave_de_sessao", sessao);
      emitidas.push(sessao);
      emitidas.splice(0, emitidas.length - TETO_DE_SESSOES);
      return new Bun.Cookie(NOME_DO_COOKIE, valor, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        maxAge: VIDA_DA_SESSAO_MS / 1000,
      }).serialize();
    },
    valida: (cookies) => sessaoValida(cookies) !== null,
    async guardarParaORestart(cookies) {
      const sessao = sessaoValida(cookies);
      if (sessao === null) return false;
      await cofre.gravar("servidor.chave_de_sessao", sessao);
      return true;
    },
  };

  function sessaoValida(cookies: string | null): Segredo | null {
    if (cookies === null) return null;
    const valor = new Bun.CookieMap(cookies).get(NOME_DO_COOKIE);
    if (valor === null || valor === "") return null;
    const recebida = Segredo.de(valor);
    // Sem atalho no primeiro acerto: a conta de comparações não depende de qual sessão bateu.
    const iguais = emitidas.map((sessao) => sessao.igual(recebida));
    const venceEm = vencimentoDe(valor);
    if (!iguais.includes(true) || venceEm === null || agora() >= venceEm) return null;
    return emitidas[iguais.indexOf(true)] ?? null;
  }
}
