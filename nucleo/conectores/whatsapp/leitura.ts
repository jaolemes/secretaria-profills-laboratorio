import { z } from "zod";
import {
  falha,
  instante,
  lerCursor,
  lerIdDeMensagem,
  lerJid,
  montarContato,
  montarConversa,
  montarMensagem,
  montarParDeIdentidade,
  ok,
  type Contato,
  type ContextoDaBusca,
  type Conversa,
  type Instante,
  type LeituraDeWhatsapp,
  type Mensagem,
  type PaginaDeMensagens,
  type ParDeIdentidade,
  type Resultado,
} from "../../dominio";

/**
 * Formato das leituras do wacli 0.26.0, escrito a partir do código Go (`internal/store/types.go`,
 * `cmd/wacli/chats.go`, `messages_read.go`, `cmd_wacli_messages_pages.go`, `cmd_wacli_contacts*.go`).
 * `Message` e `Chat` do wacli não têm tags JSON em quase todos os campos, então o JSON usa os
 * nomes dos campos Go (`MsgID`, `FromMe`). Campo desconhecido é ignorado.
 *
 * Duas falhas diferentes. Deriva de formato (tipo errado, campo obrigatório ausente, data que não é
 * data) falha fechada a leitura inteira com `whatsapp_resposta_inesperada`, citando o campo e nunca o
 * valor. Conteúdo que quem escreve escolhe (o id da mensagem, um JID fora da regra, o instante zero
 * do Go) tira só aquele item da lista e soma um em `ilegiveis`: um cliente não derruba a leitura toda.
 */

/** Slice nulo do Go vira `null` no JSON. */
const lista = <T extends z.ZodType>(item: T) => z.array(item).nullable().transform((itens) => itens ?? []);
const textoOpcional = z
  .string()
  .nullish()
  .transform((valor) => valor ?? "");
const booleanoOpcional = z
  .boolean()
  .nullish()
  .transform((valor) => valor ?? false);

/** O item passou no formato, mas o campo nomeado não passa na regra de id, JID ou instante. */
interface Ilegivel {
  readonly ilegivel: string;
}
type ItemOuIlegivel<T> = T | Ilegivel;
const ehIlegivel = <T extends object>(item: ItemOuIlegivel<T>): item is Ilegivel => "ilegivel" in item;

interface ItensLegiveis<T> {
  readonly itens: readonly T[];
  readonly ilegiveis: number;
}

/** Lista do wacli em que o item ilegível sai e é contado. */
const listaLegivel = <T extends object>(item: z.ZodType<ItemOuIlegivel<T>>) =>
  lista(item).transform((itens): ItensLegiveis<T> => {
    const legiveis = itens.filter((cada): cada is T => !ehIlegivel(cada));
    return { itens: legiveis, ilegiveis: itens.length - legiveis.length };
  });

/** `time.Time` do Go. O instante zero (`0001-01-01T00:00:00Z`) é "sem data" e vira `null`. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const instanteOuNulo = z
  .string()
  .regex(INSTANTE)
  .transform((valor): Instante | null => {
    const ms = Date.parse(valor);
    return Number.isNaN(ms) ? null : ms <= 0 ? null : instante(new Date(ms));
  });

const chat = z
  .object({
    jid: z.string(),
    kind: z.string(),
    name: z.string(),
    last_message_ts: instanteOuNulo,
    unread: z.boolean(),
    unread_count: z.number().int().min(0),
  })
  .transform((bruto): ItemOuIlegivel<Conversa> =>
    lerJid(bruto.jid) === null
      ? { ilegivel: "jid" }
      : montarConversa({
          jid: bruto.jid,
          kind: bruto.kind,
          nome: bruto.name,
          ultimaMensagemEm: bruto.last_message_ts,
          naoLida: bruto.unread,
          naoLidas: bruto.unread_count,
        }),
  );

const botao = z.object({ display_text: z.string() });

/** O primeiro campo que o remetente ou o WhatsApp escolheu e que não passa na regra. */
function campoIlegivelDaMensagem(bruto: { ChatJID: string; MsgID: string; SenderJID: string }): string | null {
  if (lerJid(bruto.ChatJID) === null) return "ChatJID";
  if (lerIdDeMensagem(bruto.MsgID) === null) return "MsgID";
  if (bruto.SenderJID !== "" && lerJid(bruto.SenderJID) === null) return "SenderJID";
  return null;
}

