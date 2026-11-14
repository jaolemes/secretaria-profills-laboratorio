import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  escolherNoVinculo,
  textoExterno,
  vinculoDe,
  vinculoVenceu,
  type Dia,
  type Instante,
  type MarcaDeConversaIgnorada,
  type EnderecoEmail,
  type Telefone,
} from "../dominio";
import { contatoVinculo } from "./esquema";
import {
  apagarCache,
  conversasIgnoradasValendo,
  decidirVinculoDoVendedor,
  desfazerConversaIgnorada,
  desfazerDecisaoDoVendedor,
  gravarConversasLidas,
  gravarVinculoConsultado,
  ignorarConversa,
  lerConversasLidas,
  lerVinculo,
  listarVinculos,
  prepararBanco,
  type BancoAberto,
} from "./index";

const pastas: string[] = [];
const abertos: BancoAberto[] = [];

function banco(): BancoAberto {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-vinculos-"));
  pastas.push(pasta);
  const aberto = prepararBanco({
    caminho: join(pasta, "secretaria.db"),
    caminhoDoVendedor: join(pasta, "meu.db"),
    dirBackups: join(pasta, "backups"),
    pastaDoVendedor: join(pasta, "meu"),
    agora: "2026-11-13T12:00:00.000Z" as Instante,
  });
  abertos.push(aberto);
  return aberto;
}

