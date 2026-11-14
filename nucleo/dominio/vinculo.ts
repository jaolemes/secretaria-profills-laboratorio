import { falha, ok, type Resultado } from "./erros";
import { somar } from "./maquina";
import { lerEnderecoEmail, lerTelefone, type EnderecoEmail, type Instante, type Telefone, type TextoExterno } from "./tipos";

/**
 * De quem é o contato de uma conversa: qual cliente do CRM ele é. A regra é pura e vale para os dois
 * canais. A sincronização consulta o CRM, entrega as respostas a `decidirVinculo` e grava o que sai
 * daqui. Só os dígitos do telefone (WhatsApp) ou o endereço do remetente (e-mail) vão ao CRM; nome
 * de contato, assunto e corpo nunca vão.
 */

export const CANAIS_DE_VINCULO = ["whatsapp", "email"] as const;
export type CanalDeVinculo = (typeof CANAIS_DE_VINCULO)[number];

export const ESTADOS_DE_VINCULO = ["auto", "confirmado", "ambiguo", "nao_cliente", "sem_cliente"] as const;
export type EstadoDeVinculo = (typeof ESTADOS_DE_VINCULO)[number];

/**
 * Por que a Secretária não escolhe sozinha entre os candidatos. `sem_prova_do_telefone`: a busca
 * devolveu um cliente só, mas nenhum contato dele tem o telefone da conversa (a busca casou por
 * CPF, CNPJ ou nome, ou o CRM não mandou o telefone dos contatos). `sem_prova_do_email`: o mesmo
 * para o endereço do remetente (a busca casou pelo e-mail do cadastro do cliente, ou o CRM não
 * mandou o e-mail dos contatos). `desfeito_pelo_vendedor`: o
 * vendedor voltou atrás de um cliente que ele confirmou (Trocar cliente), ou de um "não é cliente"
 * num número que a Secretária tinha vinculado sozinha (`auto`). Só o desfazer o produz.
 */
export const MOTIVOS_DA_DUVIDA = ["varios_clientes", "variante_do_9", "sem_prova_do_telefone", "sem_prova_do_email", "desfeito_pelo_vendedor"] as const;
export type MotivoDaDuvida = (typeof MOTIVOS_DA_DUVIDA)[number];

/**
 * Os motivos que o banco guarda: o CHECK de `contato_vinculo` é fechado e uma migração que o
 * recriasse já gerou SQL com defeito. `sem_prova_do_email` vai como `sem_prova_do_telefone`.
 */
export const MOTIVOS_NO_BANCO = ["varios_clientes", "variante_do_9", "sem_prova_do_telefone", "desfeito_pelo_vendedor"] as const;
export type MotivoNoBanco = (typeof MOTIVOS_NO_BANCO)[number];

/** `sem_cliente` vale 7 dias; `auto` e `ambiguo`, 30. `confirmado` e `nao_cliente` não vencem. */
export const SEM_CLIENTE_VALE_DIAS = 7;
export const VINCULO_VALE_DIAS = 30;
/** O `q` de `buscar_clientes` aceita até 200 caracteres: endereço maior não é consultado. */
export const TAMANHO_MAXIMO_DA_BUSCA = 200;
/** Quantos clientes uma consulta ao CRM pede, e quantos candidatos o vínculo guarda. */
export const CANDIDATOS_NO_MAXIMO = 10;

/** Um cliente do CRM como `buscar_clientes` o devolve. */
export interface CandidatoDeVinculo {
  readonly id: number;
  readonly nome: TextoExterno;
  readonly cidade: TextoExterno | null;
  readonly uf: TextoExterno | null;
}

/**
 * Um cliente como a busca o devolve: o candidato e o telefone e o e-mail de cada contato. Os dois só
 * provam o vínculo e não são guardados; nome de contato nem chega aqui.
 */
export interface ClienteDaBusca extends CandidatoDeVinculo {
  readonly contatos: readonly { readonly telefone: string | null; readonly email: string | null }[];
}

export interface ClienteDoVinculo {
  readonly id: number;
  readonly nome: TextoExterno;
  readonly cidade: TextoExterno | null;
}

export type DecisaoDeVinculo =
  | { readonly estado: "auto"; readonly cliente: CandidatoDeVinculo }
  | { readonly estado: "ambiguo"; readonly motivo: MotivoDaDuvida; readonly candidatos: readonly CandidatoDeVinculo[] }
  | { readonly estado: "sem_cliente" };

