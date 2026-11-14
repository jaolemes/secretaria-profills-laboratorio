import { describe, expect, test } from "bun:test";
import { CAMPOS_DE_TEXTO, CAMPOS_OBRIGATORIOS, TOOLS_DE_ESCRITA } from "../escritas";
import { ERROS, PROBLEMAS, type EstadoCrm, type Instante } from "../dominio";
import type { Resposta } from "./api";
import type { ApiDaFila } from "./aprovar";
import {
  AVISO_DE_TEXTO_SALVO,
  CAMPOS_DO_CARTAO,
  MOTIVO_DE_ABRIR_O_TEXTO,
  ROTULOS_DAS_ACOES_DO_CARTAO,
  TEXTO_NAO_SALVO,
  acoesDaGaveta,
  acoesDaLinha,
  apoioDoCartao,
  avisoDasMarcasDoCartao,
  avisoFlutuanteDaDecisao,
  camposAlterados,
  camposParaLer,
  corpoDeEditar,
  criarTrava,
  decidirNoServidor,
  desfechoDaDecisao,
  desfechoDaEdicao,
  duracaoPorExtenso,
  editarNoServidor,
  fraseDoPortao,
  hashParaDecidir,
  momentoPorExtenso,
  motivoDoAprovar,
  podeSalvar,
  portaoDoCrm,
  selosDoCartao,
  sinaisDoCartao,
  tituloDoCartao,
  valoresDaEdicao,
  vistaDoBotao,
} from "./aprovar";
import { AGORA, CLIENTE_CONFERIDO, HASH, cartao, compromisso, resumo } from "./fixtures-da-fila";
import type { CartaoVisto, EstadoDaEscrita, ResumoDaEscrita } from "../escritas";

describe("título e apoio da linha", () => {
  test("as três ações, com o nome do cliente", () => {
    expect(tituloDoCartao(resumo())).toBe("Registrar atendimento · CANARIO Cliente 9201");
    expect(tituloDoCartao(resumo({ tool: "criar_compromisso" }))).toBe("Criar compromisso · CANARIO Cliente 9201");
    expect(tituloDoCartao(resumo({ tool: "criar_contato" }))).toBe("Criar contato · CANARIO Cliente 9201");
  });

  test("sem cliente, só a ação; por conferir, o número do cliente", () => {
    expect(tituloDoCartao(resumo({ tool: "criar_compromisso", cliente: null }))).toBe("Criar compromisso");
    expect(tituloDoCartao(resumo({ tool: "criar_contato", cliente: { id: 9202, conferido: false } }))).toBe("Criar contato · cliente nº 9202");
  });

  test("o apoio diz quando o agente redigiu, com o momento de Brasília", () => {
    expect(apoioDoCartao(resumo(), AGORA)).toBe("Redigido pelo agente hoje às 9h12");
    expect(apoioDoCartao(resumo(), new Date("2026-11-16T15:00:00.000Z"))).toBe("Redigido pelo agente 14 de novembro às 9h12");
  });

  test("com a marca Confira o cliente e cidade, a cidade vem antes; sem a marca, não", () => {
    expect(apoioDoCartao(resumo({ confiraOCliente: true }), AGORA)).toBe("Curitiba · Redigido pelo agente hoje às 9h12");
    expect(apoioDoCartao(resumo({ confiraOCliente: true, cliente: { ...CLIENTE_CONFERIDO, cidade: null } }), AGORA)).toBe("Redigido pelo agente hoje às 9h12");
  });

  test("cliente por conferir abre o apoio com o aviso", () => {
    expect(apoioDoCartao(resumo({ cliente: { id: 9202, conferido: false } }), AGORA)).toBe("Cliente ainda não conferido no CRM · Redigido pelo agente hoje às 9h12");
    expect(apoioDoCartao(resumo({ cliente: null }), AGORA)).toBe("Redigido pelo agente hoje às 9h12");
  });
});

