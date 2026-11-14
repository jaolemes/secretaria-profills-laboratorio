import { describe, expect, test } from "bun:test";
import { lerEscrita, lerPorSchema, corpoDePropor, corpoDeEditar, type ToolDeEscrita } from "./index";

const ATENDIMENTO = { cliente_id: 9201, assunto: "Ligação sobre o pedido", status: "Pendente", descricao: "Combinou retorno na sexta." };
const COMPROMISSO = { titulo: "Visita ao CANARIO Cliente", inicio: "2026-11-16 09:00", fim: "2026-11-16 10:30", descricao: "Levar a amostra.", cliente_id: 9201, tipo: "client" };
const CONTATO = { cliente_id: 9201, nome: "CANARIO Contato", telefone: "(11) 90000-0001", email: "canario@exemplo.invalid", cargo: "Compras", departamento: "Suprimentos", observacoes: "Prefere a tarde." };

function recusa(tool: ToolDeEscrita, dados: unknown): string {
  const lido = lerEscrita(tool, dados);
  if (lido.ok) throw new Error(`devia recusar: ${JSON.stringify(dados)}`);
  return lido.mensagem;
}

describe("o formato da doc do MCP passa", () => {
  test.each([
    ["registrar_atendimento", ATENDIMENTO],
    ["criar_compromisso", COMPROMISSO],
    ["criar_contato", CONTATO],
  ] as const)("%s com todos os campos", (tool, dados) => {
    const lido = lerEscrita(tool, dados);
    expect(lido.ok && lido.valor).toEqual({ tool, dados } as never);
  });

  test("só os campos obrigatórios: o opcional ausente fica fora do objeto, nunca null", () => {
    const minimo = lerEscrita("registrar_atendimento", { cliente_id: 1, assunto: "a", status: "Concluído" });
    expect(minimo).toEqual({ ok: true, valor: { tool: "registrar_atendimento", dados: { cliente_id: 1, assunto: "a", status: "Concluído" } } });
    expect(minimo.ok && Object.keys(minimo.valor.dados)).toEqual(["cliente_id", "assunto", "status"]);
    const sem = lerEscrita("criar_compromisso", { titulo: "t", inicio: "2026-11-16 09:00" });
    expect(sem.ok && "fim" in sem.valor.dados).toBe(false);
  });

  test("os quatro status e os três tipos", () => {
    for (const status of ["Em Andamento", "Concluído", "Pendente", "Cancelado"]) expect(lerEscrita("registrar_atendimento", { ...ATENDIMENTO, status }).ok).toBe(true);
    for (const tipo of ["client", "internal", "operational"]) expect(lerEscrita("criar_compromisso", { ...COMPROMISSO, tipo }).ok).toBe(true);
  });
});

