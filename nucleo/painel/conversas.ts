import {
  diaEm,
  lerTelefone,
  type CanalDeVinculo,
  type CandidatoDeVinculo,
  type Instante,
  type ItemDeEsperandoDeEmail,
  type ItemDeEsperandoDoWhatsapp as ItemDeEsperando,
  type ItemDeResponderDeEmail,
  type ItemDeResponderDoWhatsapp as ItemDeResponder,
  type MensagemParaOPainel,
  type NaoClienteDoDia,
  type Sinal,
} from "../dominio";

/**
 * O que o Meu dia diz de uma conversa do WhatsApp ou de e-mail. Tudo aqui é puro e trabalha só com o
 * que a sincronização guardou: nome, telefone, endereço, assunto e contagens. Texto de mensagem só
 * entra em `partesDoTexto`, que recebe o que a gaveta leu.
 */

/** Fica só com os itens do WhatsApp, para o código que trata de um canal só (o servidor de desenvolvimento). */
export function ehDoWhatsapp<I extends { readonly canal: "whatsapp" | "email" }>(item: I): item is Extract<I, { readonly canal: "whatsapp" }> {
  return item.canal === "whatsapp";
}

/** A conversa como o painel a identifica nas rotas de vínculo: o telefone, ou o endereço do remetente. */
export interface AlvoDeVinculo {
  readonly canal: CanalDeVinculo;
  readonly chave: string;
}

/** "(41) 99999-0002" para celular e fixo do Brasil; outro número sai como veio, com o `+`. */
export function formatarTelefone(telefone: string): string {
  const brasil = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(telefone);
  return brasil === null ? telefone : `(${brasil[1]}) ${brasil[2]}-${brasil[3]}`;
}

/** O título da linha: o cliente do CRM, ou "telefone · nome no WhatsApp" quando o número ainda não tem cliente. */
export function tituloDaConversa(item: Pick<ItemDeResponder | ItemDeEsperando, "cliente" | "telefone" | "nome_no_whatsapp">): string {
  if (item.cliente !== null) return item.cliente.nome;
  const telefone = formatarTelefone(item.telefone);
  return item.nome_no_whatsapp === null ? telefone : `${telefone} · ${item.nome_no_whatsapp}`;
}

/** O título da linha de e-mail: o cliente do CRM, ou o endereço com o nome do remetente. Sem endereço, a frase fixa. */
export function tituloDoEmail(item: { readonly cliente: { readonly nome: string } | null; readonly endereco: string | null; readonly nome_do_remetente: string | null }): string {
  if (item.cliente !== null) return item.cliente.nome;
  if (item.endereco === null) return "E-mail sem endereço";
  return item.nome_do_remetente === null ? item.endereco : `${item.endereco} · ${item.nome_do_remetente}`;
}

/** "WhatsApp", ou "E-mail · Profills": a etiqueta discreta da linha. */
export function etiquetaDoCanal(item: { readonly canal: "whatsapp" } | { readonly canal: "email"; readonly conta: { readonly rotulo: string } }): string {
  return item.canal === "whatsapp" ? "WhatsApp" : `E-mail · ${item.conta.rotulo}`;
}

const MINUTO_MS = 60_000;
const DIA_MS = 86_400_000;

function diasEntre(desde: Instante, agora: Instante): number {
  return Math.round((Date.parse(`${diaEm(agora)}T00:00:00Z`) - Date.parse(`${diaEm(desde)}T00:00:00Z`)) / DIA_MS);
}

/**
 * "de 5 horas atrás", "de ontem", "de 2 dias atrás". Menos de um dia conta pelo relógio; a partir
 * daí conta pelos dias de Brasília, para a mensagem de ontem à noite não virar "de 1 dia atrás".
 */
export function haQuantoTempo(desde: Instante, agora: Instante): string {
  const minutos = Math.max(0, Math.floor((Date.parse(agora) - Date.parse(desde)) / MINUTO_MS));
  if (minutos < 1) return "de menos de 1 minuto atrás";
  if (minutos < 60) return minutos === 1 ? "de 1 minuto atrás" : `de ${minutos} minutos atrás`;
  if (minutos < 24 * 60) {
    const horas = Math.floor(minutos / 60);
    return horas === 1 ? "de 1 hora atrás" : `de ${horas} horas atrás`;
  }
  const dias = diasEntre(desde, agora);
  return dias <= 1 ? "de ontem" : `de ${dias} dias atrás`;
}

