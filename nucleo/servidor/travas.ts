import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVIDORES_DO_CRM_NO_AGENTE, conferirTravas, type RegraConferida } from "../escritas";

export const ARQUIVO_DAS_TRAVAS = ".claude/settings.json";

/** O que o diagnóstico mostra das travas do agente. Sem texto de fora nem dado do vendedor. */
export interface TravasNoDiagnostico {
  readonly arquivo: typeof ARQUIVO_DAS_TRAVAS;
  /** O arquivo existe e é um JSON. Sem ele, toda regra vem ausente. */
  readonly lido: boolean;
  readonly servidoresConhecidos: readonly string[];
  readonly regras: readonly RegraConferida[];
  readonly faltando: number;
  /** A configuração do Codex não foi verificada: nenhum arquivo dele é versionado. */
  readonly codex: "nao_verificado";
}

/** Lê o arquivo a cada pedido: quem o edita vê o resultado sem reiniciar o servidor. Nunca lança. */
export function lerTravas(dirRepo: string): TravasNoDiagnostico {
  let lido = false;
  let settings: unknown = null;
  try {
    settings = JSON.parse(readFileSync(join(dirRepo, ".claude", "settings.json"), "utf8"));
    lido = true;
  } catch {
    // Ausente ou ilegível: o diagnóstico mostra todas as regras como ausentes.
  }
  const regras = conferirTravas(settings);
  return {
    arquivo: ARQUIVO_DAS_TRAVAS,
    lido,
    servidoresConhecidos: SERVIDORES_DO_CRM_NO_AGENTE,
    regras,
    faltando: regras.filter((regra) => !regra.presente).length,
    codex: "nao_verificado",
  };
}
