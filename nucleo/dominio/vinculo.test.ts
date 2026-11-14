import { describe, expect, test } from "bun:test";
import {
  CANDIDATOS_NO_MAXIMO,
  decidirVinculo,
  desfazerNoVinculo,
  escolherNoVinculo,
  textoExterno,
  varianteDoNove,
  vinculoConsultado,
  vinculoDe,
  vinculoVenceu,
  type CandidatoDeVinculo,
  type ClienteDaBusca,
  type Instante,
  type EnderecoEmail,
  type Telefone,
  type VinculoDeContato,
} from "./index";

const cliente = (id: number, nome = `Cliente Canário ${id}`): CandidatoDeVinculo => ({ id, nome: textoExterno(nome), cidade: textoExterno("Curitiba"), uf: textoExterno("PR") });
/** O cliente como a busca devolve, com um contato por telefone. */
const buscado = (id: number, ...telefones: (string | null)[]): ClienteDaBusca => ({ ...cliente(id), contatos: telefones.map((telefone) => ({ telefone, email: null })) });
const com9 = "+5541999998888" as Telefone;
const sem9 = "+554199998888" as Telefone;
const fixo = "+554133334444" as Telefone;
const deFora = "+14155550123" as Telefone;
const AGORA = "2026-11-13T12:00:00.000Z" as Instante;

describe("variante do 9", () => {
  test("celular do Brasil com e sem o nono dígito, nos dois sentidos", () => {
    expect(varianteDoNove(com9)).toBe(sem9);
    expect(varianteDoNove(sem9)).toBe(com9);
  });

  test("fixo e número de fora não têm variante", () => {
    expect(varianteDoNove(fixo)).toBeNull();
    expect(varianteDoNove(deFora)).toBeNull();
    expect(varianteDoNove("+55419555555" as Telefone)).toBeNull();
  });
});

describe("decidirVinculo", () => {
  const prova = "+5541999998888";
  test.each([
    ["um cliente com o telefone de um contato igual", com9, [buscado(1, prova)], [], { estado: "auto", cliente: cliente(1) }],
    ["o mesmo cliente listado duas vezes conta uma, com os contatos das duas", com9, [buscado(1, "4133334444"), buscado(1, prova)], [], { estado: "auto", cliente: cliente(1) }],
    ["um cliente pelo exato ignora a variante", com9, [buscado(1, prova)], [buscado(2, prova)], { estado: "auto", cliente: cliente(1) }],
    ["dois clientes pelo exato", com9, [buscado(1, prova), buscado(2, prova)], [], { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }],
    ["dois pelo exato, e a variante não entra", com9, [buscado(1), buscado(2)], [buscado(3)], { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }],
    ["só a variante, com um cliente", com9, [], [buscado(3)], { estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(3)] }],
    ["só a variante, com dois clientes", sem9, [], [buscado(3), buscado(4)], { estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(3), cliente(4)] }],
    ["nenhum nas duas", com9, [], [], { estado: "sem_cliente" }],
    ["fixo não tem variante: resposta da variante não vale", fixo, [], [buscado(3)], { estado: "sem_cliente" }],
    ["número de fora sem cliente", deFora, [], [], { estado: "sem_cliente" }],
  ] as const)("%s", (_nome, telefone, exata, variante, esperado) => {
    expect(decidirVinculo({ canal: "whatsapp", telefone }, exata, variante)).toEqual(esperado);
  });

  test.each([
    ["com máscara e 55", "+55 (41) 99999-8888"],
    ["com máscara, sem 55", "(41) 99999-8888"],
    ["só dígitos, sem 55", "41999998888"],
    ["só dígitos, com 55", "5541999998888"],
  ])("telefone do contato %s prova o vínculo", (_nome, guardado) => {
    expect(decidirVinculo({ canal: "whatsapp", telefone: com9 }, [buscado(1, null, guardado)], [])).toEqual({ estado: "auto", cliente: cliente(1) });
  });

  test("número de fora prova só com os mesmos dígitos", () => {
    expect(decidirVinculo({ canal: "whatsapp", telefone: deFora }, [buscado(1, "+1 (415) 555-0123")], [])).toEqual({ estado: "auto", cliente: cliente(1) });
    expect(decidirVinculo({ canal: "whatsapp", telefone: deFora }, [buscado(1, "4155550123")], [])).toMatchObject({ estado: "ambiguo", motivo: "sem_prova_do_telefone" });
  });

  test("um cliente cujo contato tem o número só pela variante do 9 fica para o vendedor, com variante_do_9", () => {
    expect(decidirVinculo({ canal: "whatsapp", telefone: com9 }, [buscado(1, "(41) 9999-8888")], [])).toEqual({ estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(1)] });
  });

  test.each([
    ["casou por CNPJ com os mesmos dígitos, contato com outro telefone", [buscado(1, "41 3333-4444")]],
    ["contato sem telefone", [buscado(1, null)]],
    ["resposta sem contatos", [buscado(1)]],
    ["contato com só um pedaço do número", [buscado(1, "99998888")]],
  ] as const)("um cliente sem telefone que prove fica para o vendedor: %s", (_nome, exata) => {
    expect(decidirVinculo({ canal: "whatsapp", telefone: com9 }, exata, [])).toEqual({ estado: "ambiguo", motivo: "sem_prova_do_telefone", candidatos: [cliente(1)] });
  });

  test("o telefone dos contatos não sai na decisão", () => {
    const decisoes = [decidirVinculo({ canal: "whatsapp", telefone: com9 }, [buscado(1, prova)], []), decidirVinculo({ canal: "whatsapp", telefone: com9 }, [buscado(1, "4133334444")], []), decidirVinculo({ canal: "whatsapp", telefone: com9 }, [buscado(1), buscado(2, prova)], [])];
    expect(JSON.stringify(decisoes)).not.toContain("8888");
    expect(JSON.stringify(decisoes)).not.toContain("contatos");
  });

  test("guarda no máximo 10 candidatos", () => {
    const muitos = Array.from({ length: 25 }, (_, i) => buscado(i + 1));
    const decisao = decidirVinculo({ canal: "whatsapp", telefone: com9 }, muitos, []);
    expect(decisao.estado === "ambiguo" && decisao.candidatos.length).toBe(CANDIDATOS_NO_MAXIMO);
  });
});