describe("selos e ações por estado", () => {
  test("os selos saem nesta ordem", () => {
    expect(selosDoCartao(resumo())).toEqual([]);
    expect(selosDoCartao(resumo({ confiraOTexto: true, confiraOCliente: true, estado: "falhou_incerto" }))).toEqual(["Confira o texto", "Confira o cliente", "Pode ter gravado"]);
    expect(selosDoCartao(resumo({ confiraOTexto: true, estado: "falhou" }))).toEqual(["Confira o texto", "O CRM recusou"]);
  });

  test("a linha: Descartar, Ver o texto e Aprovar; o incerto só deixa ver", () => {
    expect(acoesDaLinha("rascunho")).toEqual(["descartar", "ver", "aprovar"]);
    expect(acoesDaLinha("falhou")).toEqual(["descartar", "ver", "aprovar"]);
    expect(acoesDaLinha("falhou_incerto")).toEqual(["ver"]);
  });

  test("a gaveta: o rodapé de cada estado e o da edição", () => {
    expect(acoesDaGaveta("rascunho", false)).toEqual(["editar", "descartar", "aprovar"]);
    expect(acoesDaGaveta("falhou", false)).toEqual(["editar", "descartar", "aprovar"]);
    expect(acoesDaGaveta("rascunho", true)).toEqual(["cancelar", "salvar"]);
    expect(acoesDaGaveta("falhou_incerto", false)).toEqual(["descartar", "tentar_de_novo", "ja_esta_no_crm"]);
    expect(acoesDaGaveta("falhou_incerto", true)).toEqual(["descartar", "tentar_de_novo", "ja_esta_no_crm"]);
    for (const estado of ["gravando", "aprovado", "gravado", "descartado"] as const) expect(acoesDaGaveta(estado, false)).toEqual(["fechar"]);
  });

  test("os sinais de todos os campos, sem repetir, na ordem de SINAIS", () => {
    expect(sinaisDoCartao({ descricao: ["pede_comando", "caractere_invisivel"], assunto: ["pede_comando"] })).toEqual(["caractere_invisivel", "pede_comando"]);
    expect(sinaisDoCartao({})).toEqual([]);
  });
});

describe("portão do CRM e Aprovar da linha", () => {
  const conectado: EstadoCrm = { fase: "conectado", conexaoExpiraEm: "2027-01-01T00:00:00.000Z" as Instante, verificadoEm: "2026-11-14T12:00:00.000Z" as Instante, ferramentas: 18 };
  const atencao = (codigo: "crm_app_nao_liberado" | "crm_conexao_vencida"): EstadoCrm => ({ fase: "atencao", problema: { codigo, desde: "2026-11-14T12:00:00.000Z" as Instante } });
  const nenhum = new Map();

  test("conectado e sem estado não barram", () => {
    expect(portaoDoCrm(conectado)).toBeNull();
    expect(portaoDoCrm(null)).toBeNull();
  });

  test("desconectado e autorizando barram com o texto de crm_desconectado", () => {
    const esperado = { mensagem: ERROS.crm_desconectado.mensagem, acao: ERROS.crm_desconectado.acao };
    expect(portaoDoCrm({ fase: "desconectado" })).toEqual(esperado);
    expect(portaoDoCrm({ fase: "autorizando", expiraEm: "2026-11-14T12:10:00.000Z" as Instante, anterior: { fase: "desconectado" } })).toEqual(esperado);
  });

  test("atenção barra com a mensagem e a ação do problema", () => {
    expect(portaoDoCrm(atencao("crm_app_nao_liberado"))).toEqual({ mensagem: "O CRM ainda não liberou a Secretária.", acao: PROBLEMAS.crm_app_nao_liberado.acao });
    expect(portaoDoCrm(atencao("crm_conexao_vencida"))?.mensagem).toBe(PROBLEMAS.crm_conexao_vencida.mensagem);
  });

  test("sem texto com sinal, a linha aprova; o portão trava com a frase", () => {
    expect(motivoDoAprovar(resumo(), nenhum, null)).toBeNull();
    const portao = portaoDoCrm({ fase: "desconectado" });
    expect(portao).not.toBeNull();
    expect(motivoDoAprovar(resumo(), nenhum, portao)).toBe(fraseDoPortao(portao!));
  });

  test("com confiraOTexto, só habilita depois de a gaveta mostrar a versão atual", () => {
    const sinal = resumo({ confiraOTexto: true, hash: null, versao: 3 });
    expect(hashParaDecidir(sinal, nenhum)).toBeNull();
    expect(motivoDoAprovar(sinal, nenhum, null)).toBe(MOTIVO_DE_ABRIR_O_TEXTO);
    expect(MOTIVO_DE_ABRIR_O_TEXTO).toBe("Abra o texto antes de aprovar");
    const aberto = new Map([[sinal.id, { versao: 3, hash: HASH }]]);
    expect(hashParaDecidir(sinal, aberto)).toBe(HASH);
    expect(motivoDoAprovar(sinal, aberto, null)).toBeNull();
  });

  test("a versão mudou e o cartão ainda tem sinal: volta a desabilitar", () => {
    const aberto = new Map([["0b0e6f0e-1c1c-4c1c-9c1c-000000000001", { versao: 3, hash: HASH }]]);
    const nova = resumo({ confiraOTexto: true, hash: null, versao: 4 });
    expect(motivoDoAprovar(nova, aberto, null)).toBe(MOTIVO_DE_ABRIR_O_TEXTO);
  });

  test("o CRM barrado vem antes de abrir o texto", () => {
    const portao = portaoDoCrm({ fase: "desconectado" })!;
    expect(motivoDoAprovar(resumo({ confiraOTexto: true, hash: null }), nenhum, portao)).toBe(fraseDoPortao(portao));
  });

  test("com um pedido em curso, todo botão de decisão fica desabilitado e só o clicado diz Gravando", () => {
    const pedido = { id: "a", acao: "aprovar" } as const;
    const contexto = { id: "a", pedido, portao: null };
    expect(vistaDoBotao("aprovar", contexto)).toEqual({ desabilitado: true, titulo: undefined, gravando: true });
    expect(vistaDoBotao("descartar", contexto)).toEqual({ desabilitado: true, titulo: undefined, gravando: false });
    expect(vistaDoBotao("aprovar", { ...contexto, id: "b" })).toEqual({ desabilitado: true, titulo: undefined, gravando: false });
    expect(vistaDoBotao("ver", contexto).desabilitado).toBe(false);
    expect(vistaDoBotao("fechar", contexto).desabilitado).toBe(false);
    expect(vistaDoBotao("tentar_de_novo", { id: "a", pedido: { id: "a", acao: "tentar_de_novo" }, portao: null }).gravando).toBe(true);
    expect(vistaDoBotao("aprovar", { id: "a", pedido: null, portao: null })).toEqual({ desabilitado: false, titulo: undefined, gravando: false });
  });

  test("o portão barra Aprovar e Não gravou, mas não Descartar, Editar nem Já está no CRM", () => {
    const portao = portaoDoCrm({ fase: "desconectado" })!;
    const frase = fraseDoPortao(portao);
    const contexto = { id: "a", pedido: null, portao };
    expect(vistaDoBotao("aprovar", contexto)).toMatchObject({ desabilitado: true, titulo: frase });
    expect(vistaDoBotao("tentar_de_novo", contexto)).toMatchObject({ desabilitado: true, titulo: frase });
    for (const acao of ["descartar", "editar", "ver", "ja_esta_no_crm"] as const) expect(vistaDoBotao(acao, contexto)).toMatchObject({ desabilitado: false, titulo: undefined });
  });

  test("Salvar só habilita com mudança", () => {
    expect(vistaDoBotao("salvar", { id: "a", pedido: null, portao: null }).desabilitado).toBe(true);
    expect(vistaDoBotao("salvar", { id: "a", pedido: null, portao: null, salvarPode: true }).desabilitado).toBe(false);
  });
});

