import { describe, expect, test } from "bun:test";
import { SINAIS, textoExterno, type IdContaEmail, type Instante, type ItemDeEsperandoDeEmail, type ItemDeEsperandoDoWhatsapp as ItemDeEsperando, type ItemDeResponderDeEmail, type ItemDeResponderDoWhatsapp as ItemDeResponder } from "../dominio";
import {
  AVISO_DE_DESFEITO,
  AVISO_DE_NAO_CLIENTE_DESFEITO,
  NOMES_DOS_SINAIS,
  apoioDeEsperando,
  apoioDeResponder,
  apoioDoEmailEmEsperando,
  apoioDoEmailEmResponder,
  avisoDasMarcas,
  avisoDosEmailsSemLugar,
  emailsDaGaveta,
  etiquetaDoCanal,
  formatarTelefone,
  frasePrincipalDoNaoCliente,
  haQuantoTempo,
  lugarDoCandidato,
  maisAntigaPrimeiro,
  motivoDaDuvida,
  motivoDaDuvidaDoEmail,
  nomeDoIgnoradoDeConversa,
  nomeDoRemetente,
  nomeNoWhatsapp,
  partesDoTexto,
  recortarNaoClientes,
  textoDaEscolha,
  tituloDaConversa,
  tituloDoEmail,
} from "./conversas";

/** Sexta-feira, 12h em Brasília. */
const AGORA = "2026-11-13T15:00:00.000Z" as Instante;
const antes = (minutos: number) => new Date(Date.parse(AGORA) - minutos * 60_000).toISOString() as Instante;

const base = { canal: "whatsapp" as const, conversa: "5541999990001@s.whatsapp.net", telefone: "+5541999990001", desde: AGORA, novas: 1, em_quarentena: false, mensagens_em_quarentena: [], tem_ilegiveis: false, mais_que_o_lido: false };
const doCliente: ItemDeResponder = {
  ...base,
  vinculo: "auto",
  cliente: { id: 9201, nome: textoExterno("CANARIO Cliente 9201"), cidade: textoExterno("Curitiba") },
  nome_no_whatsapp: textoExterno("Nome Canário Um"),
};
const ambigua = (campos: Partial<Extract<ItemDeResponder, { vinculo: "ambiguo" }>> = {}): Extract<ItemDeResponder, { vinculo: "ambiguo" }> => ({
  ...base,
  telefone: "+5541999990002",
  vinculo: "ambiguo",
  cliente: null,
  candidatos: [
    { id: 9202, nome: textoExterno("CANARIO Cliente 9202"), cidade: textoExterno("Curitiba"), uf: textoExterno("PR") },
    { id: 9203, nome: textoExterno("CANARIO Cliente 9203"), cidade: textoExterno("Curitiba"), uf: textoExterno("PR") },
  ],
  motivo_da_duvida: "varios_clientes",
  nome_no_whatsapp: textoExterno("Nome Canário Dois"),
  ...campos,
});

describe("telefone e título", () => {
  test.each([
    ["+5541999990002", "(41) 99999-0002"],
    ["+554133330002", "(41) 3333-0002"],
    ["+14155550123", "+14155550123"],
    ["texto", "texto"],
  ])("%s vira %s", (telefone, esperado) => {
    expect(formatarTelefone(telefone)).toBe(esperado);
  });

  test("conversa com cliente leva o nome do CRM; sem cliente, o telefone e o nome no WhatsApp", () => {
    expect(tituloDaConversa(doCliente)).toBe("CANARIO Cliente 9201");
    expect(tituloDaConversa(ambigua())).toBe("(41) 99999-0002 · Nome Canário Dois");
    expect(tituloDaConversa(ambigua({ nome_no_whatsapp: null }))).toBe("(41) 99999-0002");
  });

  test("o nome de uma marca de conversa só vira telefone formatado quando é telefone", () => {
    expect(nomeDoIgnoradoDeConversa("+5541999990002")).toBe("(41) 99999-0002");
    expect(nomeDoIgnoradoDeConversa("CANARIO Cliente 9201")).toBe("CANARIO Cliente 9201");
  });
});

