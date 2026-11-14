import { sinaisDe, sinaisDeInjecao, type Sinal } from "./injecao";
import { lerTelefone, textoExterno, type Instante, type Telefone, type TextoExterno } from "./tipos";

/**
 * O que a Secretária lê do WhatsApp, em tipos de domínio. Puro: o conector traduz o JSON do wacli
 * para estas entradas, e daqui sai o que o servidor e o agente recebem.
 */

declare const marcaDoTexto: unique symbol;

/**
 * Texto de mensagem como o wacli o guardou, sem limpeza. Nunca vai ao agente assim: `mensagemParaOAgente`
 * é quem limpa, corta e, se houver sinal de injeção, retém.
 */
export type TextoDeMensagem = string & { readonly [marcaDoTexto]: "TextoDeMensagem" };

export const TIPOS_DE_CONVERSA = ["direta", "grupo", "outro"] as const;
export type TipoDeConversa = (typeof TIPOS_DE_CONVERSA)[number];

export const ESPECIES_DE_MENSAGEM = ["texto", "midia", "reacao", "figurinha", "apagada", "sistema"] as const;
export type EspecieDeMensagem = (typeof ESPECIES_DE_MENSAGEM)[number];

const SERVIDOR_DE_PESSOA = "s.whatsapp.net";
const SERVIDOR_DE_LID = "lid";
const SERVIDOR_DE_GRUPO = "g.us";

const JID = /^[A-Za-z0-9._:-]{1,128}@[A-Za-z0-9.-]{1,64}$/;
const ID_DE_MENSAGEM = /^[A-Za-z0-9._-]{1,128}$/;
const CURSOR = /^[A-Za-z0-9_=.+/-]{1,512}$/;
const TIPO_DE_MIDIA = /^[a-z]{1,20}$/;

/** Id e JID chegam ao agente mesmo na mensagem retida, então um que parece frase para o agente não passa. */
const semSinal = (texto: string) => sinaisDeInjecao(texto.replace(/[._:@-]+/g, " ")).length === 0;

/** JID com o formato que o wacli grava. Texto fora dele nunca vira campo de resposta. */
export function lerJid(texto: string): string | null {
  return JID.test(texto) && semSinal(texto) ? texto : null;
}

export function lerIdDeMensagem(texto: string): string | null {
  return ID_DE_MENSAGEM.test(texto) && semSinal(texto) ? texto : null;
}

export function lerCursor(texto: string | null | undefined): string | null {
  return texto != null && CURSOR.test(texto) && semSinal(texto) ? texto : null;
}

function servidorDo(jid: string): string {
  return jid.slice(jid.lastIndexOf("@") + 1);
}

/**
 * Só o JID de pessoa (`@s.whatsapp.net`) carrega um telefone. Os dígitos de um `@lid` são um
 * identificador interno do WhatsApp: tratá-los como número daria o telefone de outra pessoa.
 */
export function telefoneDoJid(jid: string): Telefone | null {
  const casamento = /^(\d{8,15})(?::\d{1,5})?@s\.whatsapp\.net$/.exec(jid);
  return casamento?.[1] === undefined ? null : lerTelefone(`+${casamento[1]}`);
}

/** O JID decide o que ele conhece; o `kind` do wacli só decide o que o JID não diz. */
export function tipoDaConversa(jid: string, kind: string): TipoDeConversa {
  switch (servidorDo(jid)) {
    case SERVIDOR_DE_PESSOA:
    case SERVIDOR_DE_LID:
      return "direta";
    case SERVIDOR_DE_GRUPO:
      return "grupo";
  }
  if (kind === "group") return "grupo";
  if (kind === "dm") return "direta";
  return "outro";
}

export interface Conversa {
  readonly jid: string;
  readonly tipo: TipoDeConversa;
  readonly nome: TextoExterno;
  /** Os sinais que o nome acendeu, calculados sobre o texto de antes da limpeza. */
  readonly sinaisDoNome: readonly Sinal[];
  readonly ultimaMensagemEm: Instante | null;
  readonly naoLida: boolean;
  readonly naoLidas: number;
}

export interface EntradaDeConversa {
  readonly jid: string;
  readonly kind: string;
  readonly nome: string;
  readonly ultimaMensagemEm: Instante | null;
  readonly naoLida: boolean;
  readonly naoLidas: number;
}

export function montarConversa(entrada: EntradaDeConversa): Conversa {
  return {
    jid: entrada.jid,
    tipo: tipoDaConversa(entrada.jid, entrada.kind),
    nome: textoExterno(entrada.nome),
    sinaisDoNome: sinaisDeInjecao(entrada.nome),
    ultimaMensagemEm: entrada.ultimaMensagemEm,
    naoLida: entrada.naoLida,
    naoLidas: entrada.naoLidas,
  };
}