const mensagem = z
  .object({
    ChatJID: z.string(),
    MsgID: z.string(),
    SenderJID: textoOpcional,
    SenderName: textoOpcional,
    Timestamp: instanteOuNulo,
    FromMe: z.boolean(),
    Text: z.string(),
    DisplayText: z.string(),
    Buttons: z.array(botao).nullish(),
    ReactionToID: textoOpcional,
    ReactionEmoji: textoOpcional,
    MediaType: textoOpcional,
    MediaCaption: textoOpcional,
    Filename: textoOpcional,
    Revoked: booleanoOpcional,
    DeletedForMe: booleanoOpcional,
    Snippet: textoOpcional,
  })
  .transform((bruto): ItemOuIlegivel<Mensagem> => {
    const ilegivel = campoIlegivelDaMensagem(bruto);
    if (ilegivel !== null) return { ilegivel };
    if (bruto.Timestamp === null) return { ilegivel: "Timestamp" };
    return montarMensagem({
      id: bruto.MsgID,
      conversa: bruto.ChatJID,
      daConta: bruto.FromMe,
      em: bruto.Timestamp,
      apagada: bruto.Revoked || bruto.DeletedForMe,
      reacaoA: bruto.ReactionToID,
      emoji: bruto.ReactionEmoji,
      tipoDeMidia: bruto.MediaType,
      legenda: bruto.MediaCaption,
      textoDeExibicao: bruto.DisplayText,
      textoCru: bruto.Text,
      arquivo: bruto.Filename,
      botoes: (bruto.Buttons ?? []).map((item) => item.display_text),
      trecho: bruto.Snippet,
      remetente: bruto.SenderJID,
      nomeDoRemetente: bruto.SenderName,
    });
  });

/**
 * Sem `page`, a leitura não tem mais páginas. Com `page`, `has_more` de outro tipo ou cursor fora da
 * regra falham fechados: virar "acabou" esconderia mensagens do agente.
 */
const pagina = z
  .object({ has_more: z.boolean(), next_cursor: z.string().nullish() })
  .optional()
  .refine((valor) => valor?.next_cursor == null || valor.next_cursor === "" || lerCursor(valor.next_cursor) !== null, { message: "cursor", path: ["next_cursor"] })
  .transform((valor): PaginaDeMensagens => ({ temMais: valor?.has_more ?? false, cursor: lerCursor(valor?.next_cursor) }));

const paginaDeMensagens = z.object({ messages: listaLegivel(mensagem), page: pagina });

const blocoDeContexto = z
  .object({ chat_jid: z.string(), msg_id: z.string(), messages: listaLegivel(mensagem) })
  .transform((bruto): ItemOuIlegivel<ContextoDaBusca & { readonly ilegiveis: number }> =>
    lerJid(bruto.chat_jid) === null || lerIdDeMensagem(bruto.msg_id) === null
      ? { ilegivel: "context" }
      : { conversa: bruto.chat_jid, id: bruto.msg_id, mensagens: bruto.messages.itens, ilegiveis: bruto.messages.ilegiveis },
  );

const busca = z.object({
  messages: listaLegivel(mensagem),
  page: pagina,
  context: listaLegivel(blocoDeContexto).optional().transform((blocos) => blocos ?? { itens: [], ilegiveis: 0 }),
});

const contato = z
  .object({ jid: z.string(), name: z.string(), alias: textoOpcional, system_name: textoOpcional })
  .transform(
    (bruto): ItemOuIlegivel<Contato> =>
      lerJid(bruto.jid) === null
        ? { ilegivel: "jid" }
        : montarContato({ jid: bruto.jid, nome: [bruto.alias, bruto.system_name, bruto.name].find((nome) => nome.trim() !== "") ?? "" }),
  );

const identidade = z
  .object({ input: z.string(), resolved: z.boolean(), jid: textoOpcional, phone: textoOpcional, lid: textoOpcional })
  .transform((bruto) =>
    montarParDeIdentidade({ entrada: bruto.input, jidDeTelefone: bruto.jid, telefone: bruto.phone, lid: bruto.lid, resolvido: bruto.resolved }),
  );

