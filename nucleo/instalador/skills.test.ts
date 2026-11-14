import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diferencasDoEspelho, espelharSkills } from "./skills";

const REPO = path.join(import.meta.dir, "..", "..");

function escrever(raiz: string, relativo: string, conteudo: string): void {
  mkdirSync(path.dirname(path.join(raiz, relativo)), { recursive: true });
  writeFileSync(path.join(raiz, relativo), conteudo);
}

describe("espelho das skills", () => {
  test(".claude/skills deste repo é igual ao gerado das fontes (rode bun secretaria instalar se falhar)", () => {
    expect(diferencasDoEspelho(REPO)).toEqual([]);
  });

  test("copia as da Profills e as do vendedor, e apaga a que saiu da fonte", () => {
    const raiz = mkdtempSync(path.join(tmpdir(), "secretaria-skills-"));
    escrever(raiz, ".agents/skills/secretaria-setup/SKILL.md", "setup");
    escrever(raiz, ".agents/skills/shadcn/rules/forms.md", "forms");
    escrever(raiz, "meu/skills/meu-visitas/SKILL.md", "visitas");
    escrever(raiz, ".claude/skills/velha/SKILL.md", "sobra");

    expect(diferencasDoEspelho(raiz).length).toBeGreaterThan(0);
    espelharSkills(raiz);
    expect(diferencasDoEspelho(raiz)).toEqual([]);

    expect(readFileSync(path.join(raiz, ".claude/skills/shadcn/rules/forms.md"), "utf8")).toBe("forms");
    expect(readFileSync(path.join(raiz, ".claude/skills/meu-visitas/SKILL.md"), "utf8")).toBe("visitas");
    expect(readFileSync(path.join(raiz, ".agents/skills/meu-visitas/SKILL.md"), "utf8")).toBe("visitas");
    expect(existsSync(path.join(raiz, ".claude/skills/velha"))).toBe(false);
    expect(readFileSync(path.join(raiz, ".agents/skills/secretaria-setup/SKILL.md"), "utf8")).toBe("setup");

    escrever(raiz, ".claude/skills/secretaria-setup/SKILL.md", "editada à mão");
    expect(diferencasDoEspelho(raiz)).toEqual([path.join(".claude", "skills", "secretaria-setup", "SKILL.md")]);
  });

  test("skill do vendedor sem o prefixo meu- é recusada", () => {
    const raiz = mkdtempSync(path.join(tmpdir(), "secretaria-skills-"));
    escrever(raiz, "meu/skills/visitas/SKILL.md", "visitas");
    expect(() => espelharSkills(raiz)).toThrow("meu-visitas");
  });
});