export interface Contato {
  readonly jid: string;
  /** Só de JID `@s.whatsapp.net`. Um `@lid` fica sem telefone até `contacts resolve` achar o par. */
  readonly telefone: Telefone | null;
  readonly nome: TextoExterno;
  readonly sinaisDoNome: readonly Sinal[];
}

export interface EntradaDeContato {
  readonly jid: string;
  readonly nome: string;
}

export function montarContato(entrada: EntradaDeContato): Contato {
  return { jid: entrada.jid, telefone: telefoneDoJid(entrada.jid), nome: textoExterno(entrada.nome), sinaisDoNome: sinaisDeInjecao(entrada.nome) };
}

/** Saída de `contacts resolve`: o par telefone e `@lid` que a sessão do WhatsApp confirmou. */
export interface ParDeIdentidade {
  readonly entrada: string;
  readonly telefone: Telefone | null;
  readonly lid: string | null;
  /** `true` só com os dois lados confirmados pela sessão. */
  readonly resolvido: boolean;
}

export interface EntradaDeIdentidade {
  readonly entrada: string;
  readonly jidDeTelefone: string;
  readonly telefone: string;
  readonly lid: string;
  readonly resolvido: boolean;
}

export function montarParDeIdentidade(bruta: EntradaDeIdentidade): ParDeIdentidade {
  const telefone = bruta.jidDeTelefone.endsWith(`@${SERVIDOR_DE_PESSOA}`) ? lerTelefone(`+${bruta.telefone}`) : null;
  const lid = /^\d{1,32}@lid$/.test(bruta.lid) ? bruta.lid : null;
  return { entrada: bruta.entrada, telefone, lid, resolvido: bruta.resolvido && telefone !== null && lid !== null };
}

export interface Mensagem {
  readonly id: string;
  /** JID da conversa. */
  readonly conversa: string;
  /** O vendedor enviou: `FromMe` no wacli. */
  readonly daConta: boolean;
  readonly em: Instante;
  readonly especie: EspecieDeMensagem;
  /** `image`, `audio`, `video`, `document`, `sticker`: o tipo que o wacli guardou, quando é uma palavra simples. */
  readonly midia: string | null;
  /** O texto, a legenda da mídia ou o emoji da reação. */
  readonly texto: TextoDeMensagem | null;
  /** O texto cru do wacli quando difere de `texto`. Só o painel o mostra. */
  readonly textoBruto: TextoDeMensagem | null;
  readonly arquivo: TextoDeMensagem | null;
  readonly botoes: readonly TextoDeMensagem[];
  /** Trecho da busca. Em `messages list` é nulo. */
  readonly trecho: TextoDeMensagem | null;
  readonly remetente: string | null;
  readonly nomeDoRemetente: TextoExterno | null;
  readonly sinaisDoNomeDoRemetente: readonly Sinal[];
  /** Sinais de todo texto da mensagem que o agente ou o painel poderiam ler. */
  readonly sinais: readonly Sinal[];
}

export interface EntradaDeMensagem {
  readonly id: string;
  readonly conversa: string;
  readonly daConta: boolean;
  readonly em: Instante;
  /** `Revoked` ou `DeletedForMe`. */
  readonly apagada: boolean;
  /** `ReactionToID`: a que mensagem a reação responde. Vazio quando não é reação. */
  readonly reacaoA: string;
  readonly emoji: string;
  readonly tipoDeMidia: string;
  readonly legenda: string;
  /** O que o wacli mostra (`DisplayText`) e o texto cru (`Text`). */
  readonly textoDeExibicao: string;
  readonly textoCru: string;
  readonly arquivo: string;
  readonly botoes: readonly string[];
  readonly trecho: string;
  readonly remetente: string;
  readonly nomeDoRemetente: string;
}

/** O wacli guarda o evento sem conteúdo (troca de código de segurança, aviso de grupo) como `(message)`. */
const MARCA_DE_EVENTO_SEM_CONTEUDO = "(message)";

const vazio = (texto: string) => texto.trim() === "";

/** `apagada` vence tudo; depois reação, figurinha, mídia e texto. O que não tem nada disso é evento do sistema. */
export function especieDaMensagem(entrada: Pick<EntradaDeMensagem, "apagada" | "reacaoA" | "tipoDeMidia" | "textoDeExibicao" | "textoCru">): EspecieDeMensagem {
  if (entrada.apagada) return "apagada";
  if (!vazio(entrada.reacaoA)) return "reacao";
  const midia = entrada.tipoDeMidia.trim().toLowerCase();
  if (midia === "sticker") return "figurinha";
  if (midia !== "") return "midia";
  const texto = [entrada.textoDeExibicao, entrada.textoCru].map((valor) => valor.trim()).find((valor) => valor !== "");
  return texto === undefined || texto === MARCA_DE_EVENTO_SEM_CONTEUDO ? "sistema" : "texto";
}