afterEach(() => {
  for (const aberto of abertos.splice(0)) aberto.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

const AGORA = "2026-11-13T12:00:00.000Z" as Instante;
const TEL = "+5541999998888" as Telefone;
const cliente = (id: number) => ({ id, nome: textoExterno(`Cliente Canário ${id}`), cidade: textoExterno("Curitiba"), uf: textoExterno("PR") });
const auto = (id = 1, em = AGORA) => vinculoDe("whatsapp", TEL, { estado: "auto", cliente: cliente(id) }, em);
const ambiguo = () => vinculoDe("whatsapp", TEL, { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }, AGORA);

describe("motivo do vínculo no banco", () => {
  const endereco = "compras@cliente.exemplo.test" as EnderecoEmail;
  const colunaDoMotivo = (b: BancoAberto, chave: string) => b.db.select({ motivo: contatoVinculo.motivo }).from(contatoVinculo).where(eq(contatoVinculo.chave, chave)).get()?.motivo;

  test("sem_prova_do_email volta como veio e a coluna guarda sem_prova_do_telefone", () => {
    const b = banco();
    const vinculo = vinculoDe("email", endereco, { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }, AGORA);
    expect(gravarVinculoConsultado(b, vinculo)).toBe(true);
    expect(lerVinculo(b, "email", endereco)).toEqual(vinculo);
    expect(listarVinculos(b, "email").get(endereco)).toEqual(vinculo);
    expect(colunaDoMotivo(b, endereco)).toBe("sem_prova_do_telefone");
  });

  test("o vínculo de WhatsApp com sem_prova_do_telefone continua voltando igual", () => {
    const b = banco();
    const vinculo = vinculoDe("whatsapp", TEL, { estado: "ambiguo", motivo: "sem_prova_do_telefone", candidatos: [cliente(1)] }, AGORA);
    gravarVinculoConsultado(b, vinculo);
    expect(lerVinculo(b, "whatsapp", TEL)).toEqual(vinculo);
    expect(colunaDoMotivo(b, TEL)).toBe("sem_prova_do_telefone");
  });

  test("o não cliente de e-mail guarda o motivo e o desfazer o devolve", () => {
    const b = banco();
    gravarVinculoConsultado(b, vinculoDe("email", endereco, { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }, AGORA));
    const decidido = decidirVinculoDoVendedor(b, "email", endereco, (atual) => escolherNoVinculo(atual, { tipo: "nao_cliente" }, AGORA));
    expect(decidido).toMatchObject({ ok: true, dados: { vinculo: { estado: "nao_cliente", motivo: "sem_prova_do_email" } } });
    expect(lerVinculo(b, "email", endereco)).toMatchObject({ estado: "nao_cliente", motivo: "sem_prova_do_email" });
    expect(desfazerDecisaoDoVendedor(b, "email", endereco, AGORA)).toEqual({ desfeito: true, mudou: true });
    expect(lerVinculo(b, "email", endereco)).toMatchObject({ estado: "ambiguo", motivo: "sem_prova_do_email" });
  });
});

describe("contato_vinculo", () => {
  test("grava e lê cada estado do jeito que entrou", () => {
    const b = banco();
    for (const vinculo of [auto(), ambiguo(), vinculoDe("whatsapp", TEL, { estado: "sem_cliente" }, AGORA)]) {
      gravarVinculoConsultado(b, vinculo);
      expect(lerVinculo(b, "whatsapp", TEL)).toEqual(vinculo);
    }
    expect(listarVinculos(b, "whatsapp").get(TEL)?.estado).toBe("sem_cliente");
    expect(listarVinculos(b, "email").size).toBe(0);
  });

  test("a consulta troca auto, ambiguo e sem_cliente, mas nunca a decisão do vendedor", () => {
    const b = banco();
    gravarVinculoConsultado(b, ambiguo());
    expect(gravarVinculoConsultado(b, auto(7))).toBe(true);

    const confirmado = decidirVinculoDoVendedor(b, "whatsapp", TEL, (atual) => escolherNoVinculo(atual, { tipo: "cliente", clienteId: 7 }, AGORA));
    expect(confirmado.ok).toBe(true);
    expect(gravarVinculoConsultado(b, vinculoDe("whatsapp", TEL, { estado: "sem_cliente" }, AGORA))).toBe(false);
    expect(lerVinculo(b, "whatsapp", TEL)).toMatchObject({ estado: "confirmado", cliente: { id: 7 } });

    const outro = "+5511900000009" as Telefone;
    gravarVinculoConsultado(b, vinculoDe("whatsapp", outro, { estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(3)] }, AGORA));
    decidirVinculoDoVendedor(b, "whatsapp", outro, (atual) => escolherNoVinculo(atual, { tipo: "nao_cliente" }, AGORA));
    expect(gravarVinculoConsultado(b, vinculoDe("whatsapp", outro, { estado: "auto", cliente: cliente(3) }, AGORA))).toBe(false);
    expect(lerVinculo(b, "whatsapp", outro)?.estado).toBe("nao_cliente");
  });

  test("a decisão repetida não muda a linha, e a decisão que a regra recusa não grava nada", () => {
    const b = banco();
    gravarVinculoConsultado(b, ambiguo());
    const primeira = decidirVinculoDoVendedor(b, "whatsapp", TEL, (atual) => escolherNoVinculo(atual, { tipo: "cliente", clienteId: 2 }, AGORA));
    expect(primeira).toMatchObject({ ok: true, dados: { mudou: true } });
    const repetida = decidirVinculoDoVendedor(b, "whatsapp", TEL, (atual) => escolherNoVinculo(atual, { tipo: "cliente", clienteId: 2 }, "2026-12-01T00:00:00.000Z" as Instante));
    expect(repetida).toMatchObject({ ok: true, dados: { mudou: false } });
    expect(lerVinculo(b, "whatsapp", TEL)).toMatchObject({ estado: "confirmado", decididoEm: AGORA });
    const recusada = decidirVinculoDoVendedor(b, "whatsapp", TEL, (atual) => escolherNoVinculo(atual, { tipo: "nao_cliente" }, AGORA));
    expect(recusada).toMatchObject({ ok: false, erro: { codigo: "vinculo_decidido" } });
  });

  const LOGO_DEPOIS = "2026-11-13T12:05:00.000Z" as Instante;
  const decidir = (b: BancoAberto, escolha: Parameters<typeof escolherNoVinculo>[1]) => decidirVinculoDoVendedor(b, "whatsapp", TEL, (atual) => escolherNoVinculo(atual, escolha, AGORA));

  test("não é cliente guarda os candidatos e o motivo do ambíguo, e o desfazer os devolve sem o CRM", () => {
    const b = banco();
    gravarVinculoConsultado(b, vinculoDe("whatsapp", TEL, { estado: "ambiguo", motivo: "sem_prova_do_telefone", candidatos: [cliente(1)] }, AGORA));
    decidir(b, { tipo: "nao_cliente" });
    expect(lerVinculo(b, "whatsapp", TEL)).toMatchObject({ estado: "nao_cliente", motivo: "sem_prova_do_telefone", candidatos: [cliente(1)], decididoEm: AGORA });

    expect(desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS)).toEqual({ desfeito: true, mudou: true });
    expect(lerVinculo(b, "whatsapp", TEL)).toEqual({ canal: "whatsapp", chave: TEL, conferidoEm: LOGO_DEPOIS, estado: "ambiguo", motivo: "sem_prova_do_telefone", candidatos: [cliente(1)], decididoEm: null });
  });

  test("não é cliente num auto guarda o cliente como candidato, com o motivo desfeito_pelo_vendedor", () => {
    const b = banco();
    gravarVinculoConsultado(b, auto(7));
    decidir(b, { tipo: "nao_cliente" });
    expect(lerVinculo(b, "whatsapp", TEL)).toMatchObject({ estado: "nao_cliente", motivo: "desfeito_pelo_vendedor", candidatos: [{ id: 7, nome: "Cliente Canário 7", cidade: "Curitiba", uf: null }] });
    desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS);
    expect(lerVinculo(b, "whatsapp", TEL)).toMatchObject({ estado: "ambiguo", motivo: "desfeito_pelo_vendedor", candidatos: [{ id: 7, uf: null }] });
  });

  test("repetir o desfazer não apaga o ambíguo que ele devolveu", () => {
    const b = banco();
    gravarVinculoConsultado(b, ambiguo());
    decidir(b, { tipo: "nao_cliente" });
    const primeira = desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS);
    const depois = lerVinculo(b, "whatsapp", TEL);
    const segunda = desfazerDecisaoDoVendedor(b, "whatsapp", TEL, "2026-11-13T13:00:00.000Z" as Instante);
    expect(segunda).toEqual({ desfeito: true, mudou: false });
    expect(primeira.desfeito).toBe(segunda.desfeito);
    expect(lerVinculo(b, "whatsapp", TEL)).toEqual(depois);
  });

  test("trocar o cliente de um confirmado volta a perguntar, com o cliente confirmado como candidato; repetir não muda a linha", () => {
    const b = banco();
    gravarVinculoConsultado(b, ambiguo());
    decidir(b, { tipo: "cliente", clienteId: 2 });
    expect(desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS)).toEqual({ desfeito: true, mudou: true });
    const voltou = lerVinculo(b, "whatsapp", TEL);
    expect(voltou).toMatchObject({ canal: "whatsapp", chave: TEL, estado: "ambiguo", motivo: "desfeito_pelo_vendedor", candidatos: [{ ...cliente(2), uf: null }], decididoEm: null });
    expect(voltou !== null && vinculoVenceu(voltou, LOGO_DEPOIS)).toBe(true);
    expect(desfazerDecisaoDoVendedor(b, "whatsapp", TEL, "2026-11-13T13:00:00.000Z" as Instante)).toEqual({ desfeito: true, mudou: false });
    expect(lerVinculo(b, "whatsapp", TEL)).toEqual(voltou);
  });

  test("trocar o cliente de um e-mail confirmado também volta a perguntar", () => {
    const b = banco();
    const endereco = "cliente.canario@exemplo.test";
    gravarVinculoConsultado(b, vinculoDe("email", endereco, { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }, AGORA));
    decidirVinculoDoVendedor(b, "email", endereco, (atual) => escolherNoVinculo(atual, { tipo: "cliente", clienteId: 1 }, AGORA));
    expect(desfazerDecisaoDoVendedor(b, "email", endereco, LOGO_DEPOIS)).toEqual({ desfeito: true, mudou: true });
    expect(lerVinculo(b, "email", endereco)).toMatchObject({ estado: "ambiguo", motivo: "desfeito_pelo_vendedor", candidatos: [{ id: 1, uf: null }] });
  });

  test("desfazer não apaga o que não é decisão do vendedor", () => {
    const b = banco();
    gravarVinculoConsultado(b, auto());
    expect(desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS)).toEqual({ desfeito: false, mudou: false });
    expect(lerVinculo(b, "whatsapp", TEL)).toEqual(auto());
    gravarVinculoConsultado(b, vinculoDe("whatsapp", TEL, { estado: "sem_cliente" }, AGORA));
    expect(desfazerDecisaoDoVendedor(b, "whatsapp", TEL, LOGO_DEPOIS).mudou).toBe(false);
    expect(lerVinculo(b, "whatsapp", TEL)?.estado).toBe("sem_cliente");
  });

  test("o banco recusa linha que contradiz o estado", () => {
    const b = banco();
    const inserir = (colunas: string, valores: unknown[]) => () =>
      b.sqlite.query(`INSERT INTO contato_vinculo (canal, chave, estado, conferido_em, ${colunas}) VALUES ('whatsapp', ?, ?, '2026-11-13T12:00:00.000Z', ${valores.slice(2).map(() => "?").join(", ")})`).run(...(valores as never[]));
    expect(inserir("cliente_id, cliente_nome", ["+5511900000001", "auto", 1, "Cliente"])).not.toThrow();
    // auto sem cliente
    expect(inserir("decidido_em", ["+5511900000002", "auto", null])).toThrow();
    // sem_cliente com cliente
    expect(inserir("cliente_id, cliente_nome", ["+5511900000003", "sem_cliente", 1, "Cliente"])).toThrow();
    // ambiguo sem candidatos, sem motivo, com candidatos que não são lista, ou com lista vazia
    expect(inserir("motivo", ["+5511900000004", "ambiguo", "varios_clientes"])).toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000005", "ambiguo", "varios_clientes", "[]"])).toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000006", "ambiguo", "varios_clientes", "{}"])).toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000007", "ambiguo", "varios_clientes", "não é json"])).toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000008", "ambiguo", "outro", '[{"id":1}]'])).toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000009", "ambiguo", "variante_do_9", '[{"id":1,"nome":"x","cidade":null,"uf":null}]'])).not.toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000018", "ambiguo", "sem_prova_do_telefone", '[{"id":1,"nome":"x","cidade":null,"uf":null}]'])).not.toThrow();
    // motivo e candidatos vão juntos no ambiguo e no nao_cliente, e em nenhum outro estado
    expect(inserir("decidido_em", ["+5511900000010", "nao_cliente", AGORA])).toThrow();
    expect(inserir("motivo, decidido_em", ["+5511900000019", "nao_cliente", "varios_clientes", AGORA])).toThrow();
    expect(inserir("motivo, candidatos, decidido_em", ["+5511900000020", "nao_cliente", "outro", '[{"id":1}]', AGORA])).toThrow();
    expect(inserir("motivo, candidatos, decidido_em", ["+5511900000021", "nao_cliente", "desfeito_pelo_vendedor", "[]", AGORA])).toThrow();
    expect(inserir("motivo, candidatos, decidido_em", ["+5511900000022", "nao_cliente", "desfeito_pelo_vendedor", '[{"id":1,"nome":"x","cidade":null,"uf":null}]', AGORA])).not.toThrow();
    expect(inserir("motivo, candidatos", ["+5511900000023", "sem_cliente", "varios_clientes", '[{"id":1,"nome":"x","cidade":null,"uf":null}]'])).toThrow();
    // decisão do vendedor sem instante, e instante fora dela
    expect(inserir("cliente_id, cliente_nome", ["+5511900000011", "confirmado", 1, "Cliente"])).toThrow();
    expect(inserir("decidido_em", ["+5511900000012", "nao_cliente", null])).toThrow();
    expect(inserir("cliente_id, cliente_nome, decidido_em", ["+5511900000013", "auto", 1, "Cliente", AGORA])).toThrow();
    // estado, chave e id fora da forma
    expect(inserir("decidido_em", ["+5511900000014", "talvez", null])).toThrow();
    expect(inserir("cliente_id, cliente_nome", ["5511900000015", "auto", 1, "Cliente"])).toThrow();
    expect(inserir("cliente_id, cliente_nome", ["+5511900000016", "auto", 0, "Cliente"])).toThrow();
    expect(() => b.sqlite.query("INSERT INTO contato_vinculo (canal, chave, estado, conferido_em) VALUES ('sms', '+5511900000017', 'sem_cliente', 'x')").run()).toThrow();
  });
});

