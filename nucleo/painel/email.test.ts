import { describe, expect, test } from "bun:test";
import { instante, lerIdContaEmail, type ErroOperacao, type Instante, type VisaoDaContaEmail } from "../dominio";
import { NOMES_DAS_CENAS, montarCena } from "./dev/cenas";
import * as emailDev from "./dev/email";
import { ENVIO_INICIAL, contagemDasContas, podeAdicionar, podeEnviar, problemaDaConta, reduzirEnvio, situacaoDoCartao, vistaDoEnvio, type EnvioDaConta } from "./email";
import { hashDaRota, lerRota } from "./rota";

const agora = new Date("2026-11-13T12:00:00Z");
const cena = (nome: string) => montarCena(nome, agora)!;
const contas = (nome: string) => cena(nome).email.contas;
const erro: ErroOperacao = { codigo: "email_rotulo_repetido", mensagem: "Já existe.", acao: "Escolha outro." };

describe("cartão do e-mail", () => {
  test("sem conta, pulado ou com contas", () => {
    expect(situacaoDoCartao(cena("email-sem-conta").email)).toBe("sem_conta");
    expect(situacaoDoCartao(cena("email-pulado").email)).toBe("pulado");
    expect(situacaoDoCartao(cena("email-duas-conectadas").email)).toBe("com_contas");
  });

  test("a contagem diz quantas contas e avisa quando alguma precisa de atenção", () => {
    expect(contagemDasContas([])).toBeNull();
    expect(contagemDasContas(contas("email-uma-conta"))).toEqual({ tom: "ok", texto: "1 conta" });
    expect(contagemDasContas(contas("email-duas-conectadas"))).toEqual({ tom: "ok", texto: "2 contas" });
    expect(contagemDasContas(contas("email-uma-em-atencao"))).toEqual({ tom: "atencao", texto: "2 contas" });
  });

  test("com 5 contas o cartão não oferece outra", () => {
    expect(podeAdicionar(cena("email-duas-conectadas").email)).toBe(true);
    expect(cena("email-limite").email.contas).toHaveLength(5);
    expect(podeAdicionar(cena("email-limite").email)).toBe(false);
  });

  test("o problema do Gmail leva o link da senha de app; o da senha recusada, não", () => {
    expect(problemaDaConta(contas("email-gmail-senha-de-app")[0]!)?.ajuda).toBe("https://myaccount.google.com/apppasswords");
    expect(problemaDaConta(contas("email-uma-em-atencao")[0]!)?.ajuda).toBeNull();
    expect(problemaDaConta(contas("email-uma-conta")[0]!)).toBeNull();
  });
});

describe("rota da gaveta", () => {
  const id = lerIdContaEmail("00000000-0000-4000-8000-000000000001")!;
  test.each([
    ["#/conexoes/email/nova", { tela: "conexoes", gaveta: { tipo: "nova", provedor: null } }],
    ["#/conexoes/email/nova/gmail", { tela: "conexoes", gaveta: { tipo: "nova", provedor: "gmail" } }],
    [`#/conexoes/email/${id}`, { tela: "conexoes", gaveta: { tipo: "conta", id } }],
  ] as const)("%s ida e volta", (hash, rota) => {
    expect(lerRota(hash) as unknown).toEqual(rota);
    expect(hashDaRota(rota)).toBe(hash);
  });

  test.each(["#/conexoes/email", "#/conexoes/email/nova/yahoo", "#/conexoes/email/nao-e-uuid", `#/conexoes/email/${id}/x`, "#/conexoes/whatsapp/nova"])("%s não é rota", (hash) => {
    expect(lerRota(hash)).toBeNull();
  });
});

/** A conta da cena com o estado trocado, como chegaria num snapshot novo do SSE. */
function comEstado(conta: VisaoDaContaEmail, estado: VisaoDaContaEmail["estado"]): VisaoDaContaEmail {
  return { ...conta, estado };
}