describe("campos do cartão", () => {
  test("a ordem e o rótulo de cada tool, os da tabela do brief", () => {
    const rotulos = (tool: keyof typeof CAMPOS_DO_CARTAO) => Object.entries(CAMPOS_DO_CARTAO[tool]).map(([campo, def]) => [campo, def.rotulo]);
    expect(rotulos("registrar_atendimento")).toEqual([["assunto", "Assunto"], ["status", "Situação"], ["descricao", "Descrição"], ["contato_id", "Contato"]]);
    expect(rotulos("criar_compromisso")).toEqual([["titulo", "Título"], ["inicio", "Início"], ["fim", "Fim"], ["descricao", "Descrição"], ["tipo", "Tipo"]]);
    expect(rotulos("criar_contato")).toEqual([["nome", "Nome"], ["telefone", "Telefone"], ["email", "E-mail"], ["cargo", "Cargo"], ["departamento", "Departamento"], ["observacoes", "Observações"]]);
  });

  test("a tabela do painel é a de CAMPOS_DE_TEXTO e a de CAMPOS_OBRIGATORIOS", () => {
    for (const tool of TOOLS_DE_ESCRITA) {
      const tabela = Object.entries(CAMPOS_DO_CARTAO[tool]) as [string, { tipo: string; obrigatorio?: true }][];
      expect(tabela.filter(([, def]) => def.tipo !== "leitura").map(([campo]) => campo).sort()).toEqual([...CAMPOS_DE_TEXTO[tool]].sort());
      expect(tabela.filter(([, def]) => def.obrigatorio === true).map(([campo]) => campo).sort()).toEqual([...CAMPOS_OBRIGATORIOS[tool]].sort());
    }
  });

  test("campo opcional ausente não aparece; o valor de Situação e Contato", () => {
    const so = camposParaLer(cartao({ dados: { cliente_id: 9201, assunto: "CANARIO a", status: "Em Andamento" } }));
    expect(so.map((c) => [c.rotulo, c.valor])).toEqual([["Assunto", "CANARIO a"], ["Situação", "Em Andamento"]]);
    const com = camposParaLer(cartao({ dados: { cliente_id: 9201, assunto: "CANARIO a", status: "Pendente", contato_id: 77 } }));
    expect(com.at(-1)).toMatchObject({ rotulo: "Contato", valor: "Contato nº 77 do cliente no CRM" });
  });

  test("o tipo do compromisso e o contato mostram o valor como veio, sem link", () => {
    const comTipo = compromisso({ titulo: "CANARIO visita", inicio: "2026-11-20 10:00", fim: "2026-11-20 11:30", tipo: "operational" });
    expect(camposParaLer(comTipo).find((c) => c.campo === "tipo")?.valor).toBe("Operacional");
    expect(camposParaLer(compromisso({ titulo: "t", inicio: "2026-11-20 10:00", tipo: "client" })).find((c) => c.campo === "tipo")?.valor).toBe("Com cliente");
    expect(camposParaLer(compromisso({ titulo: "t", inicio: "2026-11-20 10:00", tipo: "internal" })).find((c) => c.campo === "tipo")?.valor).toBe("Interno");
    const contato = cartao({ tool: "criar_contato", dados: { cliente_id: 9201, nome: "CANARIO Contato", telefone: "41999990001", email: "contato@canario.exemplo.test" } });
    expect(camposParaLer(contato).map((c) => [c.rotulo, c.valor])).toEqual([["Nome", "CANARIO Contato"], ["Telefone", "41999990001"], ["E-mail", "contato@canario.exemplo.test"]]);
  });
});