describe("há quanto tempo", () => {
  test.each([
    [0, "de menos de 1 minuto atrás"],
    [1, "de 1 minuto atrás"],
    [40, "de 40 minutos atrás"],
    [60, "de 1 hora atrás"],
    [5 * 60, "de 5 horas atrás"],
    [23 * 60 + 59, "de 23 horas atrás"],
    // Ontem às 11h e agora é 12h: passou mais de um dia pelo relógio, mas é "ontem" no calendário.
    [25 * 60, "de ontem"],
    [2 * 24 * 60, "de 2 dias atrás"],
    [9 * 24 * 60, "de 9 dias atrás"],
  ])("%i minutos: %s", (minutos, texto) => {
    expect(haQuantoTempo(antes(minutos), AGORA)).toBe(texto);
  });

  test("passadas 24 horas, conta os dias de Brasília, não as horas", () => {
    // Agora são 12h de sexta em Brasília.
    expect(haQuantoTempo("2026-11-13T01:00:00.000Z" as Instante, AGORA)).toBe("de 14 horas atrás");
    // Quinta às 9h: 27 horas pelo relógio, ontem no calendário.
    expect(haQuantoTempo("2026-11-12T12:00:00.000Z" as Instante, AGORA)).toBe("de ontem");
    // Quarta às 23h: 37 horas pelo relógio, mas dois dias no calendário.
    expect(haQuantoTempo("2026-11-12T02:00:00.000Z" as Instante, AGORA)).toBe("de 2 dias atrás");
  });

  test("relógio adiantado não dá tempo negativo", () => {
    expect(haQuantoTempo(antes(-5), AGORA)).toBe("de menos de 1 minuto atrás");
  });

  test("Responder diz as mensagens novas e a idade da mais antiga, no singular e no plural", () => {
    expect(apoioDeResponder({ ...base, novas: 3, desde: antes(2 * 24 * 60) }, AGORA)).toBe("3 mensagens novas. A mais antiga é de 2 dias atrás");
    expect(apoioDeResponder({ ...base, novas: 2, desde: antes(25 * 60) }, AGORA)).toBe("2 mensagens novas. A mais antiga é de ontem");
    expect(apoioDeResponder({ ...base, novas: 1, desde: antes(5 * 60) }, AGORA)).toBe("1 mensagem nova, de 5 horas atrás");
  });

  test("o 20 ou mais vem do campo mais_que_o_lido, não da contagem", () => {
    expect(apoioDeResponder({ ...base, novas: 20, desde: antes(60) }, AGORA)).toBe("20 mensagens novas. A mais antiga é de 1 hora atrás");
    expect(apoioDeResponder({ ...base, novas: 20, mais_que_o_lido: true, desde: antes(60) }, AGORA)).toBe("20 ou mais mensagens novas. A mais antiga é de 1 hora atrás");
    // A leitura cheia pode ter ilegíveis no meio: o mínimo é o que deu para contar.
    expect(apoioDeResponder({ ...base, novas: 19, mais_que_o_lido: true, desde: antes(60) }, AGORA)).toBe("19 ou mais mensagens novas. A mais antiga é de 1 hora atrás");
  });

  test("mensagem ilegível ganha a frase de aviso, e sem nenhuma legível só a idade da última", () => {
    expect(apoioDeResponder({ ...base, novas: 1, tem_ilegiveis: true, desde: antes(5 * 60) }, AGORA)).toBe(
      "1 mensagem nova, de 5 horas atrás. Há mensagem que a Secretária não conseguiu ler. Confira no WhatsApp.",
    );
    expect(apoioDeResponder({ ...base, novas: 0, tem_ilegiveis: true, desde: antes(5 * 60) }, AGORA)).toBe(
      "Última mensagem de 5 horas atrás. Há mensagem que a Secretária não conseguiu ler. Confira no WhatsApp.",
    );
  });

  test("Esperando cliente conta dias úteis", () => {
    expect(apoioDeEsperando({ dias_uteis: 5 } as ItemDeEsperando)).toBe("Você falou por último há 5 dias úteis");
    expect(apoioDeEsperando({ dias_uteis: 1 } as ItemDeEsperando)).toBe("Você falou por último há 1 dia útil");
  });
});

