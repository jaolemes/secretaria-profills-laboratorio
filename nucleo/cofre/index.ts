import { cofreEmArquivo } from "./arquivo";
import { CofreIndisponivel, type BackendDoCofre, type Cofre } from "./contrato";
import { cofreDoSistema, sondarCofreDoSistema } from "./sistema";

export { Segredo, mesmoTexto } from "./segredo";
export {
  CHAVES_DO_COFRE,
  CofreIndisponivel,
  chaveDaSenhaDoEmail,
  ehChaveDoCofre,
  type BackendDoCofre,
  type ChaveDaSenhaDoEmail,
  type ChaveDoCofre,
  type Cofre,
} from "./contrato";
export { sondarCofreDoSistema } from "./sistema";

/**
 * O chaveiro do sistema pode ficar esperando um desbloqueio que ninguém vai dar (sessão sem tela,
 * diálogo de permissão). Depois deste tempo a chamada vira `CofreIndisponivel`.
 */
export const PRAZO_DO_COFRE_MS = 15_000;

const VENCEU = Symbol("venceu");

function noPrazo<T>(tarefa: Promise<T>, prazoMs: number): Promise<T | typeof VENCEU> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof VENCEU>((resolver) => {
    temporizador = setTimeout(() => resolver(VENCEU), prazoMs);
  });
  return Promise.race([tarefa, limite]).finally(() => clearTimeout(temporizador));
}

/**
 * O backend é escolhido uma vez, pelo instalador, e gravado em `instalacao.cofre_backend`.
 * O servidor nunca troca de backend sozinho: trocar esconderia os segredos gravados no outro.
 * Sonda que não responde no prazo conta como chaveiro ausente.
 */
export async function escolherBackend(
  sondar: () => Promise<boolean> = sondarCofreDoSistema,
  prazoMs: number = PRAZO_DO_COFRE_MS,
): Promise<BackendDoCofre> {
  return (await noPrazo(sondar(), prazoMs)) === true ? "sistema" : "arquivo";
}

export function abrirCofre(opcoes: { backend: BackendDoCofre; idInstalacao: string; dirDados: string }): Cofre {
  return opcoes.backend === "sistema" ? cofreDoSistema(opcoes.idInstalacao) : cofreEmArquivo(opcoes.dirDados);
}

/** O mesmo cofre, em que toda chamada termina no prazo: com o valor ou com `CofreIndisponivel`. */
export function comPrazo(cofre: Cofre, prazoMs: number = PRAZO_DO_COFRE_MS): Cofre {
  async function chamar<T>(tarefa: () => Promise<T>): Promise<T> {
    let resultado: T | typeof VENCEU;
    try {
      resultado = await noPrazo(tarefa(), prazoMs);
    } catch {
      throw new CofreIndisponivel("erro");
    }
    if (resultado === VENCEU) throw new CofreIndisponivel("prazo");
    return resultado;
  }
  return {
    backend: cofre.backend,
    ler: (chave) => chamar(() => cofre.ler(chave)),
    gravar: (chave, valor) => chamar(() => cofre.gravar(chave, valor)),
    apagar: (chave) => chamar(() => cofre.apagar(chave)),
  };
}