describe("compromisso por extenso", () => {
  test("com fim: início e fim por extenso e a duração", () => {
    const c = compromisso({ titulo: "CANARIO visita", inicio: "2026-11-20 10:00", fim: "2026-11-20 11:30" });
    const campos = camposParaLer(c);
    expect(campos.find((x) => x.campo === "inicio")?.valor).toBe("sexta-feira, 20 de novembro, 10h");
    expect(campos.find((x) => x.campo === "fim")?.valor).toBe("sexta-feira, 20 de novembro, 11h30 (1 hora e 30 minutos)");
  });

  test("sem fim, o Fim aparece e diz que o CRM assume 1 hora", () => {
    const campos = camposParaLer(compromisso({ titulo: "CANARIO visita", inicio: "2026-11-20 10:00" }));
    expect(campos.find((x) => x.campo === "fim")?.valor).toBe("Não informado. O CRM assume 1 hora: termina às 11h.");
  });

  test("virando o dia, com e sem fim", () => {
    const comFim = camposParaLer(compromisso({ titulo: "t", inicio: "2026-11-20 23:00", fim: "2026-11-21 00:30" }));
    expect(comFim.find((x) => x.campo === "fim")?.valor).toBe("sábado, 21 de novembro, 0h30 (1 hora e 30 minutos)");
    const semFim = camposParaLer(compromisso({ titulo: "t", inicio: "2026-11-20 23:30" }));
    expect(semFim.find((x) => x.campo === "fim")?.valor).toBe("Não informado. O CRM assume 1 hora: termina às 0h30, no dia seguinte.");
  });

  test("a hora é a do texto, sem converter fuso", () => {
    expect(momentoPorExtenso("2026-11-20 15:05")).toBe("sexta-feira, 20 de novembro, 15h05");
    expect(momentoPorExtenso("2026-11-20 00:00")).toBe("sexta-feira, 20 de novembro, 0h");
  });

  test("a duração por extenso", () => {
    expect([60, 90, 45, 120, 1, 61].map(duracaoPorExtenso)).toEqual(["1 hora", "1 hora e 30 minutos", "45 minutos", "2 horas", "1 minuto", "1 hora e 1 minuto"]);
  });
});

describe("texto com caractere invisível", () => {
  test("cada invisível vira marca, e a frase da marca diz CRM, uma vez", () => {
    const c = cartao({ dados: { cliente_id: 9201, assunto: "CANARIO a\u200Bb", status: "Concluído", descricao: "outro\u200B texto" } });
    const campos = camposParaLer(c);
    expect(campos[0]?.valor).toBe("CANARIO a⟦U+200B⟧b");
    expect(avisoDasMarcasDoCartao(campos)).toBe("A marca ⟦U+200B⟧ mostra um caractere que não aparece na tela do CRM.");
  });

  test("a marca que o vendedor digitou não se passa pela da Secretária", () => {
    const c = cartao({ dados: { cliente_id: 9201, assunto: "CANARIO ⟦U+200B⟧ falsa", status: "Concluído" } });
    const campos = camposParaLer(c);
    expect(campos[0]?.valor).toBe("CANARIO ⟦U+27E6⟧U+200B⟧ falsa");
    expect(campos[0]?.valor).not.toContain("⟦U+200B⟧");
    expect(avisoDasMarcasDoCartao(campos)).toBe("A marca ⟦U+27E6⟧ mostra um caractere que não aparece na tela do CRM.");
  });

  test("sem marca, sem frase", () => {
    expect(avisoDasMarcasDoCartao(camposParaLer(cartao()))).toBeNull();
  });
});