/** O vínculo como o banco o guarda. */
export type VinculoDeContato = {
  readonly canal: CanalDeVinculo;
  /** O telefone E.164 da conversa (`whatsapp`) ou o endereço do remetente em minúsculas (`email`). */
  readonly chave: string;
  /** Quando o CRM foi consultado pela última vez para esta chave. */
  readonly conferidoEm: Instante;
} & (
  | { readonly estado: "auto"; readonly cliente: ClienteDoVinculo; readonly decididoEm: null }
  | { readonly estado: "confirmado"; readonly cliente: ClienteDoVinculo; readonly decididoEm: Instante }
  | { readonly estado: "ambiguo"; readonly motivo: MotivoDaDuvida; readonly candidatos: readonly CandidatoDeVinculo[]; readonly decididoEm: null }
  | {
      readonly estado: "nao_cliente";
      readonly decididoEm: Instante;
      /** Os candidatos e o motivo que o vínculo tinha: o desfazer devolve o vínculo a `ambiguo` com eles, sem o CRM. */
      readonly motivo: MotivoDaDuvida;
      readonly candidatos: readonly CandidatoDeVinculo[];
    }
  | { readonly estado: "sem_cliente"; readonly decididoEm: null }
);

const comoCliente = (candidato: CandidatoDeVinculo): ClienteDoVinculo => ({ id: candidato.id, nome: candidato.nome, cidade: candidato.cidade });
const comoCandidato = (cliente: CandidatoDeVinculo): CandidatoDeVinculo => ({ id: cliente.id, nome: cliente.nome, cidade: cliente.cidade, uf: cliente.uf });

/** O CRM pode listar o mesmo cliente duas vezes (casou por dois contatos): conta uma vez, com os contatos das duas. */
function semRepetidos(clientes: readonly ClienteDaBusca[]): ClienteDaBusca[] {
  const porId = new Map<number, ClienteDaBusca>();
  for (const cliente of clientes) {
    const visto = porId.get(cliente.id);
    porId.set(cliente.id, visto === undefined ? cliente : { ...visto, contatos: [...visto.contatos, ...cliente.contatos] });
  }
  return [...porId.values()].slice(0, CANDIDATOS_NO_MAXIMO);
}

/** Só dígitos, sem o `+`: é o que `buscar_clientes` recebe em `q`. */
export function digitosDoTelefone(telefone: Telefone): string {
  return telefone.slice(1);
}

/**
 * O mesmo celular do Brasil com e sem o nono dígito: `+55 DD 9XXXXXXXX` e `+55 DD XXXXXXXX`.
 * Fixo (começa em 2 a 5) e número de fora não têm variante.
 */
export function varianteDoNove(telefone: Telefone): Telefone | null {
  const celularComNove = /^\+55([1-9]\d)9([6-9]\d{7})$/.exec(telefone);
  if (celularComNove !== null) return lerTelefone(`+55${celularComNove[1]}${celularComNove[2]}`);
  const celularSemNove = /^\+55([1-9]\d)([6-9]\d{7})$/.exec(telefone);
  return celularSemNove === null ? null : lerTelefone(`+55${celularSemNove[1]}9${celularSemNove[2]}`);
}

/** Os dígitos com que um contato pode ter guardado o número: com 55 e DDD, ou só com o DDD. */
function formasDoNumero(telefone: Telefone): readonly string[] {
  const digitos = digitosDoTelefone(telefone);
  return digitos.startsWith("55") ? [digitos, digitos.slice(2)] : [digitos];
}

/** Algum contato do cliente tem este número, depois de reduzido a dígitos (máscara, espaço e `+` saem). */
function algumContatoTem(cliente: ClienteDaBusca, telefone: Telefone): boolean {
  const formas = formasDoNumero(telefone);
  return cliente.contatos.some((contato) => contato.telefone !== null && formas.includes(contato.telefone.replace(/\D/g, "")));
}

/** Algum contato do cliente tem este endereço, sem espaço em volta e sem diferença de maiúscula. */
function algumContatoTemOEmail(cliente: ClienteDaBusca, endereco: EnderecoEmail): boolean {
  const procurado = endereco.trim().toLowerCase();
  return cliente.contatos.some((contato) => contato.email !== null && contato.email.trim().toLowerCase() === procurado);
}

/** Com o que se prova de quem é o contato da conversa: o telefone, ou o endereço do remetente. */
export type ProvaDeVinculo = { readonly canal: "whatsapp"; readonly telefone: Telefone } | { readonly canal: "email"; readonly endereco: EnderecoEmail };

function decidirPeloEmail(endereco: EnderecoEmail, busca: readonly ClienteDaBusca[]): DecisaoDeVinculo {
  const clientes = semRepetidos(busca);
  const [unico] = clientes;
  if (unico !== undefined && clientes.length === 1) {
    return algumContatoTemOEmail(unico, endereco)
      ? { estado: "auto", cliente: comoCandidato(unico) }
      : { estado: "ambiguo", motivo: "sem_prova_do_email", candidatos: [comoCandidato(unico)] };
  }
  if (clientes.length > 1) return { estado: "ambiguo", motivo: "varios_clientes", candidatos: clientes.map(comoCandidato) };
  return { estado: "sem_cliente" };
}

