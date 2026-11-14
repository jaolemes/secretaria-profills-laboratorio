import { diaEm, diasUteisEntre, type Dia } from "./dia";
import { FONTES_DO_CRM } from "./crm-leitura";
import type { Sinal } from "./injecao";
import type { Instante, Telefone, TextoExterno } from "./tipos";
import type { Mensagem } from "./whatsapp-leitura";

/**
 * Quem está esperando quem numa conversa direta do WhatsApp. Puro: a sincronização lê as últimas
 * mensagens, calcula a situação aqui e guarda só o resultado. O texto da mensagem não sai desta função.
 */

/** Tudo o que a sincronização lê: as fontes do CRM, as conversas do WhatsApp e os cabeçalhos de e-mail. */
export const FONTES_DA_SINCRONIZACAO = [...FONTES_DO_CRM, "conversas", "email"] as const;
export type FonteDaSincronizacao = (typeof FONTES_DA_SINCRONIZACAO)[number];

/** Conversa sem mensagem há mais que isto não entra: o vendedor já a deu por perdida. */
export const CONVERSA_ATIVA_DIAS = 30;
/** Quantas mensagens a sincronização lê de cada conversa. */
export const MENSAGENS_POR_CONVERSA = 20;
export const DIAS_UTEIS_PARA_ESPERAR = 3;
export const ESPERA_MAXIMA_DIAS = 30;
export const TAMANHO_DA_CONFIRMACAO_CURTA = 25;

export type SituacaoDaConversa =
  | {
      readonly tipo: "responder";
      /** A primeira mensagem do cliente depois da última da conta. */
      readonly desde: Instante;
      /** Mensagens de conteúdo do cliente desde então, dentro das lidas. */
      readonly novas: number;
      readonly em_quarentena: boolean;
      /** Ids das mensagens do cliente desde a última da conta com sinal de injeção. */
      readonly mensagens_em_quarentena: readonly string[];
      /** A união dos sinais dessas mensagens. */
      readonly sinais: readonly Sinal[];
      /** Alguma das mensagens lidas não pôde ser lida: pode ser o que o cliente perguntou. */
      readonly tem_ilegiveis: boolean;
      /** A leitura veio cheia e sem mensagem da conta: há mensagens antes das lidas, e `novas` é o mínimo. */
      readonly mais_que_o_lido: boolean;
    }
  | { readonly tipo: "esperando"; readonly desde: Instante; readonly dias_uteis: number }
  | { readonly tipo: "nada" };

type Responder = Extract<SituacaoDaConversa, { readonly tipo: "responder" }>;

/** Uma conversa que a sincronização leu, como o cache a guarda. */
export interface ConversaLida {
  /** O JID da conversa no wacli. */
  readonly conversa: string;
  readonly telefone: Telefone;
  /** O nome da conversa no WhatsApp, `null` quando vazio ou com sinal de injeção. Não é texto de mensagem. */
  readonly nome: TextoExterno | null;
  /** O `ultimaMensagemEm` do `chats list` quando as mensagens foram lidas. Igual na rodada seguinte, com o mesmo `naoLidas`, a conversa não é lida de novo. */
  readonly ultimaMensagemEm: Instante;
  /**
   * O `unread_count` do `chats list` quando as mensagens foram lidas. O instante do wacli é em segundos, e a
   * mensagem nova no mesmo segundo só muda a contagem. Ausente na leitura gravada antes deste campo: relê.
   */
  readonly naoLidas?: number;
  /** A última mensagem de conteúdo é da conta, neste instante. É o que leva `nada` a `esperando` com o tempo, sem reler. */
  readonly contaFalouEm: Instante | null;
  /** `nada` também fica guardada: é o que evita reler a conversa que não mudou. */
  readonly situacao: SituacaoDaConversa;
}

