import {
  LIMITE_DE_CONTAS_DE_EMAIL,
  PREDEFINICOES_DE_EMAIL,
  PROBLEMAS,
  type ErroOperacao,
  type EstadoEmail,
  type Instante,
  type ProvedorEmail,
  type VisaoDaContaEmail,
  type VisaoDoEmail,
} from "../dominio";
import type { Tom } from "./descrever";

/** O que o cartão do e-mail mostra. O e-mail é opcional: nenhum dos três estados é problema. */
export type SituacaoDoCartao = "sem_conta" | "pulado" | "com_contas";

export function situacaoDoCartao(email: VisaoDoEmail): SituacaoDoCartao {
  if (email.contas.length > 0) return "com_contas";
  return email.pulado ? "pulado" : "sem_conta";
}

export function podeAdicionar(email: VisaoDoEmail): boolean {
  return email.contas.length < LIMITE_DE_CONTAS_DE_EMAIL;
}

export interface TextoDoSelo {
  readonly tom: Tom;
  readonly texto: string;
}

/** O selo fala da conta, no feminino. */
export const SELO_DA_CONTA: { readonly [F in EstadoEmail["fase"]]: TextoDoSelo } = {
  desconectado: { tom: "neutro", texto: "Desconectada" },
  testando: { tom: "andamento", texto: "Testando" },
  conectado: { tom: "ok", texto: "Conectada" },
  atencao: { tom: "atencao", texto: "Precisa de atenção" },
};

/** "1 conta", "3 contas"; o tom avisa quando alguma conta precisa de atenção. */
export function contagemDasContas(contas: readonly VisaoDaContaEmail[]): TextoDoSelo | null {
  if (contas.length === 0) return null;
  const tom: Tom = contas.some((conta) => conta.estado.fase === "atencao") ? "atencao" : "ok";
  return { tom, texto: contas.length === 1 ? "1 conta" : `${contas.length} contas` };
}

export interface TextosDoProvedor {
  readonly nome: string;
  readonly resumo: string;
  readonly rotuloSugerido: string;
  readonly exemplo: string;
  readonly nomeDaSenha: string;
}

export const TEXTOS_DO_PROVEDOR: { readonly [P in ProvedorEmail]: TextosDoProvedor } = {
  profills: {
    nome: "E-mail da Profills",
    resumo: "Só o endereço e a senha.",
    rotuloSugerido: "Profills",
    exemplo: "nome@profills.com.br",
    nomeDaSenha: "Senha do e-mail",
  },
  gmail: {
    nome: "Gmail",
    resumo: "Usa uma senha de app do Google.",
    rotuloSugerido: "Pessoal",
    exemplo: "nome@gmail.com",
    nomeDaSenha: "Senha de app",
  },
  outro: {
    nome: "Outro",
    resumo: "Você informa o servidor de entrada.",
    rotuloSugerido: "",
    exemplo: "nome@empresa.com.br",
    nomeDaSenha: "Senha do e-mail",
  },
};

/** O problema da conta como a gaveta o mostra: a frase, o próximo passo e, quando há, o link de ajuda do provedor. */
export function problemaDaConta(conta: VisaoDaContaEmail): { readonly mensagem: string; readonly acao: string; readonly ajuda: string | null } | null {
  if (conta.estado.fase !== "atencao") return null;
  const { codigo } = conta.estado.problema;
  if (codigo === "email_gmail_senha_de_app") {
    // O texto da tabela traz o endereço por extenso para o agente; no painel, o endereço vira o botão.
    return { mensagem: PROBLEMAS[codigo].mensagem, acao: "Ative a verificação em duas etapas, crie uma senha de app no Google e conecte de novo com ela.", ajuda: PREDEFINICOES_DE_EMAIL.gmail?.ajuda ?? null };
  }
  return { mensagem: PROBLEMAS[codigo].mensagem, acao: PROBLEMAS[codigo].acao, ajuda: null };
}

/**
 * O envio da conta nova. A resposta do POST só diz que o teste começou: o resultado chega pelo SSE,
 * no estado da conta. `antes` é o estado da conta (em JSON) no momento do envio, para a gaveta não
 * tomar o problema da tentativa anterior pelo resultado da nova.
 */
export type EnvioDaConta =
  | { readonly fase: "editando"; readonly erro: ErroOperacao | null }
  | { readonly fase: "enviando"; readonly antes: string | null }
  | { readonly fase: "acompanhando"; readonly antes: string | null };

export type EventoDoEnvio =
  | { readonly tipo: "enviar"; readonly conta: VisaoDaContaEmail | undefined }
  | { readonly tipo: "aceito" }
  | { readonly tipo: "recusado"; readonly erro: ErroOperacao };

export const ENVIO_INICIAL: EnvioDaConta = { fase: "editando", erro: null };

export function reduzirEnvio(atual: EnvioDaConta, evento: EventoDoEnvio): EnvioDaConta {
  switch (evento.tipo) {
    case "enviar":
      return atual.fase === "enviando" ? atual : { fase: "enviando", antes: evento.conta === undefined ? null : JSON.stringify(evento.conta.estado) };
    case "aceito":
      return atual.fase === "enviando" ? { fase: "acompanhando", antes: atual.antes } : atual;
    case "recusado":
      return { fase: "editando", erro: evento.erro };
  }
}

/** O que o formulário mostra, juntando o envio com o estado da conta que chegou pelo SSE. */
export type VistaDoEnvio =
  | { readonly tipo: "editando"; readonly erro: ErroOperacao | null; readonly problema: VisaoDaContaEmail | null }
  | { readonly tipo: "enviando" }
  | { readonly tipo: "testando"; readonly expiraEm: Instante | null }
  | { readonly tipo: "conectou" };

export function vistaDoEnvio(envio: EnvioDaConta, conta: VisaoDaContaEmail | undefined): VistaDoEnvio {
  const comProblema = conta?.estado.fase === "atencao" ? conta : null;
  switch (envio.fase) {
    case "editando":
      return { tipo: "editando", erro: envio.erro, problema: comProblema };
    case "enviando":
      return { tipo: "enviando" };
    case "acompanhando": {
      if (conta === undefined || JSON.stringify(conta.estado) === envio.antes) return { tipo: "testando", expiraEm: null };
      switch (conta.estado.fase) {
        case "testando":
          return { tipo: "testando", expiraEm: conta.estado.expiraEm };
        case "conectado":
          return { tipo: "conectou" };
        case "atencao":
        case "desconectado":
          return { tipo: "editando", erro: null, problema: comProblema };
      }
    }
  }
}

/** O botão Conectar do formulário só anda quando nada está em curso. */
export function podeEnviar(vista: VistaDoEnvio): boolean {
  return vista.tipo === "editando";
}