describe("edição", () => {
  const base = cartao();

  test("a edição abre todos os campos de texto da tool, o opcional vazio também", () => {
    expect(valoresDaEdicao(cartao({ dados: { cliente_id: 9201, assunto: "CANARIO a", status: "Pendente" } }))).toEqual({ assunto: "CANARIO a", descricao: "" });
    expect(Object.keys(valoresDaEdicao(cartao({ tool: "criar_contato", dados: { cliente_id: 9201, nome: "CANARIO n", telefone: "41999990001" } })))).toEqual(["nome", "cargo", "departamento", "observacoes"]);
  });

  test("só o que mudou vai no pedido, com o hash e a versão do cartão", () => {
    const valores = { ...valoresDaEdicao(base), assunto: "CANARIO outro assunto" };
    expect(corpoDeEditar(base, valores)).toEqual({ hash: HASH, versao: 1, campos: { assunto: "CANARIO outro assunto" } });
  });

  test("opcional esvaziado vai como texto vazio", () => {
    const valores = { ...valoresDaEdicao(base), descricao: "" };
    expect(camposAlterados(base, valores)).toEqual({ descricao: "" });
  });

  test("nada mudou, ou só espaço nas pontas, não habilita Salvar", () => {
    expect(podeSalvar(base, valoresDaEdicao(base))).toBe(false);
    expect(podeSalvar(base, { ...valoresDaEdicao(base), assunto: "  CANARIO assunto do atendimento \r\n" })).toBe(false);
    expect(podeSalvar(base, { ...valoresDaEdicao(base), assunto: "CANARIO mudou" })).toBe(true);
  });

  test("o texto com invisível volta cru para a edição, para o vendedor poder tirá-lo", () => {
    const c = cartao({ dados: { cliente_id: 9201, assunto: "CANARIO a\u200Bb", status: "Concluído" } });
    expect(valoresDaEdicao(c).assunto).toBe("CANARIO a\u200Bb");
  });
});