function decidirPeloTelefone(telefone: Telefone, buscaExata: readonly ClienteDaBusca[], buscaVariante: readonly ClienteDaBusca[]): DecisaoDeVinculo {
  const exatos = semRepetidos(buscaExata);
  const [unico] = exatos;
  if (unico !== undefined && exatos.length === 1) {
    if (algumContatoTem(unico, telefone)) return { estado: "auto", cliente: comoCandidato(unico) };
    const outra = varianteDoNove(telefone);
    const motivo = outra !== null && algumContatoTem(unico, outra) ? "variante_do_9" : "sem_prova_do_telefone";
    return { estado: "ambiguo", motivo, candidatos: [comoCandidato(unico)] };
  }
  if (exatos.length > 1) return { estado: "ambiguo", motivo: "varios_clientes", candidatos: exatos.map(comoCandidato) };
  // Número sem variante (fixo, de fora do Brasil): uma resposta da busca da variante não tem como ser dele.
  const variantes = varianteDoNove(telefone) === null ? [] : semRepetidos(buscaVariante);
  if (variantes.length > 0) return { estado: "ambiguo", motivo: "variante_do_9", candidatos: variantes.map(comoCandidato) };
  return { estado: "sem_cliente" };
}

/**
 * WhatsApp: um cliente pela busca exata e o telefone de um contato dele igual ao da conversa: `auto`.
 * Igual só pela variante do 9: `ambiguo` (`variante_do_9`). Sem contato com o número: `ambiguo`
 * (`sem_prova_do_telefone`), porque a busca também casa CPF, CNPJ e nome. Mais de um cliente:
 * `ambiguo`. Nenhum pelo número exato e algum pela variante do 9: `ambiguo`, mesmo com um só,
 * porque o número é de outra pessoa se o 9 não for o mesmo. Nenhum nas duas: `sem_cliente`.
 * `buscaVariante` só vale quando `buscaExata` veio vazia.
 *
 * E-mail: o mesmo, sem variante. Um cliente e o e-mail de um contato dele igual ao endereço: `auto`.
 * Um cliente sem contato com o endereço (a busca casou pelo e-mail do cadastro): `ambiguo`
 * (`sem_prova_do_email`). `buscaVariante` não entra e `variante_do_9` nunca sai.
 *
 * O telefone e o e-mail dos contatos não saem daqui.
 */
export function decidirVinculo(prova: ProvaDeVinculo, buscaExata: readonly ClienteDaBusca[], buscaVariante: readonly ClienteDaBusca[] = []): DecisaoDeVinculo {
  return prova.canal === "email" ? decidirPeloEmail(prova.endereco, buscaExata) : decidirPeloTelefone(prova.telefone, buscaExata, buscaVariante);
}

/** A decisão com os instantes que o banco guarda. A chave do e-mail é o endereço em minúsculas. */
export function vinculoDe(canal: CanalDeVinculo, chave: string, decisao: DecisaoDeVinculo, agora: Instante): VinculoDeContato {
  if (canal === "email" && lerEnderecoEmail(chave) === null) throw new TypeError("A chave de um vínculo de e-mail é um endereço.");
  const base = { canal, chave: canal === "email" ? chave.toLowerCase() : chave, conferidoEm: agora } as const;
  switch (decisao.estado) {
    case "auto":
      return { ...base, estado: "auto", cliente: comoCliente(decisao.cliente), decididoEm: null };
    case "ambiguo":
      return { ...base, estado: "ambiguo", motivo: decisao.motivo, candidatos: decisao.candidatos, decididoEm: null };
    case "sem_cliente":
      return { ...base, estado: "sem_cliente", decididoEm: null };
  }
}

const UM_DIA_MS = 86_400_000;

/** O vínculo não vale mais e o número volta a ser consultado. A decisão do vendedor nunca vence. */
export function vinculoVenceu(vinculo: VinculoDeContato, agora: Instante): boolean {
  if (vinculo.estado === "confirmado" || vinculo.estado === "nao_cliente") return false;
  const dias = vinculo.estado === "sem_cliente" ? SEM_CLIENTE_VALE_DIAS : VINCULO_VALE_DIAS;
  return Date.parse(agora) - Date.parse(vinculo.conferidoEm) >= dias * UM_DIA_MS;
}

/** A escolha do vendedor para uma conversa: um dos candidatos, ou "não é cliente". */
export type EscolhaDeVinculo = { readonly tipo: "cliente"; readonly clienteId: number } | { readonly tipo: "nao_cliente" };

/**
 * O vendedor decide sobre um vínculo `auto` ou `ambiguo`. O cliente tem de estar entre os candidatos
 * gravados. Repetir a mesma decisão devolve o mesmo vínculo, sem mudar o instante da decisão.
 * Decisão diferente da já tomada pede `desfazer` antes.
 */
