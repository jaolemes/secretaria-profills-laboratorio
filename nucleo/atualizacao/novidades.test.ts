import { describe, expect, test } from "bun:test";
import { lerNovidades } from ".";

function arquivo(linhas: readonly string[], cabecalho = "versao: 0.2.0\ndata: 2026-11-20"): string {
  return `---\n${cabecalho}\n---\n${linhas.join("\n")}\n`;
}

const BOA = "O painel avisa quando tem versão nova da Secretária.";

describe("lerNovidades", () => {
  test("lê a versão, a data e as linhas", () => {
    const texto = arquivo([`- ${BOA}`, "- O Meu dia mostra os e-mails de cliente junto com as conversas."]);
    expect(lerNovidades(texto)).toEqual({
      ok: true,
      novidades: {
        versao: "0.2.0",
        data: "2026-11-20",
        linhas: [BOA, "O Meu dia mostra os e-mails de cliente junto com as conversas."],
      },
    });
  });

  test("aceita o arquivo salvo com fim de linha do Windows", () => {
    const leitura = lerNovidades(arquivo([`- ${BOA}`]).replaceAll("\n", "\r\n"));
    expect(leitura).toEqual({ ok: true, novidades: { versao: "0.2.0", data: "2026-11-20", linhas: [BOA] } });
  });

  test("aceita até 5 linhas e recusa a sexta", () => {
    const cinco = Array.from({ length: 5 }, () => `- ${BOA}`);
    expect(lerNovidades(arquivo(cinco)).ok).toBe(true);
    expect(lerNovidades(arquivo([...cinco, `- ${BOA}`])).ok).toBe(false);
  });

  test("aceita data, número e palavra com hífen na frase", () => {
    const frase = "A partir de 20/11, o e-mail lê até 1.250 mensagens por conta.";
    expect(lerNovidades(arquivo([`- ${frase}`])).ok).toBe(true);
  });

  test("aceita linha de 140 caracteres e recusa a de 141", () => {
    const frase = (tamanho: number) => `A${"a".repeat(tamanho - 2)}.`;
    expect(lerNovidades(arquivo([`- ${frase(140)}`])).ok).toBe(true);
    expect(lerNovidades(arquivo([`- ${frase(141)}`])).ok).toBe(false);
  });

  const recusados: readonly (readonly [string, string, string])[] = [
    ["sem cabeçalho", `- ${BOA}\n`, "falta o cabeçalho"],
    ["sem nenhuma linha", arquivo([]), "pelo menos 1 linha"],
    ["cabeçalho sem a data", arquivo([`- ${BOA}`], "versao: 0.2.0"), "data precisa"],
    ["campo a mais no cabeçalho", arquivo([`- ${BOA}`], "versao: 0.2.0\ndata: 2026-11-20\ncanal: teste"), "campo desconhecido canal"],
    ["versão fora do formato", arquivo([`- ${BOA}`], "versao: v0.2\ndata: 2026-11-20"), "versao precisa"],
    ["data que não existe", arquivo([`- ${BOA}`], "versao: 0.2.0\ndata: 2026-02-30"), "data precisa"],
    ["linha sem o traço", arquivo([BOA]), "precisa começar com"],
    ["linha sem ponto final", arquivo(["- O painel avisa quando tem versão nova"]), "não termina com ponto"],
    ["linha com duas frases", arquivo(["- O painel avisa. A lista ficou maior."]), "mais de uma frase"],
    ["linha que começa com minúscula", arquivo(["- o painel avisa quando tem versão nova."]), "maiúscula"],
    ["crase", arquivo(["- O comando `abrir` ficou mais rápido."]), "crase"],
    ["link", arquivo(["- Veja https://exemplo.com.br para saber mais."]), "link"],
    ["link em markdown", arquivo(["- Veja [o guia](guia) para saber mais."]), "link"],
    ["nome de arquivo", arquivo(["- O ambiente.json aceita o campo navegador."]), "nome de arquivo"],
    ["caminho de pasta", arquivo(["- A pasta nucleo/painel ganhou uma tela."]), "caminho de pasta"],
    ["comando", arquivo(["- Rode bun secretaria abrir para ver o painel."]), "tem comando"],
    ["opção de comando", arquivo(["- O relatório aceita --de e --ate."]), "opção de comando"],
    ["número de PR", arquivo(["- Corrige a lista que piscava (#12)."]), "cita PR"],
    ["PR por extenso", arquivo(["- Entrou o PR 12 com a lista nova."]), "cita PR"],
  ];

  test.each(recusados)("recusa %s", (_caso, texto, motivo) => {
    const leitura = lerNovidades(texto);
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(leitura.problemas.some((problema) => problema.includes(motivo))).toBe(true);
  });

  test("diz a linha de cada problema", () => {
    const leitura = lerNovidades(arquivo([`- ${BOA}`, "- Rode bun secretaria abrir."]));
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(leitura.problemas.some((problema) => problema.startsWith("linha 2:"))).toBe(true);
  });
});