const FRASE_DO_ILEGIVEL = "Há mensagem que a Secretária não conseguiu ler. Confira no WhatsApp.";

/** `mais_que_o_lido`: a leitura veio cheia e `novas` é o mínimo. */
function quantasNovas(novas: number, maisQueOLido: boolean): string {
  if (maisQueOLido) return `${novas} ou mais mensagens novas`;
  return novas === 1 ? "1 mensagem nova" : `${novas} mensagens novas`;
}

/**
 * "3 mensagens novas. A mais antiga é de 2 dias atrás". Nunca leva texto de mensagem. Com mensagem
 * ilegível, a frase do aviso vem no fim. Sem nenhuma legível (`novas` 0), só a idade da última.
 */
export function apoioDeResponder(item: Pick<ItemDeResponder, "novas" | "desde" | "mais_que_o_lido" | "tem_ilegiveis">, agora: Instante): string {
  const quando = haQuantoTempo(item.desde, agora);
  const contagem =
    item.novas === 0 ? `Última mensagem ${quando}` : item.novas === 1 && !item.mais_que_o_lido ? `1 mensagem nova, ${quando}` : `${quantasNovas(item.novas, item.mais_que_o_lido)}. A mais antiga é ${quando}`;
  return item.tem_ilegiveis ? `${contagem}. ${FRASE_DO_ILEGIVEL}` : contagem;
}

export function apoioDeEsperando(item: Pick<ItemDeEsperando, "dias_uteis">): string {
  return `Você falou por último há ${item.dias_uteis === 1 ? "1 dia útil" : `${item.dias_uteis} dias úteis`}`;
}

/** O assunto e a contagem, juntos por " · ". Sem assunto, só a contagem. */
function comAssunto(assunto: string | null, frase: string): string {
  return assunto === null ? frase : `${assunto} · ${frase}`;
}

/** "Pedido · 2 e-mails novos. O mais antigo é de 3 dias atrás". Nunca leva o corpo. */
export function apoioDoEmailEmResponder(item: Pick<ItemDeResponderDeEmail, "assunto" | "novas" | "desde">, agora: Instante): string {
  const quando = haQuantoTempo(item.desde, agora);
  const contagem = item.novas === 0 ? `Último e-mail ${quando}` : item.novas === 1 ? `1 e-mail novo, ${quando}` : `${item.novas} e-mails novos. O mais antigo é ${quando}`;
  return comAssunto(item.assunto, contagem);
}

export function apoioDoEmailEmEsperando(item: Pick<ItemDeEsperandoDeEmail, "assunto" | "dias_uteis">): string {
  return comAssunto(item.assunto, `Você respondeu por último há ${item.dias_uteis === 1 ? "1 dia útil" : `${item.dias_uteis} dias úteis`}`);
}

type Ambigua = Extract<ItemDeResponder | ItemDeEsperando, { readonly vinculo: "ambiguo" }>;
type AmbiguaDeEmail = Extract<ItemDeResponderDeEmail | ItemDeEsperandoDeEmail, { readonly vinculo: "ambiguo" }>;

/** A frase do motivo da dúvida, no alto da gaveta de escolher o cliente. */
export function motivoDaDuvida(item: Pick<Ambigua, "motivo_da_duvida" | "candidatos" | "telefone">): string {
  if (item.motivo_da_duvida === "varios_clientes") return `Este número está em ${item.candidatos.length} clientes do CRM.`;
  if (item.motivo_da_duvida === "desfeito_pelo_vendedor") return "Você desfez o que tinha decidido sobre este número. Confira qual é o cliente.";
  if (item.motivo_da_duvida === "sem_prova_do_telefone") return "O CRM achou este cliente pelo número, mas sem um telefone de contato igual. Confira se é ele.";
  // O CRM tem o outro formato do mesmo celular: se o WhatsApp tem o 9, é o CRM que está sem ele.
  if (/^\+55\d{2}9\d{8}$/.test(item.telefone)) return "No CRM o número está sem o 9 na frente. Confira se é o mesmo.";
  if (/^\+55\d{2}[6-9]\d{7}$/.test(item.telefone)) return "No CRM o número está com o 9 na frente. Confira se é o mesmo.";
  return "No CRM o número está escrito de outro jeito. Confira se é o mesmo.";
}

