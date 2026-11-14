import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROS, REGRAS_DE_SINAL, SINAIS } from "../../nucleo/dominio";

const REPO = join(import.meta.dir, "..", "..");
const ler = (caminho: string) => readFileSync(join(REPO, caminho), "utf8");

describe("a quarentena está escrita onde o agente e o revisor leem", () => {
  const secao = ler("docs/arquitetura.md").split("## Leitura do WhatsApp e quarentena")[1]?.split("\n## ")[0] ?? "";

  test("docs/arquitetura.md lista cada sinal da tabela e diz o que não é prometido", () => {
    expect(secao.length).toBeGreaterThan(500);
    for (const sinal of SINAIS) expect({ sinal, listado: secao.includes(`| \`${sinal}\` |`) }).toEqual({ sinal, listado: true });
    expect(Object.keys(REGRAS_DE_SINAL).sort()).toEqual([...SINAIS].sort());
    expect(secao).toContain("Sinal não é prova");
    expect(secao).toContain("não barra todo ataque");
    expect(secao).toContain("whatsapp_resposta_inesperada");
    expect(secao).toContain("/api/whatsapp/quarentena");
  });

  test("AGENTS.md e a skill de conectores mandam não ler a mensagem retida por outro caminho e avisar o vendedor", () => {
    const agents = ler("AGENTS.md");
    expect(agents).toContain("`quarentena`");
    expect(agents).toMatch(/Não leia o texto por outro caminho/);
    expect(agents).toMatch(/Avise o vendedor/);
    const skill = ler(".agents/skills/secretaria-conectores/SKILL.md");
    expect(skill).toContain("## Mensagem em quarentena");
    expect(skill).toContain("so_no_painel");
    expect(skill).toContain("não promete barrar todo ataque");
  });

  test("o erro de formato do wacli tem texto para o vendedor e para o agente", () => {
    expect(ERROS.whatsapp_resposta_inesperada).toMatchObject({ http: 502 });
    expect(ERROS.whatsapp_resposta_inesperada.acaoDoAgente).toContain("diagnostico");
  });
});
