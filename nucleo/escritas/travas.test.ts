import { describe, expect, test } from "bun:test";
import { REGRAS_DAS_TRAVAS, SERVIDORES_DO_CRM_NO_AGENTE, TOOLS_DE_ESCRITA, TOOLS_QUE_PEDEM_CONFIRMACAO, conferirTravas } from "./index";

const completo = {
  permissions: {
    deny: ["Bash(wacli send *)", ...REGRAS_DAS_TRAVAS.filter((r) => r.lista === "deny").map((r) => r.regra)],
    ask: REGRAS_DAS_TRAVAS.filter((r) => r.lista === "ask").map((r) => r.regra),
  },
};

describe("a tabela das travas", () => {
  test("tem 18 regras: 6 em deny e 12 em ask, com o nome por extenso, sem curinga", () => {
    expect(REGRAS_DAS_TRAVAS).toHaveLength(18);
    expect(REGRAS_DAS_TRAVAS.filter((r) => r.lista === "deny")).toHaveLength(6);
    expect(REGRAS_DAS_TRAVAS.filter((r) => r.lista === "ask")).toHaveLength(12);
    expect(new Set(REGRAS_DAS_TRAVAS.map((r) => r.regra)).size).toBe(18);
    for (const { regra } of REGRAS_DAS_TRAVAS) {
      expect(regra).toMatch(/^mcp__[A-Za-z0-9_-]+__[a-z_]+$/);
      expect(regra).not.toContain("*");
    }
  });

  test("os dois servidores são o do conector do claude.ai e o do plugin crm-profills", () => {
    expect([...SERVIDORES_DO_CRM_NO_AGENTE]).toEqual(["claude_ai_CRM_Profills", "plugin_crm-profills_crm-profills"]);
  });

  test("deny é cada tool da fila nos dois servidores, e ask cada tool que altera", () => {
    const deny = REGRAS_DAS_TRAVAS.filter((r) => r.lista === "deny").map((r) => r.regra);
    for (const servidor of SERVIDORES_DO_CRM_NO_AGENTE) for (const tool of TOOLS_DE_ESCRITA) expect(deny).toContain(`mcp__${servidor}__${tool}`);
    expect([...TOOLS_DE_ESCRITA]).toEqual(["registrar_atendimento", "criar_compromisso", "criar_contato"]);
    expect([...TOOLS_QUE_PEDEM_CONFIRMACAO]).toEqual(["editar_atendimento", "editar_compromisso", "editar_contato", "enviar_proposta", "excluir_atendimento", "excluir_compromisso"]);
    const ask = REGRAS_DAS_TRAVAS.filter((r) => r.lista === "ask").map((r) => r.regra);
    for (const servidor of SERVIDORES_DO_CRM_NO_AGENTE) for (const tool of TOOLS_QUE_PEDEM_CONFIRMACAO) expect(ask).toContain(`mcp__${servidor}__${tool}`);
    // Nenhuma tool de leitura é travada: o agente as usa para achar o cliente.
    expect([...deny, ...ask].filter((regra) => /__(buscar_clientes|ver_cliente|minha_agenda|ver_proposta)$/.test(regra))).toEqual([]);
  });
});

describe("conferirTravas", () => {
  test("com o settings completo, as 18 estão presentes", () => {
    const conferidas = conferirTravas(completo);
    expect(conferidas).toHaveLength(18);
    expect(conferidas.every((r) => r.presente)).toBe(true);
    expect(conferidas.map(({ lista, regra }) => ({ lista, regra }))).toEqual([...REGRAS_DAS_TRAVAS]);
  });

  test("sem uma regra, só ela fica ausente", () => {
    const sem = "mcp__claude_ai_CRM_Profills__criar_contato";
    const settings = { permissions: { ...completo.permissions, deny: completo.permissions.deny.filter((r) => r !== sem) } };
    expect(conferirTravas(settings).filter((r) => !r.presente)).toEqual([{ lista: "deny", regra: sem, presente: false }]);
  });

  test("a regra na lista errada, com outro nome ou com curinga não protege", () => {
    const [primeiraDeny, , , , , , primeiraAsk] = REGRAS_DAS_TRAVAS;
    const settings = {
      permissions: {
        deny: [primeiraAsk?.regra, "mcp__claude_ai_CRM_Profills__criar_contato ", "mcp__claude_ai_CRM_Profills__criar_*", "mcp__CRM_Profills__criar_contato"],
        ask: [primeiraDeny?.regra],
      },
    };
    expect(conferirTravas(settings).filter((r) => r.presente)).toEqual([]);
  });

  test("sem permissions, vazio, nulo, lixo ou JSON de outro tipo: todas ausentes, sem lançar", () => {
    for (const lixo of [undefined, null, 42, "texto", [], {}, { permissions: null }, { permissions: "x" }, { permissions: { deny: "x", ask: { a: 1 } } }, { permissions: { deny: [1, null, {}], ask: [[]] } }]) {
      const conferidas = conferirTravas(lixo);
      expect(conferidas).toHaveLength(18);
      expect(conferidas.filter((r) => r.presente)).toEqual([]);
    }
  });
});