describe("avisos de cada desfecho", () => {
  const ok = (c: CartaoVisto): Resposta<CartaoVisto> => ({ ok: true, dados: c });
  const erro = (codigo: string, mensagem: string, acao: string, atual?: unknown): Resposta<CartaoVisto> => ({ ok: false, erro: { codigo: codigo as never, mensagem, acao, ...(atual === undefined ? {} : { atual }) } });
  const antes = (estado: EstadoDaEscrita, cliente: ResumoDaEscrita["cliente"] = CLIENTE_CONFERIDO) => ({ estado, cliente });
  const gravado = (extra: Partial<CartaoVisto> = {}) => cartao({ estado: "gravado", recibo: { id: 70001, link: null }, ...extra } as Partial<CartaoVisto>);

  test("gravado com cliente, sem link: aviso de feito e a gaveta fecha", () => {
    const d = desfechoDaDecisao("aprovar", antes("rascunho"), ok(gravado()));
    expect(d.aviso).toEqual({ tom: "feito", texto: "Gravado no CRM: registrar atendimento de CANARIO Cliente 9201.", detalhe: null });
    expect(d.fechaGaveta).toBe(true);
    expect("link" in d.aviso).toBe(false);
  });

  test("gravado sem cliente e com link: a ação em minúsculas, e o link vai ao aviso", () => {
    const c = gravado({ tool: "criar_compromisso", cliente: null, recibo: { id: 70002, link: "https://crm.exemplo.test/c/1" } });
    expect(desfechoDaDecisao("aprovar", antes("rascunho"), ok(c)).aviso).toEqual({ tom: "feito", texto: "Gravado no CRM: criar compromisso.", detalhe: null, link: "https://crm.exemplo.test/c/1" });
  });

  test("falhou e falhou_incerto: o erro do cartão, e a gaveta fica aberta com o cartão novo", () => {
    const falhou = cartao({ estado: "falhou", erro: { codigo: "crm_recusou_a_escrita", mensagem: ERROS.crm_recusou_a_escrita.mensagem, acao: ERROS.crm_recusou_a_escrita.acao } });
    const d = desfechoDaDecisao("aprovar", antes("rascunho"), ok(falhou));
    expect(d).toMatchObject({ aviso: { tom: "erro", texto: ERROS.crm_recusou_a_escrita.mensagem, detalhe: ERROS.crm_recusou_a_escrita.acao }, fechaGaveta: false });
    expect(d.cartao).toBe(falhou);
    const incerto = cartao({ estado: "falhou_incerto", erro: { codigo: "crm_escrita_incerta", mensagem: ERROS.crm_escrita_incerta.mensagem, acao: ERROS.crm_escrita_incerta.acao } });
    expect(desfechoDaDecisao("tentar_de_novo", antes("falhou_incerto"), ok(incerto)).aviso).toMatchObject({ tom: "erro", texto: "A Secretária não sabe se o CRM gravou este registro." });
  });

  test("conflito: tom mudou, e a gaveta passa a mostrar erro.atual", () => {
    const atual = cartao({ versao: 2 });
    const d = desfechoDaDecisao("aprovar", antes("rascunho"), erro("conflito_da_escrita", "A Secretária conferiu o cliente no CRM e o cartão mudou. Confira o nome e a cidade e aprove de novo.", "Leia o cartão de novo e decida.", atual));
    expect(d.aviso).toEqual({ tom: "mudou", texto: "A Secretária conferiu o cliente no CRM e o cartão mudou. Confira o nome e a cidade e aprove de novo.", detalhe: "Leia o cartão de novo e decida." });
    expect(d.cartao).toBe(atual);
    expect(d.fechaGaveta).toBe(false);
    for (const codigo of ["estado_da_escrita", "cliente_por_conferir"]) expect(desfechoDaDecisao("aprovar", antes("rascunho"), erro(codigo, "m", "a", atual)).aviso.tom).toBe("mudou");
  });

  test("aprovar com cliente por conferir: o conflito traz o cartão conferido, e o aviso diz que o cliente foi conferido", () => {
    const atual = cartao({ versao: 2 });
    const d = desfechoDaDecisao("aprovar", antes("rascunho", { id: 9201, conferido: false }), erro("conflito_da_escrita", "Este cartão mudou desde que você o abriu.", "Leia o cartão de novo e decida.", atual));
    expect(d.aviso).toEqual({ tom: "mudou", texto: "A Secretária conferiu o cliente no CRM e o cartão mudou. Confira o nome e a cidade e aprove de novo.", detalhe: "Leia o cartão de novo e decida." });
    expect(d.cartao).toBe(atual);
    // Outro conflito, com o cliente já conferido antes, segue o texto que veio.
    expect(desfechoDaDecisao("aprovar", antes("rascunho"), erro("conflito_da_escrita", "Este cartão mudou desde que você o abriu.", "Leia o cartão de novo e decida.", atual)).aviso.texto).toBe("Este cartão mudou desde que você o abriu.");
  });

  test("CRM barrado, 404 e rede caída: aviso de erro com a mensagem e a ação, sem cartão", () => {
    for (const codigo of ["crm_desconectado", "crm_app_nao_liberado", "nao_encontrado", "interno", "servidor_fora_do_ar"]) {
      const d = desfechoDaDecisao("aprovar", antes("rascunho"), erro(codigo, `mensagem ${codigo}`, `acao ${codigo}`));
      const aviso = { tom: "erro" as const, texto: `mensagem ${codigo}`, detalhe: `acao ${codigo}` };
      expect(d).toEqual({ aviso, fechaGaveta: false, avisoNaGaveta: aviso, cartao: null });
    }
  });

  test("a gaveta que fica aberta mostra o erro do pedido dentro dela; o cartão que já traz o próprio erro não repete", () => {
    const atual = cartao({ versao: 2 });
    expect(desfechoDaDecisao("aprovar", antes("rascunho"), erro("conflito_da_escrita", "m", "a", atual)).avisoNaGaveta).toEqual({ tom: "mudou", texto: "m", detalhe: "a" });
    expect(desfechoDaDecisao("tentar_de_novo", antes("falhou_incerto"), erro("servidor_fora_do_ar", "m", "a")).avisoNaGaveta).toEqual({ tom: "erro", texto: "m", detalhe: "a" });
    const falhou = cartao({ estado: "falhou", erro: { codigo: "crm_recusou_a_escrita", mensagem: "x", acao: "y" } });
    expect(desfechoDaDecisao("aprovar", antes("rascunho"), ok(falhou)).avisoNaGaveta).toBeNull();
    expect(desfechoDaDecisao("aprovar", antes("rascunho"), ok(gravado())).avisoNaGaveta).toBeNull();
    expect(desfechoDaDecisao("descartar", antes("rascunho"), ok(cartao({ estado: "descartado" }))).avisoNaGaveta).toBeNull();
  });

  test("aviso flutuante: o da linha sempre; o da gaveta só quando ela fecha, e no alto", () => {
    const feito = desfechoDaDecisao("aprovar", antes("rascunho"), ok(gravado()));
    const caiu = desfechoDaDecisao("aprovar", antes("rascunho"), erro("servidor_fora_do_ar", "m", "a"));
    expect(avisoFlutuanteDaDecisao(caiu, false)).toEqual(caiu.aviso);
    expect(avisoFlutuanteDaDecisao(caiu, true)).toBeNull();
    expect(avisoFlutuanteDaDecisao(feito, false)).toEqual(feito.aviso);
    expect(avisoFlutuanteDaDecisao(feito, true)).toEqual({ ...feito.aviso, noTopo: true });
  });

  test("descartar: nada foi para o CRM, e no incerto manda conferir", () => {
    const descartado = cartao({ estado: "descartado" });
    expect(desfechoDaDecisao("descartar", antes("rascunho"), ok(descartado))).toMatchObject({ aviso: { tom: "feito", texto: "Descartado. Nada foi para o CRM." }, fechaGaveta: true });
    expect(desfechoDaDecisao("descartar", antes("falhou"), ok(descartado)).aviso.texto).toBe("Descartado. Nada foi para o CRM.");
    expect(desfechoDaDecisao("descartar", antes("falhou_incerto"), ok(descartado)).aviso.texto).toBe("Descartado. A Secretária parou de tentar. Confira no CRM se o registro existe.");
  });

  test("Já está no CRM: marcado como gravado, e a gaveta fecha", () => {
    const d = desfechoDaDecisao("ja_esta_no_crm", antes("falhou_incerto"), ok(gravado({ recibo: { id: null, link: null } })));
    expect(d).toMatchObject({ aviso: { tom: "feito", texto: "Marcado como gravado. A Secretária não manda de novo." }, fechaGaveta: true });
  });

  test("editar: salvo, texto recusado dentro da gaveta, conflito e erro de rede", () => {
    const novo = cartao({ versao: 2 });
    expect(desfechoDaEdicao(ok(novo))).toEqual({ aviso: { tom: "feito", texto: AVISO_DE_TEXTO_SALVO, detalhe: null }, erroNaGaveta: null, avisoNaGaveta: null, cartao: novo, fechaEdicao: true });
    expect(AVISO_DE_TEXTO_SALVO).toBe("Texto salvo. Agora é este o texto que vai para o CRM.");
    const invalida = erro("entrada_invalida", "O campo assunto é obrigatório.", "Escreva o assunto.");
    expect(desfechoDaEdicao(invalida)).toMatchObject({ aviso: null, fechaEdicao: false, erroNaGaveta: { codigo: "entrada_invalida" } });
    const conflito = desfechoDaEdicao(erro("conflito_da_escrita", "m", "a", novo));
    // O conflito fecha a edição, e a gaveta diz que o texto escrito não foi salvo.
    expect(conflito).toMatchObject({ aviso: null, avisoNaGaveta: { tom: "mudou", texto: "m", detalhe: TEXTO_NAO_SALVO }, fechaEdicao: true, erroNaGaveta: null });
    expect(conflito.cartao).toBe(novo);
    expect(desfechoDaEdicao(erro("servidor_fora_do_ar", "m", "a"))).toMatchObject({ aviso: null, avisoNaGaveta: { tom: "erro", texto: "m", detalhe: "a" }, fechaEdicao: false });
  });
});

