import type { FalhaDoImap } from "./email";
import { sinaisDeInjecao, type Sinal } from "./injecao";
import { instante } from "./maquina";
import { lerEnderecoEmail, textoExterno, type EnderecoEmail, type IdContaEmail, type Instante, type TextoExterno } from "./tipos";

/**
 * Cabeçalho de e-mail: o que a Secretária guarda de cada mensagem, e as regras puras que o montam
 * a partir do que o conector IMAP entrega. Nada aqui guarda corpo, trecho ou anexo.
 */

export const PASTAS_DE_EMAIL = ["entrada", "enviados"] as const;
export type PastaDeEmail = (typeof PASTAS_DE_EMAIL)[number];

export const LIMITE_DE_DESTINATARIOS = 50;

/** Passa disto o texto de assunto ou de nome nem entra na conta de sinais: servidor nenhum manda tanto. */
const TAMANHO_PARA_OS_SINAIS = 5000;

const TAMANHO_MAXIMO_DA_RAIZ = 255;

export interface EnderecoCru {
  readonly nome?: string | null | undefined;
  readonly endereco?: string | null | undefined;
}

/** O que o conector entrega de cada mensagem. Os campos de texto vêm como o servidor os mandou. */
export interface CabecalhoCru {
  readonly uid: number;
  readonly pasta: PastaDeEmail;
  readonly dataInterna: Date | string | null;
  readonly dataDoEnvelope: Date | string | null;
  readonly assunto: string | null;
  readonly messageId: string | null;
  readonly emRespostaA: string | null;
  /** O cabeçalho `References` inteiro, com os ids entre `<` e `>`. */
  readonly referencias: string | null;
  readonly de: readonly EnderecoCru[];
  readonly para: readonly EnderecoCru[];
  readonly cc: readonly EnderecoCru[];
  readonly threadId: string | null;
  readonly listUnsubscribe: string | null;
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
}

/** O que a tabela `email_cabecalho` guarda, sem a conta. */
export interface CabecalhoDeEmail {
  readonly pasta: PastaDeEmail;
  readonly uid: number;
  /** Sem os sinais de menor e maior. */
  readonly messageId: string | null;
  readonly conversa: string;
  readonly remetente: EnderecoEmail;
  /** `null` sem nome ou com sinal de injeção. */
  readonly remetenteNome: TextoExterno | null;
  readonly destinatarios: readonly EnderecoEmail[];
  readonly instante: Instante;
  /** `null` sem assunto ou com sinal de injeção. */
  readonly assunto: TextoExterno | null;
  readonly daConta: boolean;
  readonly automatico: boolean;
  readonly sinaisDoAssunto: readonly Sinal[];
  readonly sinaisDoNome: readonly Sinal[];
}

/** O cabeçalho guardado: o de domínio, mais a conta e o `UIDVALIDITY` da pasta que o id do e-mail leva. */
export interface CabecalhoGuardado extends CabecalhoDeEmail {
  readonly contaId: IdContaEmail;
  readonly uidValidity: string;
}

/* ---------- cabeçalhos de texto ---------- */

/** Desdobra as linhas e devolve cada cabeçalho pelo nome em minúsculas. Repetido fica com o primeiro. Vazio não conta. */
export function lerCabecalhosDeTexto(texto: string): ReadonlyMap<string, string> {
  const desdobrado = texto.replace(/\r?\n[ \t]+/g, " ");
  const achados = new Map<string, string>();
  for (const linha of desdobrado.split(/\r?\n/)) {
    const separador = linha.indexOf(":");
    if (separador < 1) continue;
    const nome = linha.slice(0, separador).trim().toLowerCase();
    const valor = linha.slice(separador + 1).trim();
    if (valor !== "" && !achados.has(nome)) achados.set(nome, valor);
  }
  return achados;
}

/* ---------- e-mail automático ---------- */

export const MOTIVOS_DE_AUTOMATICO = ["lista", "auto_submitted", "precedencia", "sem_resposta"] as const;
export type MotivoDeAutomatico = (typeof MOTIVOS_DE_AUTOMATICO)[number];

export interface EntradaDoAutomatico {
  readonly remetente: EnderecoEmail;
  readonly listUnsubscribe: string | null;
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
}

export interface RegraDeAutomatico {
  /** Uma frase para quem lê a tabela na documentação. */
  readonly descricao: string;
  confere(entrada: EntradaDoAutomatico): boolean;
}

const normalizado = (texto: string | null) => (texto ?? "").trim().toLowerCase();