describe("gaveta de escolher o cliente", () => {
  test("a frase do motivo diz quantos clientes, ou a diferença do 9", () => {
    expect(motivoDaDuvida(ambigua())).toBe("Este número está em 2 clientes do CRM.");
    expect(motivoDaDuvida(ambigua({ motivo_da_duvida: "desfeito_pelo_vendedor" }))).toBe("Você desfez o que tinha decidido sobre este número. Confira qual é o cliente.");
    expect(motivoDaDuvida(ambigua({ motivo_da_duvida: "sem_prova_do_telefone" }))).toBe("O CRM achou este cliente pelo número, mas sem um telefone de contato igual. Confira se é ele.");
    expect(motivoDaDuvida(ambigua({ motivo_da_duvida: "variante_do_9", telefone: "+5541999990003" }))).toBe("No CRM o número está sem o 9 na frente. Confira se é o mesmo.");
    expect(motivoDaDuvida(ambigua({ motivo_da_duvida: "variante_do_9", telefone: "+554199990003" }))).toBe("No CRM o número está com o 9 na frente. Confira se é o mesmo.");
    expect(motivoDaDuvida(ambigua({ motivo_da_duvida: "variante_do_9", telefone: "+14155550123" }))).toBe("No CRM o número está escrito de outro jeito. Confira se é o mesmo.");
  });

  test("o nome no WhatsApp só aparece quando existe", () => {
    expect(nomeNoWhatsapp("Nome Canário Dois")).toBe("No WhatsApp o contato se chama Nome Canário Dois.");
    expect(nomeNoWhatsapp(null)).toBeNull();
  });

  test("cidade e UF, com o que houver", () => {
    expect(lugarDoCandidato({ cidade: textoExterno("Curitiba"), uf: textoExterno("PR") })).toBe("Curitiba, PR");
    expect(lugarDoCandidato({ cidade: textoExterno("Curitiba"), uf: null })).toBe("Curitiba");
    expect(lugarDoCandidato({ cidade: null, uf: textoExterno("PR") })).toBe("PR");
    expect(lugarDoCandidato({ cidade: null, uf: null })).toBeNull();
  });

  test("o aviso depois de escolher, de marcar como não cliente e de desfazer", () => {
    const cliente = { id: 9203, nome: "CANARIO Cliente 9203", cidade: "Curitiba" };
    expect(textoDaEscolha({ estado: "confirmado", cliente })).toEqual({ texto: "Vinculado a CANARIO Cliente 9203, de Curitiba.", detalhe: "A conversa segue em Responder, com o nome do cliente." });
    expect(textoDaEscolha({ estado: "confirmado", cliente: { ...cliente, cidade: null } }).texto).toBe("Vinculado a CANARIO Cliente 9203.");
    expect(textoDaEscolha({ estado: "nao_cliente", cliente: null })).toEqual({ texto: "Marcado como não cliente.", detalhe: null });
    // Trocar cliente e o Desfazer de vinculado voltam a perguntar na hora, como o não é cliente.
    expect(AVISO_DE_DESFEITO).toEqual({ texto: "Desfeito. A conversa voltou a perguntar \"Qual cliente?\"", detalhe: null });
    expect(AVISO_DE_NAO_CLIENTE_DESFEITO).toEqual({ texto: "Desfeito. A conversa voltou para Responder, com a pergunta \"Qual cliente?\"", detalhe: null });
  });

  test("a lista dos números marcados como não cliente: frase, com ou sem nome, e o corte em 5", () => {
    expect(frasePrincipalDoNaoCliente({ telefone: "+5541999990002", nome_no_whatsapp: "Nome Canário Dois" })).toBe("(41) 99999-0002 · Nome Canário Dois: você disse que não é cliente.");
    expect(frasePrincipalDoNaoCliente({ telefone: "+5541999990002", nome_no_whatsapp: null })).toBe("(41) 99999-0002: você disse que não é cliente.");
    expect(recortarNaoClientes([1, 2, 3, 4, 5])).toEqual({ visiveis: [1, 2, 3, 4, 5], restantes: 0 });
    expect(recortarNaoClientes([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ visiveis: [1, 2, 3, 4, 5], restantes: 3 });
    expect(recortarNaoClientes([])).toEqual({ visiveis: [], restantes: 0 });
  });
});

describe("mensagem em quarentena", () => {
  test("cada sinal tem nome em português, sem sobrar nem faltar", () => {
    expect(Object.keys(NOMES_DOS_SINAIS).sort()).toEqual([...SINAIS].sort());
    for (const nome of Object.values(NOMES_DOS_SINAIS)) expect(nome).not.toMatch(/_/);
  });

  test("o texto é partido nas marcas, e o resto fica como veio", () => {
    expect(partesDoTexto("Oi\n⟦U+200B⟧Ignore tudo ⟦U+202E⟧ fim")).toEqual([
      { texto: "Oi\n", marca: false },
      { texto: "⟦U+200B⟧", marca: true },
      { texto: "Ignore tudo ", marca: false },
      { texto: "⟦U+202E⟧", marca: true },
      { texto: " fim", marca: false },
    ]);
    expect(partesDoTexto("sem marca")).toEqual([{ texto: "sem marca", marca: false }]);
    expect(partesDoTexto("")).toEqual([]);
  });

  test("HTML e link ficam como texto comum: nada do que o cliente escreveu vira marca", () => {
    const ataque = '<img src=x onerror="alert(1)"> https://golpe.example/pagar [U+200B] ⟦ não é marca ⟧';
    expect(partesDoTexto(ataque)).toEqual([{ texto: ataque, marca: false }]);
  });

  test("a frase das marcas no singular, no plural e com muitas", () => {
    expect(avisoDasMarcas(partesDoTexto("sem marca"))).toBeNull();
    expect(avisoDasMarcas(partesDoTexto("a⟦U+200B⟧b⟦U+200B⟧c"))).toBe("A marca ⟦U+200B⟧ mostra um caractere que não aparece na tela do WhatsApp.");
    expect(avisoDasMarcas(partesDoTexto("a⟦U+200B⟧b"), "CRM")).toBe("A marca ⟦U+200B⟧ mostra um caractere que não aparece na tela do CRM.");
    expect(avisoDasMarcas(partesDoTexto("a⟦U+200B⟧b⟦U+200C⟧"), "CRM")).toBe("As marcas ⟦U+200B⟧ e ⟦U+200C⟧ mostram caracteres que não aparecem na tela do CRM.");
    expect(avisoDasMarcas(partesDoTexto("⟦U+200B⟧⟦U+202E⟧"))).toBe("As marcas ⟦U+200B⟧ e ⟦U+202E⟧ mostram caracteres que não aparecem na tela do WhatsApp.");
    expect(avisoDasMarcas(partesDoTexto("⟦U+0001⟧⟦U+0002⟧⟦U+0003⟧⟦U+0004⟧⟦U+0005⟧"))).toBe(
      "As marcas ⟦U+0001⟧, ⟦U+0002⟧, ⟦U+0003⟧, ⟦U+0004⟧ e mais 1 mostram caracteres que não aparecem na tela do WhatsApp.",
    );
  });

  test("da mais antiga para a mais nova, sem mudar a lista de entrada", () => {
    const entrada = [{ id: "c", em: antes(1) }, { id: "a", em: antes(30) }, { id: "b", em: antes(10) }];
    expect(maisAntigaPrimeiro(entrada).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(entrada.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });
});

describe("conversas de e-mail", () => {
  const CONTA = { id: "11111111-1111-4111-8111-111111111111" as IdContaEmail, rotulo: "Profills" };
  const cliente = { id: 9301, nome: textoExterno("CANARIO Cliente 9301"), cidade: textoExterno("Curitiba") };
  const deEmail = (campos: Partial<ItemDeResponderDeEmail> = {}): ItemDeResponderDeEmail =>
    ({
      canal: "email",
      id: "e-0123456789abcdef",
      conta: CONTA,
      endereco: "compras@cliente.exemplo.test",
      nome_do_remetente: textoExterno("Compras Canário"),
      assunto: textoExterno("Pedido de orçamento"),
      ultimo_email: "entrada-9",
      em_quarentena: false,
      mensagens_em_quarentena: [],
      desde: antes(24 * 60),
      novas: 1,
      vinculo: "auto",
      cliente,
      ...campos,
    }) as ItemDeResponderDeEmail;
  type AmbiguoDeEmail = Extract<ItemDeResponderDeEmail, { vinculo: "ambiguo" }>;
  const ambiguoDeEmail = (campos: Partial<AmbiguoDeEmail> = {}): AmbiguoDeEmail =>
    deEmail({
      vinculo: "ambiguo",
      cliente: null,
      candidatos: [
        { id: 9304, nome: textoExterno("CANARIO Cliente 9304"), cidade: textoExterno("Curitiba"), uf: textoExterno("PR") },
        { id: 9305, nome: textoExterno("CANARIO Cliente 9305"), cidade: null, uf: null },
      ],
      motivo_da_duvida: "varios_clientes",
      ...campos,
    } as Partial<ItemDeResponderDeEmail>) as AmbiguoDeEmail;

  test("título: o cliente, ou o endereço com o nome do remetente, ou só o endereço, ou a frase sem endereço", () => {
    expect(tituloDoEmail(deEmail())).toBe("CANARIO Cliente 9301");
    expect(tituloDoEmail(ambiguoDeEmail())).toBe("compras@cliente.exemplo.test · Compras Canário");
    expect(tituloDoEmail(ambiguoDeEmail({ nome_do_remetente: null }))).toBe("compras@cliente.exemplo.test");
    expect(tituloDoEmail(ambiguoDeEmail({ endereco: null }))).toBe("E-mail sem endereço");
    expect(tituloDoEmail(deEmail({ endereco: null }))).toBe("CANARIO Cliente 9301");
  });

  test("Responder: o assunto e a contagem, no singular e no plural, ou só a contagem sem assunto", () => {
    expect(apoioDoEmailEmResponder(deEmail({ novas: 1, desde: antes(25 * 60) }), AGORA)).toBe("Pedido de orçamento · 1 e-mail novo, de ontem");
    expect(apoioDoEmailEmResponder(deEmail({ novas: 2, desde: antes(3 * 24 * 60) }), AGORA)).toBe("Pedido de orçamento · 2 e-mails novos. O mais antigo é de 3 dias atrás");
    expect(apoioDoEmailEmResponder(deEmail({ novas: 1, desde: antes(5 * 60), assunto: null }), AGORA)).toBe("1 e-mail novo, de 5 horas atrás");
    expect(apoioDoEmailEmResponder(deEmail({ novas: 3, desde: antes(2 * 24 * 60), assunto: null }), AGORA)).toBe("3 e-mails novos. O mais antigo é de 2 dias atrás");
  });

  test("Esperando cliente: o assunto e os dias úteis, no singular e no plural", () => {
    const esperando = (campos: Partial<ItemDeEsperandoDeEmail>) => ({ dias_uteis: 6, assunto: textoExterno("Tabela de preços 2026"), ...campos });
    expect(apoioDoEmailEmEsperando(esperando({}))).toBe("Tabela de preços 2026 · Você respondeu por último há 6 dias úteis");
    expect(apoioDoEmailEmEsperando(esperando({ dias_uteis: 1 }))).toBe("Tabela de preços 2026 · Você respondeu por último há 1 dia útil");
    expect(apoioDoEmailEmEsperando(esperando({ assunto: null }))).toBe("Você respondeu por último há 6 dias úteis");
  });

  test("a etiqueta do canal: WhatsApp, ou E-mail com o rótulo da conta", () => {
    expect(etiquetaDoCanal(deEmail())).toBe("E-mail · Profills");
    expect(etiquetaDoCanal(doCliente)).toBe("WhatsApp");
  });

  test("a frase do motivo da dúvida do e-mail", () => {
    expect(motivoDaDuvidaDoEmail(ambiguoDeEmail())).toBe("Este endereço está em 2 clientes do CRM.");
    expect(motivoDaDuvidaDoEmail(ambiguoDeEmail({ motivo_da_duvida: "sem_prova_do_email" }))).toBe("O CRM achou este cliente pelo endereço, mas sem um contato com este e-mail. Confira se é ele.");
    expect(motivoDaDuvidaDoEmail(ambiguoDeEmail({ motivo_da_duvida: "desfeito_pelo_vendedor" }))).toBe("Você desfez o que tinha decidido sobre este endereço. Confira qual é o cliente.");
    expect(motivoDaDuvidaDoEmail(ambiguoDeEmail({ motivo_da_duvida: "variante_do_9" }))).toBe("Confira se é este cliente.");
  });

  test("o nome do remetente só aparece quando existe", () => {
    expect(nomeDoRemetente("Compras Canário")).toBe("No e-mail o remetente se chama Compras Canário.");
    expect(nomeDoRemetente(null)).toBeNull();
  });

  test("a lista dos não clientes diz o endereço", () => {
    expect(frasePrincipalDoNaoCliente({ canal: "email", endereco: "compras@cliente.exemplo.test" })).toBe("compras@cliente.exemplo.test: você disse que não é cliente.");
    expect(frasePrincipalDoNaoCliente({ canal: "whatsapp", telefone: "+5541999990002", nome_no_whatsapp: null })).toBe("(41) 99999-0002: você disse que não é cliente.");
  });

  test("a frase das marcas diz a tela do lugar", () => {
    expect(avisoDasMarcas(partesDoTexto("a⟦U+200B⟧b"), "e-mail")).toBe("A marca ⟦U+200B⟧ mostra um caractere que não aparece na tela do e-mail.");
    expect(avisoDasMarcas(partesDoTexto("⟦U+200B⟧⟦U+202E⟧"), "e-mail")).toBe("As marcas ⟦U+200B⟧ e ⟦U+202E⟧ mostram caracteres que não aparecem na tela do e-mail.");
  });

  describe("quais e-mails a gaveta abre", () => {
    const quarentena = (...ids: string[]) => ids;
    test("sem quarentena, só o último", () => {
      expect(emailsDaGaveta({ ultimo_email: "u", mensagens_em_quarentena: [] })).toEqual({ ids: ["u"], semLugar: 0 });
    });

    test("item de Esperando cliente não tem o campo: só o último", () => {
      expect(emailsDaGaveta({ ultimo_email: "u" })).toEqual({ ids: ["u"], semLugar: 0 });
    });

    test("com quarentena que inclui o último, sem repetir, do mais antigo para o mais novo", () => {
      expect(emailsDaGaveta({ ultimo_email: "c", mensagens_em_quarentena: quarentena("a", "c") })).toEqual({ ids: ["a", "c"], semLugar: 0 });
    });

    test("com quarentena que não inclui o último, ele entra no fim", () => {
      expect(emailsDaGaveta({ ultimo_email: "z", mensagens_em_quarentena: quarentena("a", "b") })).toEqual({ ids: ["a", "b", "z"], semLugar: 0 });
    });

    test("passando de 5, os 5 mais novos, o último sempre, e quantos ficaram de fora", () => {
      const sete = quarentena("a", "b", "c", "d", "e", "f", "g");
      expect(emailsDaGaveta({ ultimo_email: "g", mensagens_em_quarentena: sete })).toEqual({ ids: ["c", "d", "e", "f", "g"], semLugar: 2 });
      expect(emailsDaGaveta({ ultimo_email: "z", mensagens_em_quarentena: sete })).toEqual({ ids: ["d", "e", "f", "g", "z"], semLugar: 3 });
      expect(emailsDaGaveta({ ultimo_email: "e", mensagens_em_quarentena: quarentena("a", "b", "c", "d", "e") })).toEqual({ ids: ["a", "b", "c", "d", "e"], semLugar: 0 });
    });

    test("a linha do que ficou de fora, no singular e no plural", () => {
      expect(avisoDosEmailsSemLugar(0)).toBeNull();
      expect(avisoDosEmailsSemLugar(1)).toBe("Esta conversa tem mais 1 e-mail em quarentena. Leia no seu programa de e-mail.");
      expect(avisoDosEmailsSemLugar(3)).toBe("Esta conversa tem mais 3 e-mails em quarentena. Leia no seu programa de e-mail.");
    });
  });
});