/** A frase do motivo da dúvida de um endereço, no alto da gaveta de escolher o cliente. */
export function motivoDaDuvidaDoEmail(item: Pick<AmbiguaDeEmail, "motivo_da_duvida" | "candidatos">): string {
  if (item.motivo_da_duvida === "varios_clientes") return `Este endereço está em ${item.candidatos.length} clientes do CRM.`;
  if (item.motivo_da_duvida === "sem_prova_do_email") return "O CRM achou este cliente pelo endereço, mas sem um contato com este e-mail. Confira se é ele.";
  if (item.motivo_da_duvida === "desfeito_pelo_vendedor") return "Você desfez o que tinha decidido sobre este endereço. Confira qual é o cliente.";
  return "Confira se é este cliente.";
}

export function nomeNoWhatsapp(nome: string | null): string | null {
  return nome === null ? null : `No WhatsApp o contato se chama ${nome}.`;
}

export function nomeDoRemetente(nome: string | null): string | null {
  return nome === null ? null : `No e-mail o remetente se chama ${nome}.`;
}

/** "Curitiba, PR", só a cidade, só a UF ou `null`. */
export function lugarDoCandidato(candidato: Pick<CandidatoDeVinculo, "cidade" | "uf">): string | null {
  const texto = [candidato.cidade, candidato.uf].filter((parte) => parte !== null && parte !== "").join(", ");
  return texto === "" ? null : texto;
}

/** O que o vendedor decide numa conversa sem cliente: um dos candidatos, ou "não é cliente". */
export type Escolha = { readonly clienteId: number } | { readonly naoCliente: true };

export interface RespostaDaEscolha {
  readonly canal: CanalDeVinculo;
  readonly chave: string;
  readonly estado: "confirmado" | "nao_cliente";
  readonly cliente: { readonly id: number; readonly nome: string; readonly cidade: string | null } | null;
  readonly decididoEm: string;
}

export function textoDaEscolha(resposta: Pick<RespostaDaEscolha, "estado" | "cliente">): { readonly texto: string; readonly detalhe: string | null } {
  if (resposta.estado === "nao_cliente" || resposta.cliente === null) return { texto: "Marcado como não cliente.", detalhe: null };
  const onde = resposta.cliente.cidade === null ? "" : `, de ${resposta.cliente.cidade}`;
  return { texto: `Vinculado a ${resposta.cliente.nome}${onde}.`, detalhe: "A conversa segue em Responder, com o nome do cliente." };
}

/** Trocar cliente, ou o Desfazer do aviso de vinculado: a conversa volta na hora a perguntar, com o cliente que era como candidato. */
export const AVISO_DE_DESFEITO = { texto: "Desfeito. A conversa voltou a perguntar \"Qual cliente?\"", detalhe: null } as const;

/** Desfazer o "não é cliente" devolve o número ao estado ambíguo na hora, com os candidatos que ele tinha. */
export const AVISO_DE_NAO_CLIENTE_DESFEITO = { texto: "Desfeito. A conversa voltou para Responder, com a pergunta \"Qual cliente?\"", detalhe: null } as const;

/** Quantos números marcados como não cliente a lista mostra; os outros viram "e mais N". */
export const NAO_CLIENTES_VISIVEIS = 5;

/**
 * "(41) 99999-0002 · Nome no WhatsApp: você disse que não é cliente." Sem nome, só o telefone.
 * No e-mail: "compras@cliente.exemplo.test: você disse que não é cliente."
 */
export function frasePrincipalDoNaoCliente(item: { readonly canal?: "whatsapp"; readonly telefone: string; readonly nome_no_whatsapp: string | null } | { readonly canal: "email"; readonly endereco: string }): string {
  if ("endereco" in item) return `${item.endereco}: você disse que não é cliente.`;
  const nome = item.nome_no_whatsapp === null ? "" : ` · ${item.nome_no_whatsapp}`;
  return `${formatarTelefone(item.telefone)}${nome}: você disse que não é cliente.`;
}

/** Os mais novos primeiro, até `NAO_CLIENTES_VISIVEIS`, e quantos ficaram de fora. */
export function recortarNaoClientes<N>(lista: readonly N[]): { readonly visiveis: readonly N[]; readonly restantes: number } {
  return { visiveis: lista.slice(0, NAO_CLIENTES_VISIVEIS), restantes: Math.max(0, lista.length - NAO_CLIENTES_VISIVEIS) };
}