/** Tabela única: cada motivo de um e-mail ser automático e a regra dele. `docs/arquitetura.md` descreve a mesma lista. */
export const REGRAS_DE_AUTOMATICO: { readonly [M in MotivoDeAutomatico]: RegraDeAutomatico } = {
  lista: {
    descricao: "Tem o cabeçalho `List-Unsubscribe`.",
    confere: (entrada) => normalizado(entrada.listUnsubscribe) !== "",
  },
  auto_submitted: {
    descricao: "`Auto-Submitted` presente e diferente de `no`.",
    confere: (entrada) => {
      const valor = normalizado(entrada.autoSubmitted);
      return valor !== "" && valor !== "no";
    },
  },
  precedencia: {
    descricao: "`Precedence` igual a `bulk`, `list` ou `junk`.",
    confere: (entrada) => ["bulk", "list", "junk"].includes(normalizado(entrada.precedence)),
  },
  sem_resposta: {
    descricao: "A parte local do remetente é `no-reply`, `noreply` ou `mailer-daemon`.",
    confere: (entrada) => {
      const local = entrada.remetente.slice(0, entrada.remetente.lastIndexOf("@")).trim().toLowerCase();
      return ["no-reply", "noreply", "mailer-daemon"].includes(local);
    },
  },
};

/** Os motivos que acendem, na ordem de `MOTIVOS_DE_AUTOMATICO`. */
export function motivosDeAutomatico(entrada: EntradaDoAutomatico): readonly MotivoDeAutomatico[] {
  return MOTIVOS_DE_AUTOMATICO.filter((motivo) => REGRAS_DE_AUTOMATICO[motivo].confere(entrada));
}

export const ehAutomatico = (entrada: EntradaDoAutomatico): boolean => motivosDeAutomatico(entrada).length > 0;

/* ---------- chave da conversa ---------- */

/** Os ids de uma lista de `Message-ID`, sem `<` e `>`, na ordem em que aparecem. Sem sinal de menor e maior, cada palavra é um id. */
export function idsDeMensagem(texto: string | null): readonly string[] {
  if (texto === null) return [];
  const entreSinais = [...texto.matchAll(/<([^<>\s]+)>/g)].map((achado) => achado[1] ?? "");
  const ids = entreSinais.length > 0 ? entreSinais : texto.split(/\s+/).map((palavra) => palavra.replace(/[<>]/g, ""));
  return ids.filter((id) => id !== "" && id.length <= TAMANHO_MAXIMO_DA_RAIZ && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(id));
}

/** FNV-1a de 64 bits. Não é segurança: é só um nome curto e estável para o que não pode ir ao agente como veio. */
export function resumo(texto: string): string {
  const MASCARA = 0xffffffffffffffffn;
  let valor = 0xcbf29ce484222325n;
  for (let i = 0; i < texto.length; i++) valor = ((valor ^ BigInt(texto.charCodeAt(i))) * 0x100000001b3n) & MASCARA;
  return valor.toString(16).padStart(16, "0");
}

const THREAD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface EntradaDaConversa {
  readonly threadId: string | null;
  readonly referencias: string | null;
  readonly emRespostaA: string | null;
  readonly messageId: string | null;
  readonly pasta: PastaDeEmail;
  readonly uid: number;
}

/**
 * A conversa a que a mensagem pertence. Com `threadId` do servidor, `t:<threadId>`. Sem ele, a raiz
 * é o primeiro id de `References`, senão o `In-Reply-To`, senão o `Message-ID` da própria mensagem,
 * e a chave é `m:<raiz>`: a resposta e a original caem na mesma. Sem nada disso, `u:<pasta>:<uid>`.
 * O id é texto que quem escreveu o e-mail escolhe e a chave chega ao agente: raiz que acende sinal
 * de injeção vira `h:<resumo>`, que continua igual de uma mensagem para a outra.
 */
export function chaveDaConversa(entrada: EntradaDaConversa): string {
  if (entrada.threadId !== null && THREAD_ID.test(entrada.threadId)) return `t:${entrada.threadId}`;
  const raiz = idsDeMensagem(entrada.referencias)[0] ?? idsDeMensagem(entrada.emRespostaA)[0] ?? idsDeMensagem(entrada.messageId)[0];
  if (raiz === undefined) return `u:${entrada.pasta}:${entrada.uid}`;
  return sinaisDeInjecao(raiz).length > 0 ? `h:${resumo(raiz)}` : `m:${raiz}`;
}

/* ---------- montar o cabeçalho ---------- */

function emInstante(data: Date | string | null): Instante | null {
  if (data === null) return null;
  const lida = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(lida.getTime()) || lida.getUTCFullYear() < 1970 || lida.getUTCFullYear() > 9999) return null;
  return instante(lida);
}

function enderecoDe(lista: readonly EnderecoCru[]): EnderecoEmail | null {
  const endereco = lerEnderecoEmail((lista[0]?.endereco ?? "").trim());
  return endereco === null ? null : (endereco.toLowerCase() as EnderecoEmail);
}

function destinatariosDe(listas: readonly (readonly EnderecoCru[])[]): readonly EnderecoEmail[] {
  const vistos = new Set<EnderecoEmail>();
  for (const lista of listas) {
    for (const item of lista) {
      const lido = lerEnderecoEmail((item.endereco ?? "").trim());
      if (lido !== null) vistos.add(lido.toLowerCase() as EnderecoEmail);
      if (vistos.size >= LIMITE_DE_DESTINATARIOS) return [...vistos];
    }
  }
  return [...vistos];
}

