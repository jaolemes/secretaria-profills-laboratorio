import { esperandoDesde } from "./conversa";
import { idDoEmail, resumo, type CabecalhoGuardado } from "./email-cabecalho";
import { sinaisDeInjecao, type Sinal } from "./injecao";
import type { EnderecoEmail, IdContaEmail, Instante, TextoExterno } from "./tipos";

/**
 * Quem está esperando quem numa conversa de e-mail. Puro: recebe os cabeçalhos guardados de uma
 * conversa e o instante de agora. O corpo não é lido na sincronização, então nada aqui olha texto
 * de mensagem: um "ok, obrigado" por e-mail fica em Responder até o vendedor responder ou ignorar.
 */

/** A mensagem de fora que decide quem é o cliente da conversa: a última não automática que não é da conta. */
export interface DeForaDaConversa {
  readonly endereco: EnderecoEmail;
  /** O nome do remetente, `null` quando vazio ou com sinal de injeção. */
  readonly nome: TextoExterno | null;
  /** O assunto dessa mensagem, `null` quando vazio ou com sinal de injeção. */
  readonly assunto: TextoExterno | null;
  /** O id (`idDoEmail`) dessa mensagem, o que "Ver e-mail" abre. */
  readonly ultimo_email: string;
  readonly em_quarentena: boolean;
  /** Ids das mensagens de fora desde `desde` com sinal no assunto, no nome ou no endereço. Em `esperando`, só a última de fora. */
  readonly mensagens_em_quarentena: readonly string[];
  /** A união dos sinais dessas mensagens. */
  readonly sinais: readonly Sinal[];
}

export type SituacaoDoEmail =
  | ({
      readonly tipo: "responder";
      /** A primeira mensagem de fora depois da última da conta, ou a primeira de todas quando a conta nunca falou. */
      readonly desde: Instante;
      /** Mensagens de fora, não automáticas, desde então. */
      readonly novas: number;
    } & DeForaDaConversa)
  | ({ readonly tipo: "esperando"; readonly desde: Instante; readonly dias_uteis: number } & DeForaDaConversa)
  /** `de_fora` é `null` quando a conversa só tem mensagens da conta: ela não é candidata e nada vai ao CRM. */
  | { readonly tipo: "nada"; readonly de_fora: DeForaDaConversa | null };

/** Só a conversa com mensagem de fora é candidata a vínculo: só o remetente dela vai ao CRM. */
export function deForaDaSituacao(situacao: SituacaoDoEmail): DeForaDaConversa | null {
  return situacao.tipo === "nada" ? situacao.de_fora : situacao;
}

/** O que a situação lê de um cabeçalho: sem destinatários nem `Message-ID`, que os blocos não usam. */
export type CabecalhoDaConversa = Omit<CabecalhoGuardado, "destinatarios" | "messageId">;

const ordemDaPasta = { entrada: 0, enviados: 1 } as const;

/** Por instante; empate: a da entrada antes, depois o uid menor. */
function maisAntigaPrimeiro(a: CabecalhoDaConversa, b: CabecalhoDaConversa): number {
  return a.instante.localeCompare(b.instante) || ordemDaPasta[a.pasta] - ordemDaPasta[b.pasta] || a.uid - b.uid;
}

const idDa = (mensagem: CabecalhoDaConversa): string => idDoEmail({ pasta: mensagem.pasta, uidValidity: mensagem.uidValidity, uid: mensagem.uid });

/** O endereço não tem coluna de sinais: eles saem dele na hora, como `enderecoParaOAgente` os vê. */
const sinaisDa = (mensagem: CabecalhoDaConversa): readonly Sinal[] => [...mensagem.sinaisDoAssunto, ...mensagem.sinaisDoNome, ...sinaisDeInjecao(mensagem.remetente)];

function deForaDe(ultima: CabecalhoDaConversa, desde: readonly CabecalhoDaConversa[]): DeForaDaConversa {
  const suspeitas = desde.filter((mensagem) => sinaisDa(mensagem).length > 0);
  return {
    endereco: ultima.remetente,
    nome: ultima.remetenteNome,
    assunto: ultima.assunto,
    ultimo_email: idDa(ultima),
    em_quarentena: suspeitas.length > 0,
    mensagens_em_quarentena: suspeitas.map(idDa),
    sinais: [...new Set(suspeitas.flatMap(sinaisDa))],
  };
}