const CONFIRMACOES_CURTAS: ReadonlySet<string> = new Set([
  "ok",
  "okay",
  "blz",
  "beleza",
  "obrigado",
  "obrigada",
  "obg",
  "valeu",
  "vlw",
  "combinado",
  "perfeito",
  "certo",
  "ta bom",
  "show",
  "joia",
  "fechado",
  "entendi",
  "sim",
  "ok obrigado",
  "ok obrigada",
  "muito obrigado",
  "muito obrigada",
  "👍",
  "🙏",
  "👌",
]);

/** Caixa, acento, pontuação e emoji repetido ou com tom de pele não distinguem uma confirmação de outra. */
function normalizarConfirmacao(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/(\p{Extended_Pictographic})\1+/gu, "$1")
    .replace(/[\p{P}\p{Z}\p{Cc}\p{Cf}]+/gu, " ")
    .trim();
}

/** "ok, e o prazo?" não é: depois de normalizada, a mensagem inteira tem de estar na tabela. */
export function ehConfirmacaoCurta(mensagem: Pick<Mensagem, "especie" | "texto">): boolean {
  if (mensagem.especie !== "texto" || mensagem.texto === null) return false;
  if ([...mensagem.texto].length > TAMANHO_DA_CONFIRMACAO_CURTA) return false;
  return CONFIRMACOES_CURTAS.has(normalizarConfirmacao(mensagem.texto));
}

function ehConteudo(mensagem: Mensagem): boolean {
  return mensagem.especie === "texto" || mensagem.especie === "midia";
}

function diasCorridos(de: Dia, ate: Dia): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

/** As mensagens lidas, recortadas pelo que decide a situação. */
interface Recorte {
  /** A leitura trouxe o teto pedido: pode haver mensagens antes das lidas. */
  readonly paginaCheia: boolean;
  /** Só texto e mídia, da mais nova para a mais antiga. */
  readonly conteudo: readonly Mensagem[];
  /** As de conteúdo do cliente depois da última de conteúdo da conta. */
  readonly desdeAConta: readonly Mensagem[];
  /** Todas as do cliente depois da última de conteúdo da conta, de conteúdo ou não. */
  readonly doClienteDesdeAConta: readonly Mensagem[];
}

/** `mensagens` vem em qualquer ordem; empate de instante respeita a ordem de entrada, que no wacli é da mais nova para a mais antiga. */
function recortar(mensagens: readonly Mensagem[], paginaCheia: boolean): Recorte {
  const maisNovasPrimeiro = mensagens
    .map((mensagem, posicao) => ({ mensagem, posicao }))
    .sort((a, b) => Date.parse(b.mensagem.em) - Date.parse(a.mensagem.em) || a.posicao - b.posicao)
    .map(({ mensagem }) => mensagem);
  const conteudo = maisNovasPrimeiro.filter(ehConteudo);
  const daConta = conteudo.findIndex((mensagem) => mensagem.daConta);
  const posicaoDaConta = maisNovasPrimeiro.findIndex((mensagem) => ehConteudo(mensagem) && mensagem.daConta);
  return {
    paginaCheia,
    conteudo,
    desdeAConta: daConta === -1 ? conteudo : conteudo.slice(0, daConta),
    doClienteDesdeAConta: (posicaoDaConta === -1 ? maisNovasPrimeiro : maisNovasPrimeiro.slice(0, posicaoDaConta)).filter((mensagem) => !mensagem.daConta),
  };
}

/** `desde` cai em `desdeSemMensagem` quando nenhuma mensagem de conteúdo do cliente depois da conta pôde ser lida. */
function responderDe(recorte: Recorte, desdeSemMensagem: Instante, temIlegiveis: boolean): Responder {
  // Qualquer mensagem do cliente desde a última da conta conta aqui, de conteúdo ou não: o painel a mostra ao vendedor.
  const suspeitas = recorte.doClienteDesdeAConta.filter((mensagem) => mensagem.sinais.length > 0);
  return {
    tipo: "responder",
    desde: recorte.desdeAConta.at(-1)?.em ?? desdeSemMensagem,
    novas: recorte.desdeAConta.length,
    em_quarentena: suspeitas.length > 0,
    mensagens_em_quarentena: suspeitas.map((mensagem) => mensagem.id).toReversed(),
    sinais: [...new Set(suspeitas.flatMap((mensagem) => mensagem.sinais))],
    tem_ilegiveis: temIlegiveis,
    mais_que_o_lido: recorte.paginaCheia && recorte.desdeAConta.length === recorte.conteudo.length,
  };
}