/** Os sinais com nome para quem não é técnico. A tabela cobre `SINAIS` inteiro. */
export const NOMES_DOS_SINAIS: { readonly [S in Sinal]: string } = {
  caractere_invisivel: "Caractere invisível",
  fala_com_o_agente: "Fala com o agente",
  marca_de_papel: "Imita ordem de sistema",
  pede_comando: "Pede para rodar um comando",
  pede_segredo: "Pede senha ou chave",
};

export interface ParteDoTexto {
  readonly texto: string;
  /** `⟦U+XXXX⟧`: um caractere que o WhatsApp não mostra, já trocado pelo servidor. */
  readonly marca: boolean;
}

const MARCA = /⟦U\+[0-9A-F]+⟧/g;

/** Parte o texto em trechos comuns e marcas, para a tela destacar cada marca. A tela só põe texto, nunca HTML. */
export function partesDoTexto(texto: string): ParteDoTexto[] {
  const partes: ParteDoTexto[] = [];
  let fim = 0;
  for (const achado of texto.matchAll(MARCA)) {
    if (achado.index > fim) partes.push({ texto: texto.slice(fim, achado.index), marca: false });
    partes.push({ texto: achado[0], marca: true });
    fim = achado.index + achado[0].length;
  }
  if (fim < texto.length) partes.push({ texto: texto.slice(fim), marca: false });
  return partes;
}

const MARCAS_NA_FRASE = 4;

/** "A marca ⟦U+200B⟧ mostra um caractere que não aparece na tela do WhatsApp.", ou `null` sem marca. `lugar` é a tela de onde o texto veio. */
export function avisoDasMarcas(partes: readonly ParteDoTexto[], lugar: "WhatsApp" | "e-mail" | "CRM" = "WhatsApp"): string | null {
  const distintas = [...new Set(partes.filter((parte) => parte.marca).map((parte) => parte.texto))];
  if (distintas.length === 0) return null;
  if (distintas.length === 1) return `A marca ${distintas[0]} mostra um caractere que não aparece na tela do ${lugar}.`;
  const vistas = distintas.slice(0, MARCAS_NA_FRASE);
  const resto = distintas.length - vistas.length;
  const lista = resto > 0 ? `${vistas.join(", ")} e mais ${resto}` : `${vistas.slice(0, -1).join(", ")} e ${vistas.at(-1)}`;
  return `As marcas ${lista} mostram caracteres que não aparecem na tela do ${lugar}.`;
}

/** Da mais antiga para a mais nova; a de mesmo instante fica na ordem em que a sincronização guardou. */
export function maisAntigaPrimeiro<M extends Pick<MensagemParaOPainel, "em">>(mensagens: readonly M[]): M[] {
  return [...mensagens].sort((a, b) => a.em.localeCompare(b.em));
}

/** Telefone digitado ou vindo de um nome de marca: só vira telefone formatado se for E.164. */
export function nomeDoIgnoradoDeConversa(nome: string): string {
  return lerTelefone(nome) === null ? nome : formatarTelefone(nome);
}

/** Quantos e-mails a gaveta abre de uma vez. */
export const EMAILS_NA_GAVETA = 5;

/**
 * Os e-mails que "Ver e-mail" abre: os da quarentena e o último, sem repetir, os 5 mais novos, do
 * mais antigo para o mais novo. `semLugar` é quantos da quarentena ficaram de fora. Item de Esperando
 * cliente não tem o campo e abre só o último.
 */
export function emailsDaGaveta(item: { readonly ultimo_email: string; readonly mensagens_em_quarentena?: readonly string[] }): { readonly ids: readonly string[]; readonly semLugar: number } {
  const todos = [...new Set([...(item.mensagens_em_quarentena ?? []).filter((id) => id !== item.ultimo_email), item.ultimo_email])];
  return { ids: todos.slice(-EMAILS_NA_GAVETA), semLugar: Math.max(0, todos.length - EMAILS_NA_GAVETA) };
}

export function avisoDosEmailsSemLugar(n: number): string | null {
  if (n === 0) return null;
  return `Esta conversa tem mais ${n === 1 ? "1 e-mail" : `${n} e-mails`} em quarentena. Leia no seu programa de e-mail.`;
}

/** A chave de vínculo de um não cliente: o telefone ou o endereço. `null` só para o endereço que o painel não recebe. */
export function chaveDoNaoCliente(item: NaoClienteDoDia): AlvoDeVinculo | null {
  if (item.canal === "whatsapp") return { canal: "whatsapp", chave: item.telefone };
  return item.endereco === null ? null : { canal: "email", chave: item.endereco };
}