/**
 * A situação de uma conversa. `mensagens` são os cabeçalhos de uma conta e de uma chave `conversa`,
 * em qualquer ordem; a automática, de fora ou da conta, não conta. Última mensagem de fora:
 * `responder`. Última da conta há 3 dias úteis ou mais e até 30 dias: `esperando`, pela mesma regra
 * da conversa do WhatsApp (`esperandoDesde`). Senão, `nada`.
 */
export function situacaoDaConversaDeEmail(mensagens: readonly CabecalhoDaConversa[], agora: Instante): SituacaoDoEmail {
  const ordenadas = mensagens.filter((mensagem) => !mensagem.automatico).toSorted(maisAntigaPrimeiro);
  const ultimaDeFora = ordenadas.findLast((mensagem) => !mensagem.daConta);
  if (ultimaDeFora === undefined) return { tipo: "nada", de_fora: null };
  const ultima = ordenadas[ordenadas.length - 1];
  if (ultima === undefined) return { tipo: "nada", de_fora: null };
  if (!ultima.daConta) {
    const daConta = ordenadas.findLastIndex((mensagem) => mensagem.daConta);
    const desdeAConta = ordenadas.slice(daConta + 1);
    const primeira = desdeAConta[0] ?? ultima;
    return { tipo: "responder", desde: primeira.instante, novas: desdeAConta.length, ...deForaDe(ultimaDeFora, desdeAConta) };
  }
  const de_fora = deForaDe(ultimaDeFora, [ultimaDeFora]);
  const espera = esperandoDesde(ultima.instante, agora);
  return espera.tipo === "esperando" ? { tipo: "esperando", desde: espera.desde, dias_uteis: espera.dias_uteis, ...de_fora } : { tipo: "nada", de_fora };
}

/* ---------- id do item ---------- */

/**
 * `e-<16 hexadecimais>`: o resumo da conta e da chave da conversa. Estável enquanto a conversa
 * existir, e nunca carrega texto que quem escreveu o e-mail escolheu.
 */
export function idDoItemDeEmail(contaId: IdContaEmail, conversa: string): string {
  return `e-${resumo(`${contaId}\n${conversa}`)}`;
}

const ID_DO_ITEM_DE_EMAIL = /^e-[0-9a-f]{16}$/;

/** O id de item de e-mail, ou `null` fora da forma. */
export function lerIdDoItemDeEmail(texto: string): string | null {
  return ID_DO_ITEM_DE_EMAIL.test(texto) ? texto : null;
}

/* ---------- as conversas de uma leitura ---------- */

/** Uma conversa de uma conta, com a situação de agora. */
export interface ConversaDeEmail {
  readonly contaId: IdContaEmail;
  readonly conversa: string;
  /** O id do item no Meu dia. */
  readonly id: string;
  /** A mensagem mais recente da conversa, qualquer que seja o autor: ordena a consulta ao CRM. */
  readonly ultimaEm: Instante;
  readonly situacao: SituacaoDoEmail;
}

/**
 * Agrupa os cabeçalhos por conta e chave da conversa e calcula a situação de cada uma. Da conversa
 * com a mensagem mais recente para a mais antiga; empate pelo id.
 */
export function conversasDeEmail(cabecalhos: readonly CabecalhoDaConversa[], agora: Instante): ConversaDeEmail[] {
  const grupos = new Map<string, CabecalhoDaConversa[]>();
  for (const cabecalho of cabecalhos) {
    const chave = `${cabecalho.contaId}\n${cabecalho.conversa}`;
    const grupo = grupos.get(chave);
    if (grupo === undefined) grupos.set(chave, [cabecalho]);
    else grupo.push(cabecalho);
  }
  const conversas: ConversaDeEmail[] = [];
  for (const grupo of grupos.values()) {
    const [primeiro] = grupo;
    if (primeiro === undefined) continue;
    const ultimaEm = grupo.reduce((maior, mensagem) => (mensagem.instante > maior ? mensagem.instante : maior), primeiro.instante);
    conversas.push({ contaId: primeiro.contaId, conversa: primeiro.conversa, id: idDoItemDeEmail(primeiro.contaId, primeiro.conversa), ultimaEm, situacao: situacaoDaConversaDeEmail(grupo, agora) });
  }
  return conversas.sort((a, b) => b.ultimaEm.localeCompare(a.ultimaEm) || a.id.localeCompare(b.id));
}