/** A conta falou por último em `desde`: 3 dias úteis ou mais, e até 30 dias corridos, é esperar o cliente. */
export function esperandoDesde(desde: Instante, agora: Instante): SituacaoDaConversa {
  const hoje = diaEm(agora);
  const dia = diaEm(desde);
  const diasUteis = diasUteisEntre(dia, hoje);
  if (diasUteis < DIAS_UTEIS_PARA_ESPERAR || diasCorridos(dia, hoje) > ESPERA_MAXIMA_DIAS) return { tipo: "nada" };
  return { tipo: "esperando", desde, dias_uteis: diasUteis };
}

/**
 * A situação de uma conversa. Só mensagem de conteúdo (texto e mídia) decide: reação, figurinha,
 * mensagem apagada e evento do sistema não mudam quem fala por último. `mensagens` vem em qualquer
 * ordem; empate de instante respeita a ordem de entrada, que no wacli é da mais nova para a mais antiga.
 * `paginaCheia`: a leitura trouxe as `MENSAGENS_POR_CONVERSA` pedidas, contando as ilegíveis.
 */
export function situacaoDaConversa(mensagens: readonly Mensagem[], agora: Instante, paginaCheia = false): SituacaoDaConversa {
  const recorte = recortar(mensagens, paginaCheia);
  const ultima = recorte.conteudo[0];
  if (ultima === undefined) return { tipo: "nada" };
  if (ultima.daConta) return esperandoDesde(ultima.em, agora);
  // "ok" depois de uma pergunta ou de uma mensagem suspeita não apaga nenhuma das duas.
  const soConfirmou = recorte.desdeAConta.every(ehConfirmacaoCurta) && recorte.doClienteDesdeAConta.every((mensagem) => mensagem.sinais.length === 0);
  return soConfirmou ? { tipo: "nada" } : responderDe(recorte, ultima.em, false);
}

/** O instante da última mensagem de conteúdo, quando ela é da conta. */
export function contaFalouPorUltimoEm(mensagens: readonly Mensagem[]): Instante | null {
  const [ultima] = recortar(mensagens, false).conteudo;
  return ultima?.daConta === true ? ultima.em : null;
}

/** A situação guardada de uma conversa que não mudou desde a leitura, no relógio de agora: só a espera anda com o tempo. */
export function situacaoNoTempo(lida: Pick<ConversaLida, "situacao" | "contaFalouEm">, agora: Instante): SituacaoDaConversa {
  if (lida.situacao.tipo === "responder" || lida.contaFalouEm === null) return lida.situacao;
  return esperandoDesde(lida.contaFalouEm, agora);
}

/**
 * A situação quando o wacli devolveu mensagem que a Secretária não leu. Ela pode ser a pergunta do
 * cliente, então a conversa não sai de Responder por causa dela: fica a situação `anterior` quando
 * era Responder, senão entra em Responder com o que deu para ler. `ultimaMensagemEm` é o `desde`
 * quando nenhuma mensagem do cliente depois da conta pôde ser lida.
 */
export function situacaoComIlegiveis(
  mensagens: readonly Mensagem[],
  agora: Instante,
  paginaCheia: boolean,
  anterior: SituacaoDaConversa | null,
  ultimaMensagemEm: Instante,
): Responder {
  const calculada = situacaoDaConversa(mensagens, agora, paginaCheia);
  if (calculada.tipo === "responder") return { ...calculada, tem_ilegiveis: true };
  if (anterior?.tipo === "responder") return { ...anterior, tem_ilegiveis: true };
  return responderDe(recortar(mensagens, paginaCheia), ultimaMensagemEm, true);
}