/** O campo que o zod recusou, no caminho do JSON. Só nomes do schema e índices: nunca o valor nem uma chave do wacli. */
function campoRecusado(erro: z.ZodError): string {
  const caminho = erro.issues[0]?.path.filter((parte): parte is string | number => typeof parte !== "symbol").join(".") ?? "";
  return caminho === "" ? "(raiz)" : caminho;
}

export function respostaInesperada(erro: z.ZodError): Resultado<never> {
  return foraDoFormato(campoRecusado(erro));
}

function foraDoFormato(campo: string): Resultado<never> {
  return falha("whatsapp_resposta_inesperada", `O wacli respondeu fora do formato no campo ${campo}.`);
}

function lerCom<S extends z.ZodType>(schema: S, dados: unknown): Resultado<z.output<S>> {
  const lido = schema.safeParse(dados);
  return lido.success ? ok(lido.data) : respostaInesperada(lido.error);
}

/** `ilegiveis` só aparece quando algum item caiu. */
const contagem = (ilegiveis: number) => (ilegiveis > 0 ? { ilegiveis } : {});

const lerConversasLegiveis = (dados: unknown) => lerCom(listaLegivel(chat), dados);
const lerContatosLegiveis = (dados: unknown) => lerCom(listaLegivel(contato), dados);

/** Para o servidor: o item ilegível fica de fora, sem contar. */
export function lerConversas(dados: unknown): Resultado<readonly Conversa[]> {
  const lido = lerConversasLegiveis(dados);
  return lido.ok ? ok(lido.dados.itens) : lido;
}

export function lerContatos(dados: unknown): Resultado<readonly Contato[]> {
  const lido = lerContatosLegiveis(dados);
  return lido.ok ? ok(lido.dados.itens) : lido;
}

export const lerIdentidades = (dados: unknown): Resultado<readonly ParDeIdentidade[]> => lerCom(lista(identidade), dados);

/** `messages show`: uma mensagem só, fora de página. Aqui não há lista de onde tirá-la, então ilegível falha fechada. */
export function lerMensagemUnica(dados: unknown): Resultado<Mensagem> {
  const lido = lerCom(mensagem, dados);
  if (!lido.ok) return lido;
  return ehIlegivel(lido.dados) ? foraDoFormato(lido.dados.ilegivel) : ok(lido.dados);
}

export function lerMensagens(dados: unknown): Resultado<Extract<LeituraDeWhatsapp, { tipo: "mensagens" }>> {
  const lido = lerCom(paginaDeMensagens, dados);
  if (!lido.ok) return lido;
  return ok({ tipo: "mensagens", mensagens: lido.dados.messages.itens, pagina: lido.dados.page, ...contagem(lido.dados.messages.ilegiveis) });
}

export function lerBusca(dados: unknown): Resultado<Extract<LeituraDeWhatsapp, { tipo: "busca" }>> {
  const lido = lerCom(busca, dados);
  if (!lido.ok) return lido;
  const { messages, context, page } = lido.dados;
  const contexto = context.itens.map(({ conversa, id, mensagens }) => ({ conversa, id, mensagens }));
  const ilegiveis = messages.ilegiveis + context.ilegiveis + context.itens.reduce((soma, bloco) => soma + bloco.ilegiveis, 0);
  return ok({ tipo: "busca", mensagens: messages.itens, contexto, pagina: page, ...contagem(ilegiveis) });
}

/** As leituras que o agente pede, por comando. `doctor` não leva texto de cliente e segue como o wacli o escreveu. */
export function lerLeituraDoAgente(comando: string, dados: unknown): Resultado<LeituraDeWhatsapp> {
  switch (comando) {
    case "chats list": {
      const lido = lerConversasLegiveis(dados);
      return lido.ok ? ok({ tipo: "conversas", conversas: lido.dados.itens, ...contagem(lido.dados.ilegiveis) }) : lido;
    }
    case "messages list":
      return lerMensagens(dados);
    case "messages search":
      return lerBusca(dados);
    case "contacts search": {
      const lido = lerContatosLegiveis(dados);
      return lido.ok ? ok({ tipo: "contatos", contatos: lido.dados.itens, ...contagem(lido.dados.ilegiveis) }) : lido;
    }
    case "doctor":
      return ok({ tipo: "diagnostico", dados });
    default:
      return falha("interno", "Leitura do WhatsApp sem schema.");
  }
}