describe("recusa", () => {
  test("campo desconhecido, sem o valor na mensagem", () => {
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, prioridade: "CANARIO-VALOR" })).toBe("corpo: campo desconhecido: prioridade");
    expect(recusa("criar_contato", { ...CONTATO, foto: 1 })).toContain("foto");
  });

  test("campo obrigatório ausente e valor de outro tipo", () => {
    expect(recusa("registrar_atendimento", { assunto: "a", status: "Pendente" })).toContain("cliente_id");
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, cliente_id: "9201" })).toContain("cliente_id");
    expect(recusa("registrar_atendimento", "texto")).toContain("corpo");
  });

  test.each([0, -1, 1.5, 2_147_483_648])("cliente_id %p fora de 1 a 2147483647", (id) => {
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, cliente_id: id })).toContain("cliente_id");
  });

  test("limite estourado: um caractere acima do máximo recusa e o máximo passa", () => {
    const limites: readonly (readonly [ToolDeEscrita, Record<string, unknown>, string, number])[] = [
      ["registrar_atendimento", ATENDIMENTO, "assunto", 255],
      ["registrar_atendimento", ATENDIMENTO, "descricao", 5000],
      ["criar_compromisso", COMPROMISSO, "titulo", 255],
      ["criar_contato", CONTATO, "nome", 45],
      ["criar_contato", CONTATO, "cargo", 45],
      ["criar_contato", CONTATO, "departamento", 45],
      ["criar_contato", CONTATO, "observacoes", 5000],
    ];
    for (const [tool, base, campo, maximo] of limites) {
      expect({ campo, passa: lerEscrita(tool, { ...base, [campo]: "a".repeat(maximo) }).ok }).toEqual({ campo, passa: true });
      expect(recusa(tool, { ...base, [campo]: "a".repeat(maximo + 1) })).toBe(`${campo}: passa de ${maximo} caracteres`);
    }
  });

  test("o limite conta caracteres, não unidades UTF-16", () => {
    expect(lerEscrita("criar_contato", { ...CONTATO, nome: "😀".repeat(45) }).ok).toBe(true);
    expect(recusa("criar_contato", { ...CONTATO, nome: "😀".repeat(46) })).toContain("nome");
  });

  test("status fora da lista e tipo fora da lista", () => {
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, status: "Aberto" })).toContain("status");
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, status: "pendente" })).toContain("status");
    expect(recusa("criar_compromisso", { ...COMPROMISSO, tipo: "pessoal" })).toContain("tipo");
  });

  test("inicio e fim em outro formato", () => {
    for (const formato of ["16/11/2026 09:00", "2026-11-16T09:00-03:00", "2026-11-16 09:00:00", "2026-11-16", "2026-11-16  09:00", "amanhã"]) {
      expect({ formato, mensagem: recusa("criar_compromisso", { ...COMPROMISSO, inicio: formato }).startsWith("inicio:") }).toEqual({ formato, mensagem: true });
    }
    expect(recusa("criar_compromisso", { ...COMPROMISSO, fim: "16/11/2026 10:00" })).toContain("fim:");
  });

  test("dia que não existe, hora e minuto fora da faixa", () => {
    expect(recusa("criar_compromisso", { ...COMPROMISSO, inicio: "2026-02-30 09:00", fim: undefined })).toContain("inicio");
    expect(recusa("criar_compromisso", { ...COMPROMISSO, inicio: "2027-02-29 09:00", fim: undefined })).toContain("inicio");
    expect(recusa("criar_compromisso", { ...COMPROMISSO, inicio: "2026-11-16 24:00", fim: undefined })).toContain("inicio");
    expect(recusa("criar_compromisso", { ...COMPROMISSO, inicio: "2026-11-16 09:60", fim: undefined })).toContain("inicio");
    expect(lerEscrita("criar_compromisso", { ...COMPROMISSO, inicio: "2028-02-29 00:00", fim: "2028-02-29 23:59" }).ok).toBe(true);
  });

  test("fim tem de vir depois de inicio", () => {
    expect(recusa("criar_compromisso", { ...COMPROMISSO, fim: "2026-11-16 08:59" })).toBe("fim: precisa vir depois de inicio");
    expect(recusa("criar_compromisso", { ...COMPROMISSO, fim: "2026-11-16 09:00" })).toBe("fim: precisa vir depois de inicio");
    expect(lerEscrita("criar_compromisso", { ...COMPROMISSO, fim: "2026-11-16 09:01" }).ok).toBe(true);
  });

  test("telefone com 9 dígitos recusa; 10, 11 e com 0 ou 55 na frente passam", () => {
    expect(recusa("criar_contato", { ...CONTATO, telefone: "9 0000-0001" })).toContain("telefone");
    expect(recusa("criar_contato", { ...CONTATO, telefone: "(11) 90000-00011-2" })).toContain("telefone");
    expect(recusa("criar_contato", { ...CONTATO, telefone: "sem número" })).toContain("telefone");
    for (const telefone of ["1130000001", "11900000001", "011900000001", "5511900000001", "+55 (11) 3000-0001", "55999990001"]) {
      expect({ telefone, passa: lerEscrita("criar_contato", { ...CONTATO, telefone }).ok }).toEqual({ telefone, passa: true });
    }
  });

  test("o telefone guardado é o que veio, aparado", () => {
    const lido = lerEscrita("criar_contato", { ...CONTATO, telefone: "  (11) 90000-0001 " });
    expect(lido.ok && lido.valor.tool === "criar_contato" && lido.valor.dados.telefone).toBe("(11) 90000-0001");
  });

  test("e-mail sem @, com espaço ou com caractere invisível recusa", () => {
    for (const email of ["canario", "a b@exemplo.invalid", "canario@exemplo", "a\u200B@exemplo.invalid"]) expect(recusa("criar_contato", { ...CONTATO, email })).toContain("email");
  });

  test("quebra de linha em campo de uma linha recusa", () => {
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, assunto: "linha 1\nlinha 2" })).toBe("assunto: precisa ter uma linha só");
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, assunto: "linha 1\r\nlinha 2" })).toContain("assunto");
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, assunto: "linha 1\u2028linha 2" })).toContain("assunto");
    for (const campo of ["titulo"] as const) expect(recusa("criar_compromisso", { ...COMPROMISSO, [campo]: "a\nb" })).toContain(campo);
    for (const campo of ["nome", "cargo", "departamento"] as const) expect(recusa("criar_contato", { ...CONTATO, [campo]: "a\nb" })).toContain(campo);
  });

  test("caractere de controle C0 e C1 recusa, até num campo de várias linhas", () => {
    for (const controle of ["\u0000", "\u0007", "\u001B", "\u007F", "\u0080", "\u009F", "\r"]) {
      expect({ controle, assunto: recusa("registrar_atendimento", { ...ATENDIMENTO, assunto: `a${controle}b` }).startsWith("assunto:") }).toEqual({ controle, assunto: true });
      expect({ controle, descricao: recusa("registrar_atendimento", { ...ATENDIMENTO, descricao: `a${controle}b` }).startsWith("descricao:") }).toEqual({ controle, descricao: true });
    }
  });

  test("a mensagem cita o campo e nunca o valor", () => {
    const mensagens = [
      recusa("registrar_atendimento", { ...ATENDIMENTO, assunto: "CANARIO-SEGREDO\u0007" }),
      recusa("criar_contato", { ...CONTATO, telefone: "CANARIO-SEGREDO" }),
      recusa("criar_contato", { ...CONTATO, email: "CANARIO-SEGREDO" }),
      recusa("criar_compromisso", { ...COMPROMISSO, inicio: "CANARIO-SEGREDO" }),
      recusa("registrar_atendimento", { ...ATENDIMENTO, status: "CANARIO-SEGREDO" }),
    ];
    for (const mensagem of mensagens) expect(mensagem).not.toContain("CANARIO-SEGREDO");
  });
});