describe("envio da conta nova", () => {
  const base = contas("email-uma-conta")[0]!;
  const testando = comEstado(base, { fase: "testando", config: base.config, expiraEm: instante(agora), anterior: { fase: "desconectado" } });
  const recusada = comEstado(base, { fase: "atencao", problema: { codigo: "email_senha_recusada", desde: "2026-11-13T11:00:00.000Z" as Instante } });
  const recusadaDeNovo = comEstado(base, { fase: "atencao", problema: { codigo: "email_senha_recusada", desde: "2026-11-13T12:00:05.000Z" as Instante } });

  const passos = (inicio: EnvioDaConta, ...eventos: Parameters<typeof reduzirEnvio>[1][]) => eventos.reduce(reduzirEnvio, inicio);

  test("o botão trava do clique até o resultado do teste, e o segundo enviar não faz nada", () => {
    const enviando = passos(ENVIO_INICIAL, { tipo: "enviar", conta: undefined });
    expect(podeEnviar(vistaDoEnvio(enviando, undefined))).toBe(false);
    expect(reduzirEnvio(enviando, { tipo: "enviar", conta: undefined })).toBe(enviando);
    const acompanhando = reduzirEnvio(enviando, { tipo: "aceito" });
    expect(vistaDoEnvio(acompanhando, undefined)).toEqual({ tipo: "testando", expiraEm: null });
    expect(vistaDoEnvio(acompanhando, testando)).toEqual({ tipo: "testando", expiraEm: instante(agora) });
    expect(podeEnviar(vistaDoEnvio(acompanhando, testando))).toBe(false);
  });

  test("o login que passa vira conectou; o que falha volta a editar com o problema", () => {
    const acompanhando = passos(ENVIO_INICIAL, { tipo: "enviar", conta: undefined }, { tipo: "aceito" });
    expect(vistaDoEnvio(acompanhando, base)).toEqual({ tipo: "conectou" });
    const falhou = vistaDoEnvio(acompanhando, recusada);
    expect(falhou).toEqual({ tipo: "editando", erro: null, problema: recusada });
    expect(podeEnviar(falhou)).toBe(true);
  });

  test("na nova tentativa, o problema velho não passa pelo resultado da nova", () => {
    const acompanhando = passos(ENVIO_INICIAL, { tipo: "enviar", conta: recusada }, { tipo: "aceito" });
    expect(vistaDoEnvio(acompanhando, recusada).tipo).toBe("testando");
    expect(vistaDoEnvio(acompanhando, recusadaDeNovo)).toEqual({ tipo: "editando", erro: null, problema: recusadaDeNovo });
  });

  test("o pedido recusado pelo servidor mostra o erro e libera o botão", () => {
    const recusado = passos(ENVIO_INICIAL, { tipo: "enviar", conta: undefined }, { tipo: "recusado", erro });
    expect(vistaDoEnvio(recusado, undefined)).toEqual({ tipo: "editando", erro, problema: null });
  });
});

describe("e-mail do servidor de desenvolvimento", () => {
  const momento = instante(agora);
  const id = "00000000-0000-4000-8000-0000000000ff";
  const corpo = { id, rotulo: "Profills", provedor: "profills", endereco: "novo@profills.test", senha: "x" };

  test("adicionar repetido com o mesmo id não cria outra conta", () => {
    const primeiro = emailDev.adicionar({ pulado: true, contas: [] }, corpo, momento);
    expect(primeiro.email.pulado).toBe(false);
    expect(primeiro.email.contas[0]?.estado.fase).toBe("testando");
    const segundo = emailDev.adicionar(primeiro.email, corpo, momento);
    expect(segundo.email.contas).toHaveLength(1);
    expect(segundo.testar).toBeUndefined();
  });

  test("o teste com a senha errada do Gmail cai no problema da senha de app", () => {
    const passo = emailDev.adicionar({ pulado: false, contas: [] }, { ...corpo, provedor: "gmail", endereco: "a@gmail.com", senha: "errada" }, momento);
    expect(passo.testar).toEqual({ id: lerIdContaEmail(id)!, passa: false });
    const depois = emailDev.concluirTeste(passo.email, passo.testar!.id, false, momento);
    expect(depois.contas[0]?.estado).toEqual({ fase: "atencao", problema: { codigo: "email_gmail_senha_de_app", desde: momento } });
  });

  test("rótulo repetido, limite e remover", () => {
    const duas = cena("email-duas-conectadas").email;
    expect(emailDev.adicionar(duas, { ...corpo, rotulo: "pessoal" }, momento).resultado).toMatchObject({ ok: false, erro: { codigo: "email_rotulo_repetido" } });
    expect(emailDev.adicionar(cena("email-limite").email, corpo, momento).resultado).toMatchObject({ ok: false, erro: { codigo: "email_limite_de_contas" } });
    const removida = emailDev.agir(duas, duas.contas[0]!.id, "remover", undefined, momento);
    expect(removida.email.contas.map((conta) => conta.rotulo)).toEqual(["Pessoal"]);
  });

  test("todas as cenas montam", () => {
    for (const nome of NOMES_DAS_CENAS) expect(montarCena(nome, agora)).not.toBeNull();
  });
});