/** Os sinais saem do texto cru. Com sinal, o campo fica `null`: texto suspeito não vai ao banco. */
export function sanearComSinais(cru: string | null | undefined): { readonly texto: TextoExterno | null; readonly sinais: readonly Sinal[] } {
  const bruto = cru ?? "";
  const sinais = sinaisDeInjecao(bruto.slice(0, TAMANHO_PARA_OS_SINAIS));
  if (sinais.length > 0) return { texto: null, sinais };
  const limpo = textoExterno(bruto);
  return { texto: limpo === "" ? null : limpo, sinais };
}

/**
 * O endereço do remetente é texto que quem escreve escolhe: com sinal de injeção, a conversa fica em
 * quarentena e o agente recebe `null` no lugar dele. O painel e o vínculo seguem com o endereço.
 */
export function enderecoParaOAgente(endereco: string): string | null {
  return sinaisDeInjecao(endereco).length > 0 ? null : endereco;
}

/**
 * O cabeçalho que a tabela guarda, ou `null` quando a mensagem não tem remetente válido ou
 * data: ela não entra, e quem chama a conta como ilegível.
 */
export function montarCabecalho(cru: CabecalhoCru, enderecoDaConta: EnderecoEmail): CabecalhoDeEmail | null {
  const remetente = enderecoDe(cru.de);
  const quando = emInstante(cru.dataInterna) ?? emInstante(cru.dataDoEnvelope);
  if (remetente === null || quando === null) return null;
  const assunto = sanearComSinais(cru.assunto);
  const nome = sanearComSinais(cru.de[0]?.nome);
  return {
    pasta: cru.pasta,
    uid: cru.uid,
    messageId: idsDeMensagem(cru.messageId)[0] ?? null,
    conversa: chaveDaConversa(cru),
    remetente,
    remetenteNome: nome.texto,
    destinatarios: destinatariosDe([cru.para, cru.cc]),
    instante: quando,
    assunto: assunto.texto,
    daConta: cru.pasta === "enviados" || remetente === enderecoDaConta.toLowerCase(),
    automatico: ehAutomatico({ remetente, listUnsubscribe: cru.listUnsubscribe, autoSubmitted: cru.autoSubmitted, precedence: cru.precedence }),
    sinaisDoAssunto: assunto.sinais,
    sinaisDoNome: nome.sinais,
  };
}

/* ---------- id do e-mail ---------- */

export interface IdDoEmail {
  readonly pasta: PastaDeEmail;
  readonly uidValidity: string;
  readonly uid: number;
}

const UID_MAXIMO = 4_294_967_295;

/** `<pasta>-<uidValidity>-<uid>`. O `UIDVALIDITY` no id impede que um id antigo aponte para outra mensagem depois de uma recoleta. */
export function idDoEmail(id: IdDoEmail): string {
  return `${id.pasta}-${id.uidValidity}-${id.uid}`;
}

export function lerIdDoEmail(texto: string): IdDoEmail | null {
  const achado = /^(entrada|enviados)-([1-9][0-9]{0,19})-([1-9][0-9]{0,9})$/.exec(texto);
  if (achado === null) return null;
  const uid = Number(achado[3]);
  return uid <= UID_MAXIMO ? { pasta: achado[1] as PastaDeEmail, uidValidity: achado[2] ?? "", uid } : null;
}

/* ---------- a coleta ---------- */

/** O que o banco já conhece de uma pasta de uma conta. Sem cursor, `uidValidity` é `null` e não há uid. */
export interface ConhecidoDaPasta {
  readonly caminho: string | null;
  readonly uidValidity: string | null;
  readonly uids: ReadonlySet<number>;
}

export type ConhecidoDaConta = { readonly [P in PastaDeEmail]: ConhecidoDaPasta };

/** O que a coleta trouxe de uma pasta. `cabecalhos` são só os que o banco ainda não tinha. */
export interface ColetaDaPasta {
  readonly pasta: PastaDeEmail;
  /** O caminho da pasta no servidor, que a leitura do corpo usa. */
  readonly caminho: string;
  readonly uidValidity: string;
  readonly cabecalhos: readonly CabecalhoDeEmail[];
  /** Faltou além do teto da rodada: a seguinte continua. */
  readonly cortado: boolean;
  /** Mensagens sem remetente válido ou sem data, que não entraram. */
  readonly ilegiveis: number;
}

export interface ColetaDaConta {
  readonly pastas: readonly ColetaDaPasta[];
  /** O servidor não tem pasta com `specialUse` `\Sent`: a conta lê só a entrada. */
  readonly semEnviados: boolean;
}

/** O instante a partir do qual o e-mail está dentro da janela da conta. */
export function corteDaJanela(agora: Instante, janelaDias: number): Instante {
  return instante(new Date(new Date(agora).getTime() - janelaDias * 86_400_000));
}

/** A leitura falhou no servidor. `motivo` é o que `problemaDaFalha` traduz em problema da conta. */
export interface FalhaDeLeitura {
  readonly ok: false;
  readonly motivo: FalhaDoImap;
  readonly detalhe: TextoExterno;
}

export type ResultadoDaColeta = { readonly ok: true; readonly coleta: ColetaDaConta } | FalhaDeLeitura;
