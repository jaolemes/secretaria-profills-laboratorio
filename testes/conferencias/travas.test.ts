import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REGRAS_DAS_TRAVAS, conferirTravas } from "../../nucleo/escritas";

const REPO = join(import.meta.dir, "..", "..");
const settings = JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8")) as { permissions: { deny: string[]; ask: string[] } };

describe("travas do agente no .claude/settings.json", () => {
  // Regra com o nome errado não protege e não avisa: este teste é o aviso.
  test("tem todas as regras da tabela, cada uma na lista certa", () => {
    const faltando = conferirTravas(settings).filter((regra) => !regra.presente);
    expect(faltando).toEqual([]);
    expect(REGRAS_DAS_TRAVAS).toHaveLength(18);
  });

  test("as regras de wacli send continuam onde estavam, antes das do CRM", () => {
    const deny = settings.permissions.deny;
    expect(deny.slice(0, 7).every((regra) => /wacli/.test(regra) && /send/.test(regra))).toBe(true);
    expect(deny).toContain("Bash(wacli send *)");
    expect(deny.slice(7)).toEqual(REGRAS_DAS_TRAVAS.filter((regra) => regra.lista === "deny").map((regra) => regra.regra));
  });

  test("não há curinga nas regras do CRM, e nenhuma tool de leitura é travada", () => {
    const doCrm = [...settings.permissions.deny, ...settings.permissions.ask].filter((regra) => regra.startsWith("mcp__"));
    expect(doCrm).toHaveLength(18);
    expect(doCrm.filter((regra) => regra.includes("*"))).toEqual([]);
  });

  test("nenhum arquivo do Codex é versionado: a configuração dele não foi verificada", () => {
    expect(existsSync(join(REPO, ".codex"))).toBe(false);
  });
});