describe("decidirVinculo no canal e-mail", () => {
  const endereco = "compras@cliente.exemplo.test" as EnderecoEmail;
  const prova = { canal: "email", endereco } as const;
  /** O cliente como a busca devolve, com um contato por e-mail. */
  const comEmails = (id: number, ...emails: (string | null)[]): ClienteDaBusca => ({ ...cliente(id), contatos: emails.map((email) => ({ telefone: null, email })) });

  test.each([
    ["um cliente e o e-mail de um contato igual: auto", [comEmails(1, "outro@cliente.exemplo.test", endereco)], { estado: "auto", cliente: cliente(1) }],
    ["um cliente sem contato com o endereço: sem_prova_do_email", [comEmails(1, "outro@cliente.exemplo.test")], { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }],
    ["um cliente que o CRM mandou sem contatos: sem_prova_do_email", [comEmails(1)], { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }],
    ["contato sem e-mail: sem_prova_do_email", [comEmails(1, null)], { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }],
    ["mais de um cliente: varios_clientes, mesmo com prova", [comEmails(1, endereco), comEmails(2)], { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }],
    ["nenhum: sem_cliente", [], { estado: "sem_cliente" }],
    ["o mesmo cliente listado duas vezes conta uma, com os contatos das duas", [comEmails(1, "a@cliente.exemplo.test"), comEmails(1, endereco)], { estado: "auto", cliente: cliente(1) }],
  ] as const)("%s", (_nome, busca, esperado) => {
    expect(decidirVinculo(prova, busca)).toEqual(esperado);
  });

  test.each([
    ["maiúscula", "Compras@Cliente.EXEMPLO.test"],
    ["espaço em volta", "  compras@cliente.exemplo.test "],
  ])("e-mail do contato com %s prova o vínculo", (_nome, guardado) => {
    expect(decidirVinculo(prova, [comEmails(1, guardado)])).toEqual({ estado: "auto", cliente: cliente(1) });
  });

  test("a busca da variante não entra: sem cliente pelo endereço, nada de variante_do_9", () => {
    expect(decidirVinculo(prova, [], [comEmails(3, endereco)])).toEqual({ estado: "sem_cliente" });
    expect(decidirVinculo(prova, [comEmails(1)], [comEmails(3)])).toEqual({ estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] });
  });

  test("o e-mail dos contatos não sai na decisão", () => {
    expect(JSON.stringify(decidirVinculo(prova, [comEmails(1, endereco)]))).not.toContain("exemplo.test");
  });

  test("vinculoDe leva o endereço em minúsculas como chave e recusa o que não é endereço", () => {
    const vinculo = vinculoDe("email", "Compras@Cliente.Exemplo.test", { estado: "sem_cliente" }, AGORA);
    expect(vinculo).toMatchObject({ canal: "email", chave: endereco, estado: "sem_cliente" });
    expect(() => vinculoDe("email", "+5541999998888", { estado: "sem_cliente" }, AGORA)).toThrow();
  });

  test("as validades são as mesmas: sem_cliente 7 dias, auto e ambiguo 30, decisão do vendedor nunca", () => {
    const de = (decisao: Parameters<typeof vinculoDe>[2]) => vinculoDe("email", endereco, decisao, AGORA);
    const apos = (dias: number) => new Date(Date.parse(AGORA) + dias * 86_400_000).toISOString() as Instante;
    expect(vinculoVenceu(de({ estado: "sem_cliente" }), apos(7))).toBe(true);
    expect(vinculoVenceu(de({ estado: "sem_cliente" }), apos(6))).toBe(false);
    expect(vinculoVenceu(de({ estado: "auto", cliente: cliente(1) }), apos(29))).toBe(false);
    expect(vinculoVenceu(de({ estado: "auto", cliente: cliente(1) }), apos(30))).toBe(true);
    const confirmado = escolherNoVinculo(de({ estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }), { tipo: "cliente", clienteId: 1 }, AGORA);
    if (!confirmado.ok) throw new Error("a escolha devia valer");
    expect(vinculoVenceu(confirmado.dados, apos(3650))).toBe(false);
  });

  test("as escolhas do vendedor valem para o e-mail: escolher, não é cliente e desfazer", () => {
    const ambiguo = vinculoDe("email", endereco, { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [cliente(1)] }, AGORA);
    const confirmado = escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 1 }, AGORA);
    expect(confirmado).toMatchObject({ ok: true, dados: { canal: "email", chave: endereco, estado: "confirmado" } });
    expect(escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 9 }, AGORA)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
    const auto = vinculoDe("email", endereco, { estado: "auto", cliente: cliente(1) }, AGORA);
    const nao = escolherNoVinculo(auto, { tipo: "nao_cliente" }, AGORA);
    expect(nao).toMatchObject({ ok: true, dados: { estado: "nao_cliente", motivo: "desfeito_pelo_vendedor" } });
    if (!nao.ok) throw new Error("devia valer");
    expect(desfazerNoVinculo(nao.dados, AGORA)).toMatchObject({ acao: "voltar_a_perguntar", vinculo: { canal: "email", chave: endereco, estado: "ambiguo", motivo: "desfeito_pelo_vendedor" } });
    expect(escolherNoVinculo(nao.dados, { tipo: "cliente", clienteId: 1 }, AGORA)).toMatchObject({ ok: false, erro: { codigo: "vinculo_decidido", mensagem: expect.not.stringContaining("número") } });
  });
});