describe("texto aceito", () => {
  test("aparado nas pontas e com \\r\\n como \\n", () => {
    const lido = lerEscrita("registrar_atendimento", { ...ATENDIMENTO, assunto: "  Pedido  ", descricao: "\n linha 1\r\nlinha 2\tcom tab \n" });
    expect(lido.ok && lido.valor.dados).toMatchObject({ assunto: "Pedido", descricao: "linha 1\nlinha 2\tcom tab" });
  });

  test("caractere invisível de formato passa: ele acende o sinal e o vendedor o vê marcado", () => {
    for (const invisivel of ["\u200B", "\u202E", "\u{E0041}"]) expect(lerEscrita("registrar_atendimento", { ...ATENDIMENTO, descricao: `a${invisivel}b` }).ok).toBe(true);
    expect(lerEscrita("registrar_atendimento", { ...ATENDIMENTO, assunto: "a\u200Bb" }).ok).toBe(true);
  });

  test("campo opcional vazio depois de aparado recusa na proposta", () => {
    expect(recusa("registrar_atendimento", { ...ATENDIMENTO, descricao: "  " })).toBe("descricao: não pode ficar vazio");
  });
});

describe("corpos da API", () => {
  test("propor: id uuid opcional, tool da lista, dados objeto", () => {
    expect(lerPorSchema(corpoDePropor, { tool: "criar_contato", dados: {} }).ok).toBe(true);
    expect(lerPorSchema(corpoDePropor, { id: "5f0c1c7e-7b0e-4a55-9a53-0d6f1f1f0a01", tool: "criar_contato", dados: {} }).ok).toBe(true);
    expect(lerPorSchema(corpoDePropor, { id: "nao-e-uuid", tool: "criar_contato", dados: {} }).ok).toBe(false);
    expect(lerPorSchema(corpoDePropor, { tool: "editar_contato", dados: {} }).ok).toBe(false);
    expect(lerPorSchema(corpoDePropor, { tool: "criar_contato", dados: [] }).ok).toBe(false);
    expect(lerPorSchema(corpoDePropor, { tool: "criar_contato", dados: {}, extra: 1 }).ok).toBe(false);
  });

  test("editar: hash de 64 hexadecimais, versão inteira, campos com texto", () => {
    const hash = "a".repeat(64);
    expect(lerPorSchema(corpoDeEditar, { hash, versao: 1, campos: { assunto: "x" } }).ok).toBe(true);
    expect(lerPorSchema(corpoDeEditar, { hash: "curto", versao: 1, campos: {} }).ok).toBe(false);
    expect(lerPorSchema(corpoDeEditar, { hash, versao: 0, campos: {} }).ok).toBe(false);
    expect(lerPorSchema(corpoDeEditar, { hash, versao: 1, campos: { assunto: 3 } }).ok).toBe(false);
  });
});