describe("a trava do clique duplo", () => {
  test("o segundo clique no mesmo instante não manda outro pedido", async () => {
    const trava = criarTrava();
    let pedidos = 0;
    const pedir = async () => {
      pedidos += 1;
      await Promise.resolve();
      return "feito";
    };
    const [primeiro, segundo] = await Promise.all([trava.rodar(pedir), trava.rodar(pedir)]);
    expect([primeiro, segundo]).toEqual(["feito", null]);
    expect(pedidos).toBe(1);
    expect(await trava.rodar(pedir)).toBe("feito");
  });

  test("a trava abre mesmo quando o pedido falha", async () => {
    const trava = criarTrava();
    await expect(trava.rodar(async () => Promise.reject(new Error("rede")))).rejects.toThrow("rede");
    expect(await trava.rodar(async () => "outro")).toBe("outro");
  });
});

describe("o que a tela manda ao servidor", () => {
  type Chamada = readonly [string, string, unknown];
  /** Uma API que guarda cada chamada e responde com o cartão que o teste põe. */
  function apiDeMentira(vista: CartaoVisto, resposta: Resposta<CartaoVisto>) {
    const chamadas: Chamada[] = [];
    const api: ApiDaFila = {
      verEscrita: async (id) => (chamadas.push(["ver", id, undefined]), { ok: true, dados: vista }),
      editarEscrita: async (id, corpo) => (chamadas.push(["editar", id, corpo]), resposta),
      descartarEscrita: async (id, corpo) => (chamadas.push(["descartar", id, corpo]), resposta),
      aprovarEscrita: async (id, corpo) => (chamadas.push(["aprovar", id, corpo]), resposta),
      tentarDeNovo: async (id, corpo) => (chamadas.push(["tentar_de_novo", id, corpo]), resposta),
      jaEstaNoCrm: async (id, corpo) => (chamadas.push(["ja_esta_no_crm", id, corpo]), resposta),
    };
    return { api, chamadas };
  }
  const descartado = cartao({ estado: "descartado" });

  test("o resumo tem hash: decide com o hash e a versão do resumo, sem buscar o cartão", async () => {
    const { api, chamadas } = apiDeMentira(cartao(), { ok: true, dados: descartado });
    const r = resumo({ versao: 4 });
    const desfecho = await decidirNoServidor(api, r, "descartar");
    expect(chamadas).toEqual([["descartar", r.id, { hash: HASH, versao: 4 }]]);
    expect(desfecho.aviso.texto).toBe("Descartado. Nada foi para o CRM.");
  });

  test("descartar um cartão com hash null busca o cartão e descarta com o hash e a versão que vierem, sem abrir a gaveta", async () => {
    const outroHash = "ab".repeat(32);
    const { api, chamadas } = apiDeMentira(cartao({ hash: outroHash, versao: 7, confiraOTexto: true }), { ok: true, dados: descartado });
    const r = resumo({ confiraOTexto: true, hash: null, versao: 6 });
    await decidirNoServidor(api, r, "descartar");
    expect(chamadas).toEqual([["ver", r.id, undefined], ["descartar", r.id, { hash: outroHash, versao: 7 }]]);
  });

  test("se não dá para buscar o cartão, nada é descartado e o aviso é de erro", async () => {
    const chamadas: string[] = [];
    const api = {
      verEscrita: async () => ({ ok: false, erro: { codigo: "nao_encontrado", mensagem: "Não existe cartão com este id.", acao: "Recarregue o Meu dia." } }),
      descartarEscrita: async () => (chamadas.push("descartar"), { ok: true, dados: descartado }),
    } as unknown as ApiDaFila;
    const desfecho = await decidirNoServidor(api, resumo({ confiraOTexto: true, hash: null }), "descartar");
    expect(chamadas).toEqual([]);
    expect(desfecho.aviso).toEqual({ tom: "erro", texto: "Não existe cartão com este id.", detalhe: "Recarregue o Meu dia." });
  });

  test("cada ação chama a sua rota com o corpo { hash, versao }", async () => {
    const { api, chamadas } = apiDeMentira(cartao(), { ok: true, dados: cartao({ estado: "gravado", recibo: { id: 1, link: null } } as Partial<CartaoVisto>) });
    for (const acao of ["aprovar", "tentar_de_novo", "ja_esta_no_crm", "descartar"] as const) await decidirNoServidor(api, resumo({ estado: "falhou_incerto" }), acao);
    expect(chamadas.map(([quem]) => quem)).toEqual(["aprovar", "tentar_de_novo", "ja_esta_no_crm", "descartar"]);
    expect(chamadas.every(([, , corpo]) => JSON.stringify(corpo) === JSON.stringify({ hash: HASH, versao: 1 }))).toBe(true);
  });

  test("salvar manda só o campo que mudou, com o hash e a versão do cartão carregado", async () => {
    const novo = cartao({ versao: 2 });
    const { api, chamadas } = apiDeMentira(cartao({ versao: 1 }), { ok: true, dados: novo });
    const c = cartao({ versao: 1 });
    const desfecho = await editarNoServidor(api, c, { ...valoresDaEdicao(c), descricao: "" });
    expect(chamadas).toEqual([["editar", c.id, { hash: HASH, versao: 1, campos: { descricao: "" } }]]);
    expect(desfecho).toMatchObject({ fechaEdicao: true, cartao: novo, aviso: { tom: "feito", texto: AVISO_DE_TEXTO_SALVO } });
  });
});

describe("a frase de quando a Secretária não sabe se gravou", () => {
  test("cita cada botão inteiro, entre aspas, e o rótulo com vírgula não se parte", () => {
    for (const codigo of ["crm_escrita_incerta", "escrita_interrompida"] as const) {
      const { acao } = ERROS[codigo];
      expect(acao).toContain(`"${ROTULOS_DAS_ACOES_DO_CARTAO.ja_esta_no_crm}"`);
      expect(acao).toContain(`"${ROTULOS_DAS_ACOES_DO_CARTAO.tentar_de_novo}"`);
      expect(acao).toContain(`"${ROTULOS_DAS_ACOES_DO_CARTAO.descartar}"`);
      expect(acao).not.toContain(`${ROTULOS_DAS_ACOES_DO_CARTAO.tentar_de_novo}, ou`);
    }
  });
});
