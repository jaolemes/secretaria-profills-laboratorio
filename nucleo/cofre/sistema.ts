import type { ChaveDoCofre, Cofre } from "./contrato";
import { Segredo } from "./segredo";

/** Keychain no macOS, libsecret no Linux e Credential Manager no Windows, por `Bun.secrets`. */
export function cofreDoSistema(idInstalacao: string): Cofre {
  const service = `secretaria-profills:${idInstalacao}`;
  return {
    backend: "sistema",
    async ler(chave: ChaveDoCofre) {
      const valor = await Bun.secrets.get({ service, name: chave });
      return valor === null ? null : Segredo.de(valor);
    },
    async gravar(chave: ChaveDoCofre, valor: Segredo) {
      await Bun.secrets.set({ service, name: chave, value: valor.revelar() });
    },
    async apagar(chave: ChaveDoCofre) {
      await Bun.secrets.delete({ service, name: chave });
    },
  };
}

/**
 * Grava, lê e apaga uma chave de sonda. Sem secret service (Linux sem sessão gráfica),
 * `Bun.secrets.set` lança `ERR_SECRETS_PLATFORM_ERROR` e a sonda devolve `false`.
 */
export async function sondarCofreDoSistema(): Promise<boolean> {
  const alvo = { service: "secretaria-profills:sonda", name: "sonda" };
  const valor = crypto.randomUUID();
  try {
    await Bun.secrets.set({ ...alvo, value: valor });
    const lido = await Bun.secrets.get(alvo);
    await Bun.secrets.delete(alvo);
    return lido === valor;
  } catch {
    return false;
  }
}