describe("conversa_ignorada", () => {
  const marca = (extra: Partial<MarcaDeConversaIgnorada> = {}): MarcaDeConversaIgnorada => ({
    tipo: "conversa",
    id: TEL,
    nome: textoExterno("Cliente Canário"),
    quem: "vendedor",
    motivo: null,
    ate: "2026-11-20" as Dia,
    ...extra,
  });

  test("vale até o dia `ate`: nesse dia a marca sai do banco", () => {
    const b = banco();
    ignorarConversa(b, "whatsapp", marca(), AGORA);
    expect(conversasIgnoradasValendo(b, "whatsapp", "2026-11-19" as Dia)).toEqual([marca()]);
    expect(conversasIgnoradasValendo(b, "whatsapp", "2026-11-20" as Dia)).toEqual([]);
    expect(b.sqlite.query("SELECT count(*) AS n FROM conversa_ignorada").get()).toEqual({ n: 0 });
  });

  test("ignorar de novo empurra a data e troca quem e o motivo; desfazer tira", () => {
    const b = banco();
    ignorarConversa(b, "whatsapp", marca(), AGORA);
    ignorarConversa(b, "whatsapp", marca({ quem: "agente", motivo: "o vendedor pediu", ate: "2026-11-25" as Dia }), AGORA);
    expect(conversasIgnoradasValendo(b, "whatsapp", "2026-11-14" as Dia)).toEqual([marca({ quem: "agente", motivo: "o vendedor pediu", ate: "2026-11-25" as Dia })]);
    expect(desfazerConversaIgnorada(b, "whatsapp", TEL)).toBe(true);
    expect(desfazerConversaIgnorada(b, "whatsapp", TEL)).toBe(false);
  });

  test("o banco recusa marca do agente sem motivo e motivo fora de 5 a 300 caracteres", () => {
    const b = banco();
    expect(() => ignorarConversa(b, "whatsapp", marca({ quem: "agente" }), AGORA)).toThrow();
    expect(() => ignorarConversa(b, "whatsapp", marca({ motivo: "cinco" }), AGORA)).not.toThrow();
    expect(() => ignorarConversa(b, "whatsapp", marca({ motivo: "x".repeat(4) }), AGORA)).toThrow();
    expect(() => ignorarConversa(b, "whatsapp", marca({ motivo: "x".repeat(301) }), AGORA)).toThrow();
    expect(() => ignorarConversa(b, "whatsapp", marca({ ate: "2026-02-30" as Dia }), AGORA)).toThrow();
  });
});

describe("cache das conversas", () => {
  test("uma linha `atual`, trocada inteira, e apagar o cache apaga também esta", () => {
    const b = banco();
    expect(lerConversasLidas(b)).toBeNull();
    gravarConversasLidas(b, { itens: [1] }, AGORA);
    gravarConversasLidas(b, { itens: [2] }, "2026-11-14T12:00:00.000Z" as Instante);
    expect(lerConversasLidas(b)).toEqual({ json: { itens: [2] }, lidoEm: "2026-11-14T12:00:00.000Z" as Instante });
    apagarCache(b);
    expect(lerConversasLidas(b)).toBeNull();
  });
});
