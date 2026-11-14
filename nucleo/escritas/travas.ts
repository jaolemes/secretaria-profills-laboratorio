import { TOOLS_DE_ESCRITA } from "./tipos";

/**
 * As travas que mandam o agente pelo cartão. Tabela pura, sem I/O: é a fonte das regras do `.claude/settings.json`
 * do repo, da conferência que as cobra e do campo `travas` do diagnóstico. É guarda, não fronteira: o agente tem o
 * próprio MCP do CRM, com outro nome de servidor, no Codex ou por script.
 *
 * O nome do servidor sai do que o agente chama: conector do claude.ai com o nome `CRM Profills` (`claude_ai_CRM_Profills`,
 * conferido numa sessão do Claude Code) e plugin `crm-profills` (`plugin_<plugin>_<servidor>`, lido nos arquivos do plugin e
 * na doc de plugins do Claude Code; não conferido numa sessão com o plugin instalado).
 */
export const SERVIDORES_DO_CRM_NO_AGENTE = ["claude_ai_CRM_Profills", "plugin_crm-profills_crm-profills"] as const;

/** As seis tools que alteram e não passam pelo cartão: o agente mostra o que muda e o vendedor confirma a cada vez. */
export const TOOLS_QUE_PEDEM_CONFIRMACAO = [
  "editar_atendimento",
  "editar_compromisso",
  "editar_contato",
  "enviar_proposta",
  "excluir_atendimento",
  "excluir_compromisso",
] as const;

export type ListaDeTravas = "deny" | "ask";

export interface RegraDaTrava {
  readonly lista: ListaDeTravas;
  readonly regra: string;
}

export interface RegraConferida extends RegraDaTrava {
  readonly presente: boolean;
}

const regraDaTool = (servidor: string, tool: string): string => `mcp__${servidor}__${tool}`;

/** 6 em `deny` (as três tools da fila) e 12 em `ask` (as seis que alteram), com o nome por extenso, sem curinga. */
export const REGRAS_DAS_TRAVAS: readonly RegraDaTrava[] = [
  ...SERVIDORES_DO_CRM_NO_AGENTE.flatMap((servidor) => TOOLS_DE_ESCRITA.map((tool) => ({ lista: "deny" as const, regra: regraDaTool(servidor, tool) }))),
  ...SERVIDORES_DO_CRM_NO_AGENTE.flatMap((servidor) => TOOLS_QUE_PEDEM_CONFIRMACAO.map((tool) => ({ lista: "ask" as const, regra: regraDaTool(servidor, tool) }))),
];

function listaDe(settings: unknown, lista: ListaDeTravas): readonly unknown[] {
  if (typeof settings !== "object" || settings === null || !("permissions" in settings)) return [];
  const permissoes = settings.permissions;
  if (typeof permissoes !== "object" || permissoes === null || !(lista in permissoes)) return [];
  const itens = (permissoes as Record<string, unknown>)[lista];
  return Array.isArray(itens) ? itens : [];
}

/**
 * Cada regra esperada, com `presente`. Arquivo ausente, JSON inválido, sem `permissions` ou com lixo
 * dá todas ausentes, sem lançar. Só vale a regra escrita por extenso na lista certa.
 */
export function conferirTravas(settings: unknown): RegraConferida[] {
  const nas: { readonly [L in ListaDeTravas]: readonly unknown[] } = { deny: listaDe(settings, "deny"), ask: listaDe(settings, "ask") };
  return REGRAS_DAS_TRAVAS.map((esperada) => ({ ...esperada, presente: nas[esperada.lista].includes(esperada.regra) }));
}