describe("validade do vínculo", () => {
  const de = (estado: "auto" | "ambiguo" | "sem_cliente", conferidoEm: string): VinculoDeContato =>
    vinculoDe("whatsapp", com9, estado === "auto" ? { estado, cliente: cliente(1) } : estado === "ambiguo" ? { estado, motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] } : { estado }, conferidoEm as Instante);
  const depois = (dias: number, base = AGORA) => new Date(Date.parse(base) + dias * 86_400_000 + 1).toISOString() as Instante;

  test("sem_cliente vale 7 dias", () => {
    const vinculo = de("sem_cliente", AGORA);
    expect(vinculoVenceu(vinculo, depois(6))).toBe(false);
    expect(vinculoVenceu(vinculo, new Date(Date.parse(AGORA) + 7 * 86_400_000).toISOString() as Instante)).toBe(true);
  });

  test("auto e ambiguo valem 30 dias", () => {
    for (const estado of ["auto", "ambiguo"] as const) {
      expect(vinculoVenceu(de(estado, AGORA), depois(29))).toBe(false);
      expect(vinculoVenceu(de(estado, AGORA), depois(30))).toBe(true);
    }
  });

  test("a decisão do vendedor nunca vence", () => {
    const confirmado = escolherNoVinculo(de("ambiguo", AGORA), { tipo: "cliente", clienteId: 2 }, AGORA);
    const naoCliente = escolherNoVinculo(de("ambiguo", AGORA), { tipo: "nao_cliente" }, AGORA);
    if (!confirmado.ok || !naoCliente.ok) throw new Error("a escolha devia valer");
    expect(vinculoVenceu(confirmado.dados, depois(3650))).toBe(false);
    expect(vinculoVenceu(naoCliente.dados, depois(3650))).toBe(false);
  });
});

