import { describe, expect, test } from "bun:test";
import { pedirAcao, type Buscar } from "./api";
import type { IdContaEmail } from "../dominio";
import { lerContaNova, lerReconexao, lerTelefoneDigitado, type CamposDaConta } from "./formularios";

const ID = "00000000-0000-4000-8000-0000000000aa" as IdContaEmail;
const campos: CamposDaConta = {
  endereco: " vendedor@exemplo.com.br ",
  rotulo: " Profills ",
  servidor: "imap.kinghost.net",
  porta: "993",
  seguranca: "tls",
  janelaDias: 60,
  avancadas: false,
};

describe("formulário da conta nova", () => {
  test("Profills sem opções avançadas manda só endereço, rótulo, dias, id e senha: o servidor sai da predefinição", () => {
    expect(lerContaNova("profills", ID, campos, "s3nha") as unknown).toEqual({
      ok: true,
      corpo: { id: ID, rotulo: "Profills", provedor: "profills", endereco: "vendedor@exemplo.com.br", janelaDias: 60, senha: "s3nha" },
    });
  });

  test("com as opções avançadas abertas, o servidor digitado vai junto", () => {
    const leitura = lerContaNova("profills", ID, { ...campos, avancadas: true, servidor: "127.0.0.1", porta: "1993", seguranca: "starttls" }, "s3nha");
    expect(leitura.ok && [leitura.corpo.servidor, leitura.corpo.porta, leitura.corpo.seguranca]).toEqual(["127.0.0.1", 1993, "starttls"]);
  });

  test("Outro sempre manda o servidor, e o servidor aceita domínio, localhost e IPv4", () => {
    for (const servidor of ["imap.exemplo.com.br", "localhost", "127.0.0.1"]) {
      const leitura = lerContaNova("outro", ID, { ...campos, servidor }, "s3nha");
      expect(leitura.ok && leitura.corpo.servidor).toBe(servidor);
    }
    for (const servidor of ["imap exemplo.com", "exemplo", "imap.exemplo.c0m"]) expect(lerContaNova("outro", ID, { ...campos, servidor }, "s3nha").ok).toBe(false);
  });

  test("campos vazios dão um erro por campo", () => {
    const leitura = lerContaNova("outro", ID, { ...campos, endereco: "", rotulo: " ", servidor: "", porta: "" }, "");
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(Object.keys(leitura.erros).sort()).toEqual(["endereco", "porta", "rotulo", "senha", "servidor"]);
  });

  test("porta fora da faixa e rótulo com mais de 30 letras são recusados", () => {
    const leitura = lerContaNova("outro", ID, { ...campos, porta: "70000", rotulo: "a".repeat(31) }, "s3nha");
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(Object.keys(leitura.erros).sort()).toEqual(["porta", "rotulo"]);
  });
});

describe("conectar de novo uma conta", () => {
  test("só a senha, ou a senha com o servidor quando o vendedor abriu as opções avançadas", () => {
    expect(lerReconexao({ ...campos, avancadas: false }, "nova") as unknown).toEqual({ ok: true, corpo: { senha: "nova" } });
    expect(lerReconexao({ ...campos, avancadas: true }, "nova") as unknown).toEqual({
      ok: true,
      corpo: { senha: "nova", servidor: "imap.kinghost.net", porta: 993, seguranca: "tls" },
    });
  });

  test("sem senha não anda", () => {
    const leitura = lerReconexao({ ...campos, avancadas: false }, "");
    expect(!leitura.ok && leitura.erros.senha).toBeString();
  });
});

describe("telefone digitado", () => {
  test.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11 3456-7890", "+551134567890"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["5511987654321", "+5511987654321"],
  ])("%s vira %s", (texto, esperado) => {
    expect(lerTelefoneDigitado(texto)).toBe(esperado as never);
  });

  test.each(["", "1234", "98765-4321"])("recusa %p", (texto) => {
    expect(lerTelefoneDigitado(texto)).toBeNull();
  });
});

describe("pedido de ação", () => {
  const responder = (corpo: unknown, status = 200): Buscar => async () => new Response(JSON.stringify(corpo), { status });

  test("POST na rota da ação, com JSON só quando há corpo", async () => {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const buscar: Buscar = async (url, init) => {
      pedidos.push({ url, init });
      return new Response(JSON.stringify({ v: 1, ok: true, dados: { fase: "desconectado" } }));
    };
    expect(await pedirAcao({ id: "crm", acao: "cancelar" }, buscar)).toBeNull();
    expect(await pedirAcao({ id: "whatsapp", acao: "conectar", corpo: { meio: "qr" } }, buscar)).toBeNull();
    expect(pedidos.map((pedido) => [pedido.url, pedido.init.method, pedido.init.headers, pedido.init.body])).toEqual([
      ["/api/conectores/crm/cancelar", "POST", undefined, undefined],
      ["/api/conectores/whatsapp/conectar", "POST", { "Content-Type": "application/json" }, '{"meio":"qr"}'],
    ]);
  });

  test("devolve o erro do envelope para o cartão", async () => {
    const erro = { codigo: "email_senha_recusada", mensagem: "O servidor de e-mail recusou a senha.", acao: "Clique em Conectar." };
    expect((await pedirAcao({ id: "crm", acao: "testar" }, responder({ v: 1, ok: false, erro }, 409))) as unknown).toEqual(erro);
  });

  test("servidor fora do ar vira o erro da tabela, sem lançar", async () => {
    const erro = await pedirAcao({ id: "crm", acao: "testar" }, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(erro?.codigo).toBe("servidor_fora_do_ar");
  });

  test("resposta fora do envelope vira erro interno", async () => {
    expect((await pedirAcao({ id: "crm", acao: "testar" }, responder("oi")))?.codigo).toBe("interno");
  });
});