export function escolherNoVinculo(vinculo: VinculoDeContato | null, escolha: EscolhaDeVinculo, agora: Instante): Resultado<VinculoDeContato> {
  if (vinculo === null || vinculo.estado === "sem_cliente") return falha("nao_encontrado", "Esta conversa não está na lista para escolher.");
  if (vinculo.estado === "nao_cliente") {
    return escolha.tipo === "nao_cliente" ? ok(vinculo) : falha("vinculo_decidido", "Esta conversa foi marcada como não cliente. Desfaça antes de escolher um cliente.");
  }
  if (vinculo.estado === "confirmado") {
    return escolha.tipo === "cliente" && escolha.clienteId === vinculo.cliente.id
      ? ok(vinculo)
      : falha("vinculo_decidido", "Esta conversa já foi vinculada a um cliente. Desfaça antes de escolher de novo.");
  }
  if (escolha.tipo === "nao_cliente") {
    // Do `auto` sai o cliente como único candidato (a UF o vínculo não guarda) e o motivo próprio do desfazer.
    const guardado = vinculo.estado === "ambiguo" ? { motivo: vinculo.motivo, candidatos: vinculo.candidatos } : { motivo: "desfeito_pelo_vendedor" as const, candidatos: [{ ...vinculo.cliente, uf: null }] };
    return ok({ canal: vinculo.canal, chave: vinculo.chave, conferidoEm: vinculo.conferidoEm, estado: "nao_cliente", decididoEm: agora, ...guardado });
  }
  const candidatos = vinculo.estado === "ambiguo" ? vinculo.candidatos.map(comoCliente) : [vinculo.cliente];
  const escolhido = candidatos.find((candidato) => candidato.id === escolha.clienteId);
  if (escolhido === undefined) return falha("nao_encontrado", "Este cliente não está entre os candidatos desta conversa.");
  return ok({ canal: vinculo.canal, chave: vinculo.chave, conferidoEm: vinculo.conferidoEm, estado: "confirmado", cliente: escolhido, decididoEm: agora });
}

/** O que o desfazer faz com o vínculo: devolve a `ambiguo` ou deixa como está. */
export type DesfazerDoVinculo =
  | { readonly acao: "voltar_a_perguntar"; readonly vinculo: VinculoDeContato }
  | { readonly acao: "manter" };

/**
 * Desfaz a decisão do vendedor, sem consultar o CRM. `nao_cliente` volta a `ambiguo` com os
 * candidatos e o motivo que guardou, valendo 30 dias a partir de `agora`. `confirmado` (Trocar
 * cliente) volta a `ambiguo` com o cliente confirmado como candidato e o motivo
 * `desfeito_pelo_vendedor`, já vencido: o `confirmado` não guarda os outros candidatos, e a próxima
 * sincronização consulta o CRM e os traz. O resto não é decisão do vendedor e fica como está, então
 * repetir o desfazer não muda o `ambiguo` que ele criou.
 */
export function desfazerNoVinculo(vinculo: VinculoDeContato | null, agora: Instante): DesfazerDoVinculo {
  if (vinculo === null || (vinculo.estado !== "nao_cliente" && vinculo.estado !== "confirmado")) return { acao: "manter" };
  const guardado =
    vinculo.estado === "nao_cliente"
      ? { motivo: vinculo.motivo, candidatos: vinculo.candidatos, conferidoEm: agora }
      : { motivo: "desfeito_pelo_vendedor" as const, candidatos: [{ ...vinculo.cliente, uf: null }], conferidoEm: somar(agora, -VINCULO_VALE_DIAS * UM_DIA_MS) };
  return { acao: "voltar_a_perguntar", vinculo: { canal: vinculo.canal, chave: vinculo.chave, estado: "ambiguo", decididoEm: null, ...guardado } };
}

/**
 * O que a consulta ao CRM grava, dado o vínculo de antes. O contato que o vendedor desfez
 * (`desfeito_pelo_vendedor`) não volta a `auto` sozinho: fica `ambiguo`, com o cliente da consulta
 * como candidato, até o vendedor escolher. As outras respostas do CRM valem como vieram.
 */
export function vinculoConsultado(atual: VinculoDeContato | undefined, consultado: VinculoDeContato): VinculoDeContato {
  if (atual?.estado !== "ambiguo" || atual.motivo !== "desfeito_pelo_vendedor" || consultado.estado !== "auto") return consultado;
  return { canal: consultado.canal, chave: consultado.chave, conferidoEm: consultado.conferidoEm, estado: "ambiguo", motivo: "desfeito_pelo_vendedor", candidatos: [{ ...consultado.cliente, uf: null }], decididoEm: null };
}