describe("escolha do vendedor", () => {
  const ambiguo = vinculoDe("whatsapp", com9, { estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(1), cliente(2)] }, AGORA);
  const depois = "2026-11-14T12:00:00.000Z" as Instante;

  test("um candidato vira confirmado, com o instante da decisão", () => {
    const escolha = escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 2 }, depois);
    expect(escolha).toEqual({ ok: true, dados: { canal: "whatsapp", chave: com9, conferidoEm: AGORA, estado: "confirmado", cliente: { id: 2, nome: cliente(2).nome, cidade: cliente(2).cidade }, decididoEm: depois } });
  });

  test("não é cliente vira nao_cliente", () => {
    expect(escolherNoVinculo(ambiguo, { tipo: "nao_cliente" }, depois)).toMatchObject({ ok: true, dados: { estado: "nao_cliente", decididoEm: depois } });
  });

  test("cliente fora dos candidatos é nao_encontrado", () => {
    expect(escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 99 }, depois)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
  });

  test("repetir a mesma decisão devolve o mesmo vínculo, sem mudar o instante", () => {
    const primeira = escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 2 }, depois);
    if (!primeira.ok) throw new Error("a escolha devia valer");
    expect(escolherNoVinculo(primeira.dados, { tipo: "cliente", clienteId: 2 }, "2026-11-20T12:00:00.000Z" as Instante)).toEqual(primeira);
    const nao = escolherNoVinculo(ambiguo, { tipo: "nao_cliente" }, depois);
    if (!nao.ok) throw new Error("a escolha devia valer");
    expect(escolherNoVinculo(nao.dados, { tipo: "nao_cliente" }, "2026-11-20T12:00:00.000Z" as Instante)).toEqual(nao);
  });

  test("decisão diferente da já tomada pede desfazer antes", () => {
    const primeira = escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 2 }, depois);
    if (!primeira.ok) throw new Error("a escolha devia valer");
    expect(escolherNoVinculo(primeira.dados, { tipo: "cliente", clienteId: 1 }, depois)).toMatchObject({ ok: false, erro: { codigo: "vinculo_decidido" } });
    expect(escolherNoVinculo(primeira.dados, { tipo: "nao_cliente" }, depois)).toMatchObject({ ok: false, erro: { codigo: "vinculo_decidido" } });
  });

  test("número sem vínculo ou sem cliente não tem o que escolher", () => {
    expect(escolherNoVinculo(null, { tipo: "nao_cliente" }, depois)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
    expect(escolherNoVinculo(vinculoDe("whatsapp", com9, { estado: "sem_cliente" }, AGORA), { tipo: "nao_cliente" }, depois)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
  });

  test("um vínculo auto aceita confirmar o mesmo cliente ou dizer que não é cliente", () => {
    const auto = vinculoDe("whatsapp", com9, { estado: "auto", cliente: cliente(1) }, AGORA);
    expect(escolherNoVinculo(auto, { tipo: "cliente", clienteId: 1 }, depois)).toMatchObject({ ok: true, dados: { estado: "confirmado" } });
    expect(escolherNoVinculo(auto, { tipo: "cliente", clienteId: 2 }, depois)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
    expect(escolherNoVinculo(auto, { tipo: "nao_cliente" }, depois)).toMatchObject({ ok: true, dados: { estado: "nao_cliente" } });
  });
});

describe("desfazer a decisão do vendedor", () => {
  const ambiguo = vinculoDe("whatsapp", com9, { estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(1), cliente(2)] }, AGORA);
  const auto = vinculoDe("whatsapp", com9, { estado: "auto", cliente: cliente(1) }, AGORA);
  const marcado = "2026-11-14T12:00:00.000Z" as Instante;
  const depois = "2026-12-20T12:00:00.000Z" as Instante;
  const naoCliente = (origem: VinculoDeContato) => {
    const decisao = escolherNoVinculo(origem, { tipo: "nao_cliente" }, marcado);
    if (!decisao.ok) throw new Error("a escolha devia valer");
    return decisao.dados;
  };

  test("não é cliente guarda os candidatos e o motivo do ambíguo", () => {
    expect(naoCliente(ambiguo)).toEqual({ canal: "whatsapp", chave: com9, conferidoEm: AGORA, estado: "nao_cliente", decididoEm: marcado, motivo: "variante_do_9", candidatos: [cliente(1), cliente(2)] });
  });

  test("não é cliente num auto guarda o cliente como candidato e o motivo desfeito_pelo_vendedor", () => {
    expect(naoCliente(auto)).toMatchObject({ motivo: "desfeito_pelo_vendedor", candidatos: [{ id: 1, nome: cliente(1).nome, cidade: cliente(1).cidade, uf: null }] });
  });

  test("nao_cliente volta a ambiguo com o que guardou, valendo 30 dias a partir do desfazer", () => {
    const desfeito = desfazerNoVinculo(naoCliente(ambiguo), depois);
    expect(desfeito).toEqual({ acao: "voltar_a_perguntar", vinculo: { canal: "whatsapp", chave: com9, conferidoEm: depois, estado: "ambiguo", motivo: "variante_do_9", candidatos: [cliente(1), cliente(2)], decididoEm: null } });
    if (desfeito.acao !== "voltar_a_perguntar") throw new Error("era para voltar");
    expect(vinculoVenceu(desfeito.vinculo, depois)).toBe(false);
    // O que nao_cliente nasceu de um auto antigo não volta já vencido: o CRM o devolveria como auto.
    expect(vinculoVenceu(naoCliente(auto), "2027-06-01T00:00:00.000Z" as Instante)).toBe(false);
    expect(desfazerNoVinculo(naoCliente(auto), depois)).toMatchObject({ acao: "voltar_a_perguntar", vinculo: { estado: "ambiguo", motivo: "desfeito_pelo_vendedor" } });
  });

  test("confirmado volta a ambiguo com o cliente confirmado como candidato e o motivo desfeito_pelo_vendedor, já vencido para a próxima sincronização trazer os outros candidatos", () => {
    const confirmado = escolherNoVinculo(ambiguo, { tipo: "cliente", clienteId: 2 }, marcado);
    if (!confirmado.ok) throw new Error("a escolha devia valer");
    const desfeito = desfazerNoVinculo(confirmado.dados, depois);
    expect(desfeito).toMatchObject({
      acao: "voltar_a_perguntar",
      vinculo: { canal: "whatsapp", chave: com9, estado: "ambiguo", motivo: "desfeito_pelo_vendedor", candidatos: [{ ...cliente(2), uf: null }], decididoEm: null },
    });
    if (desfeito.acao !== "voltar_a_perguntar") throw new Error("era para voltar");
    expect(vinculoVenceu(desfeito.vinculo, depois)).toBe(true);
  });

  test("a consulta ao CRM não devolve como auto o contato que o vendedor desfez: fica ambíguo, com o cliente da consulta de candidato", () => {
    const desfeito = desfazerNoVinculo(naoCliente(auto), depois);
    if (desfeito.acao !== "voltar_a_perguntar") throw new Error("era para voltar");
    const consultado = vinculoDe("whatsapp", com9, { estado: "auto", cliente: cliente(1) }, depois);
    expect(vinculoConsultado(desfeito.vinculo, consultado)).toEqual({
      canal: "whatsapp",
      chave: com9,
      conferidoEm: depois,
      estado: "ambiguo",
      motivo: "desfeito_pelo_vendedor",
      candidatos: [{ id: 1, nome: cliente(1).nome, cidade: cliente(1).cidade, uf: null }],
      decididoEm: null,
    });
    const doisClientes = vinculoDe("whatsapp", com9, { estado: "ambiguo", motivo: "varios_clientes", candidatos: [cliente(1), cliente(2)] }, depois);
    expect(vinculoConsultado(desfeito.vinculo, doisClientes)).toEqual(doisClientes);
    for (const atual of [ambiguo, auto, undefined]) expect(vinculoConsultado(atual, consultado)).toEqual(consultado);
  });

  test("o resto, e o que não existe, fica como está", () => {
    for (const vinculo of [ambiguo, auto, vinculoDe("whatsapp", com9, { estado: "sem_cliente" }, AGORA), null]) expect(desfazerNoVinculo(vinculo, depois)).toEqual({ acao: "manter" });
  });
});
