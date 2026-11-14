import { describe, expect, test } from "bun:test";
import { ERROS, codigoDeSaida, conflito, paraOLeitor, statusHttp } from "./erros";

describe("erros do cartão da fila de aprovação", () => {
  test.each([
    ["conflito_da_escrita", "Este cartão mudou desde que você o abriu.", "Leia o cartão de novo e decida.", "O cartão atual está em `erro.atual`. Rode `bun secretaria escrita ver <id>` e avise o vendedor."],
    ["estado_da_escrita", "Esta ação não cabe no estado atual do cartão.", "Recarregue o Meu dia e veja como o cartão está.", "Rode `bun secretaria escrita ver <id>`. Aprovar, editar e descartar são do vendedor, no painel."],
    ["cliente_por_conferir", "A Secretária ainda não conferiu este cliente no CRM.", "Conecte o CRM em Conexões e aprove de novo.", "O cartão espera o CRM para conferir o cliente. Rode `bun secretaria status` e avise o vendedor para conectar o CRM no painel."],
  ] as const)("%s: 409, saída 1 e o texto de cada leitor", (codigo, mensagem, acao, acaoDoAgente) => {
    expect(ERROS[codigo] as Record<string, unknown>).toEqual({ http: 409, saida: 1, mensagem, acao, acaoDoAgente });
    const erro = { codigo, mensagem: "técnica", acao: "x" };
    expect(statusHttp(erro)).toBe(409);
    expect(codigoDeSaida(erro)).toBe(1);
    expect(paraOLeitor(erro, "vendedor")).toEqual({ codigo, mensagem, acao });
    expect(paraOLeitor(erro, "agente")).toEqual({ codigo, mensagem: "técnica", acao: acaoDoAgente });
  });

  test("o conflito da escrita leva o código dele e o cartão atual; o padrão segue sendo o da tarefa", () => {
    const atual = { id: "x" };
    const escrita = conflito(atual, "conflito_da_escrita");
    expect(escrita).toEqual({ ok: false, erro: { codigo: "conflito_da_escrita", mensagem: ERROS.conflito_da_escrita.mensagem, acao: ERROS.conflito_da_escrita.acao, atual } });
    expect(conflito(atual)).toMatchObject({ ok: false, erro: { codigo: "conflito_de_versao", mensagem: "A tarefa mudou desde que você a abriu." } });
    if (!escrita.ok) expect(paraOLeitor(escrita.erro, "vendedor").atual).toBe(atual);
  });
});