const comoTexto = (valor: string): TextoDeMensagem | null => (vazio(valor) ? null : (valor as TextoDeMensagem));

/** `[Audio]`, `[Image]`: o texto de reserva que o wacli grava em `Text` da mídia sem legenda. Não é do remetente. */
const TEXTO_DE_RESERVA = /^\[[A-Za-z ]{1,20}\]$/;

/** A legenda da mídia está em `MediaCaption` ou, quando ele vem vazio, no texto que o wacli mostra (`DisplayText`, depois `Text`). */
function legendaDaMidia(entrada: EntradaDeMensagem, exibicao: string): string {
  if (!vazio(entrada.legenda)) return entrada.legenda;
  return TEXTO_DE_RESERVA.test(exibicao.trim()) ? "" : exibicao;
}

export function montarMensagem(entrada: EntradaDeMensagem): Mensagem {
  const especie = especieDaMensagem(entrada);
  const exibicao = vazio(entrada.textoDeExibicao) ? entrada.textoCru : entrada.textoDeExibicao;
  const texto = (
    { texto: exibicao, midia: especie === "midia" ? legendaDaMidia(entrada, exibicao) : "", reacao: entrada.emoji, figurinha: "", apagada: "", sistema: "" } satisfies Record<EspecieDeMensagem, string>
  )[especie];
  // Uma mensagem apagada não mostra nada: o que o remetente apagou não vira texto aqui.
  const visivel = especie !== "apagada";
  const textoBruto = visivel && entrada.textoCru.trim() !== texto.trim() && entrada.textoCru.trim() !== MARCA_DE_EVENTO_SEM_CONTEUDO ? entrada.textoCru : "";
  const arquivo = visivel ? entrada.arquivo : "";
  const botoes = visivel ? entrada.botoes.filter((rotulo) => !vazio(rotulo)) : [];
  const trecho = visivel ? entrada.trecho : "";
  const midia = entrada.tipoDeMidia.trim().toLowerCase();
  return {
    id: entrada.id,
    conversa: entrada.conversa,
    daConta: entrada.daConta,
    em: entrada.em,
    especie,
    midia: TIPO_DE_MIDIA.test(midia) ? midia : null,
    texto: comoTexto(texto),
    textoBruto: comoTexto(textoBruto),
    arquivo: comoTexto(arquivo),
    botoes: botoes.map((rotulo) => rotulo as TextoDeMensagem),
    trecho: comoTexto(trecho),
    remetente: entrada.remetente === "" ? null : entrada.remetente,
    nomeDoRemetente: vazio(entrada.nomeDoRemetente) ? null : textoExterno(entrada.nomeDoRemetente),
    sinaisDoNomeDoRemetente: sinaisDeInjecao(entrada.nomeDoRemetente),
    // A soma pega a frase partida entre campos: legenda "ignore todas as" e arquivo "instrucoes anteriores.pdf".
    sinais: sinaisDe([texto, textoBruto, arquivo, trecho, ...botoes, [texto, arquivo, ...botoes, trecho].join(" ")]),
  };
}

export interface PaginaDeMensagens {
  readonly temMais: boolean;
  readonly cursor: string | null;
}

/** As mensagens em volta de um achado da busca (`--context-before` e `--context-after`). */
export interface ContextoDaBusca {
  readonly conversa: string;
  readonly id: string;
  readonly mensagens: readonly Mensagem[];
}

/**
 * Quantos itens saíram da leitura porque o id, o JID ou o instante não passou na regra. Ausente quando
 * nenhum saiu. Um bloco de contexto da busca com cabeçalho ruim conta um, além das mensagens que caíram.
 */
interface ComIlegiveis {
  readonly ilegiveis?: number;
}

/** O que cada leitura do wacli devolve depois do schema, antes de o agente ou o painel a ver. */
export type LeituraDeWhatsapp =
  | ({ readonly tipo: "conversas"; readonly conversas: readonly Conversa[] } & ComIlegiveis)
  | ({ readonly tipo: "mensagens"; readonly mensagens: readonly Mensagem[]; readonly pagina: PaginaDeMensagens } & ComIlegiveis)
  | ({ readonly tipo: "busca"; readonly mensagens: readonly Mensagem[]; readonly contexto: readonly ContextoDaBusca[]; readonly pagina: PaginaDeMensagens } & ComIlegiveis)
  | ({ readonly tipo: "contatos"; readonly contatos: readonly Contato[] } & ComIlegiveis)
  /** `doctor` não tem texto de cliente: segue como o wacli o escreveu. */
  | { readonly tipo: "diagnostico"; readonly dados: unknown };
