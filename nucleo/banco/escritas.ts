import { and, asc, eq, sql } from "drizzle-orm";
import { falha, ok, type Instante, type Resultado, type TextoExterno } from "../dominio";
import {
  decidirEscrita,
  maisAntigoPrimeiro,
  type CartaoDaEscrita,
  type ClienteDoCartao,
  type ComandoDaEscrita,
  type DecisaoDaEscrita,
  type DecisaoRegistrada,
  type Escrita,
  type EstadoDaEscrita,
  type QuemDaEscrita,
  type SinaisDaEscrita,
  dadosCanonicos,
  ehCodigoDeErroDaEscrita,
} from "../escritas";
import type { BancoAberto, Drizzle } from "./abrir";
import { decisao, escritaCrm } from "./esquema";

type Transacao = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];
type Leitor = Drizzle | Transacao;
type Linha = typeof escritaCrm.$inferSelect;
/** O que o cartão define na linha. A `ordem` é do banco: nasce no insert e não muda. */
type LinhaDoCartao = Omit<Linha, "ordem">;

function clienteDeLinha(linha: Linha): ClienteDoCartao {
  if (linha.clienteId === null) return null;
  if (!linha.clienteConferido || linha.clienteNome === null) return { id: linha.clienteId, conferido: false };
  return { id: linha.clienteId, conferido: true, nome: linha.clienteNome as TextoExterno, cidade: linha.clienteCidade as TextoExterno | null };
}

function deLinha(linha: Linha): CartaoDaEscrita {
  const corpo = {
    id: linha.id,
    escrita: { tool: linha.tool, dados: JSON.parse(linha.payload) } as Escrita,
    hash: linha.hash,
    cliente: clienteDeLinha(linha),
    sinais: JSON.parse(linha.sinais) as SinaisDaEscrita,
    confiraOCliente: linha.confiraCliente,
    versao: linha.versao,
    criadaEm: linha.criadaEm as Instante,
    atualizadaEm: linha.atualizadaEm as Instante,
  };
  if (linha.estado === "gravado") return { ...corpo, estado: "gravado", recibo: { id: linha.crmId, link: linha.crmLink }, erro: null };
  if ((linha.estado === "falhou" || linha.estado === "falhou_incerto") && linha.erroCodigo !== null) {
    // Código que esta versão não conhece (banco gravado por uma versão mais nova) se lê como incerto: o vendedor confere no CRM, e o Meu dia não cai.
    const codigo = ehCodigoDeErroDaEscrita(linha.erroCodigo) ? linha.erroCodigo : "crm_escrita_incerta";
    return { ...corpo, estado: linha.estado, recibo: null, erro: { codigo, detalhe: linha.erroDetalhe as TextoExterno | null } };
  }
  if (linha.estado === "falhou" || linha.estado === "falhou_incerto") throw new Error(`o cartão ${linha.id} falhou sem código de erro`);
  return { ...corpo, estado: linha.estado, recibo: null, erro: null };
}

function paraLinha(cartao: CartaoDaEscrita): LinhaDoCartao {
  const cliente = cartao.cliente;
  return {
    id: cartao.id,
    tool: cartao.escrita.tool,
    payload: dadosCanonicos(cartao.escrita.dados),
    hash: cartao.hash,
    clienteId: cliente?.id ?? null,
    clienteConferido: cliente?.conferido === true,
    clienteNome: cliente?.conferido === true ? cliente.nome : null,
    clienteCidade: cliente?.conferido === true ? cliente.cidade : null,
    confiraCliente: cartao.confiraOCliente,
    sinais: JSON.stringify(cartao.sinais),
    estado: cartao.estado,
    crmId: cartao.recibo?.id ?? null,
    crmLink: cartao.recibo?.link ?? null,
    erroCodigo: cartao.erro?.codigo ?? null,
    erroDetalhe: cartao.erro?.detalhe ?? null,
    versao: cartao.versao,
    criadaEm: cartao.criadaEm,
    atualizadaEm: cartao.atualizadaEm,
  };
}

function ler(db: Leitor, id: string): CartaoDaEscrita | null {
  const linha = db.select().from(escritaCrm).where(eq(escritaCrm.id, id)).get();
  return linha === undefined ? null : deLinha(linha);
}

function decisoes(db: Leitor, escritaId: string): DecisaoRegistrada[] {
  return db
    .select()
    .from(decisao)
    .where(eq(decisao.escritaId, escritaId))
    .orderBy(asc(decisao.id))
    .all()
    .map((linha) => ({ acao: linha.acao, hash: linha.hash, em: linha.em as Instante }));
}

/**
 * Grava o cartão novo. Quando o id já existe, não grava nada e devolve o cartão que existe: o pedido
 * de propor repetido (prazo vencido, rede que caiu depois do commit) não duplica.
 */
export function inserirCartao(banco: BancoAberto, cartao: CartaoDaEscrita): { readonly inserido: boolean; readonly cartao: CartaoDaEscrita } {
  return banco.db.transaction((tx) => {
    const existente = ler(tx, cartao.id);
    if (existente !== null) return { inserido: false, cartao: existente };
    const ultima = tx.select({ ordem: sql<number | null>`max(${escritaCrm.ordem})` }).from(escritaCrm).get();
    tx.insert(escritaCrm).values({ ...paraLinha(cartao), ordem: (ultima?.ordem ?? 0) + 1 }).run();
    return { inserido: true, cartao };
  });
}

export function lerCartao(banco: BancoAberto, id: string): CartaoDaEscrita | null {
  return ler(banco.db, id);
}

/** Do mais antigo para o mais novo (`criada_em`, depois a ordem de chegada), com filtro opcional de estado. */
export function listarCartoes(banco: BancoAberto, estado?: EstadoDaEscrita): CartaoDaEscrita[] {
  const consulta = banco.db.select().from(escritaCrm);
  const filtrada = estado === undefined ? consulta : consulta.where(eq(escritaCrm.estado, estado));
  const linhas = filtrada.orderBy(asc(escritaCrm.ordem)).all();
  return linhas.map(deLinha).sort(maisAntigoPrimeiro);
}

/** As decisões do cartão, da mais antiga para a mais nova. */
export function decisoesDoCartao(banco: BancoAberto, escritaId: string): DecisaoRegistrada[] {
  return decisoes(banco.db, escritaId);
}

/** O vendedor já editou o texto: o agente não retira mais o cartão. */
export function cartaoTemEdicao(banco: BancoAberto, escritaId: string): boolean {
  return temEdicao(banco.db, escritaId);
}

function temEdicao(db: Leitor, escritaId: string): boolean {
  return db.select({ id: decisao.id }).from(decisao).where(and(eq(decisao.escritaId, escritaId), eq(decisao.acao, "editou"))).limit(1).get() !== undefined;
}

/** Alguma escrita deste cliente já tem a decisão `aprovou`, mesmo que depois tenha sido descartada. */
export function clienteJaTemEscritaAprovada(banco: BancoAberto, clienteId: number): boolean {
  return (
    banco.db
      .select({ id: decisao.id })
      .from(decisao)
      .innerJoin(escritaCrm, eq(decisao.escritaId, escritaCrm.id))
      .where(and(eq(decisao.acao, "aprovou"), eq(escritaCrm.clienteId, clienteId)))
      .limit(1)
      .get() !== undefined
  );
}

export interface PassoDaEscrita {
  readonly comando: ComandoDaEscrita;
  readonly quem: QuemDaEscrita;
}

/** A recusa de um passo carrega o resultado para fora da transação: só uma exceção a desfaz. */
class PassoRecusado extends Error {
  constructor(
    readonly passo: number,
    readonly recusa: Resultado<never>,
  ) {
    super("passo recusado");
  }
}

/**
 * Aplica uma sequência de comandos ao cartão numa transação só, tudo ou nada: se um passo é recusado, nenhum
 * dos anteriores fica gravado, nem a decisão deles. Cada passo lê o cartão que o anterior deixou, pede a decisão à regra
 * pura e grava o cartão (com `WHERE versao = <lida>`) e a decisão. Uma queda no meio também desfaz tudo: nunca fica
 * cartão mudado sem decisão nem decisão sem cartão mudado. A transação do Drizzle só desfaz com exceção.
 */
export function mudarCartaoEmSequencia(
  banco: BancoAberto,
  id: string,
  passos: readonly PassoDaEscrita[],
  agora: Instante,
): Resultado<readonly DecisaoDaEscrita[]> {
  try {
    return ok(
      banco.db.transaction((tx) => {
        const feitos: DecisaoDaEscrita[] = [];
        passos.forEach(({ comando, quem }, indice) => {
          const atual = ler(tx, id);
          if (atual === null) throw new PassoRecusado(indice, falha("nao_encontrado", `Não existe cartão com o id ${id}.`));
          const decidido = decidirEscrita(atual, comando, { quem, agora, jaEditou: temEdicao(tx, id) });
          if (!decidido.ok) throw new PassoRecusado(indice, decidido);
          // A regra já conferiu a versão; o WHERE é a mesma conferência dentro da transação.
          const mudou = tx
            .update(escritaCrm)
            .set(paraLinha(decidido.dados.cartao))
            .where(and(eq(escritaCrm.id, id), eq(escritaCrm.versao, atual.versao)))
            .returning({ id: escritaCrm.id })
            .all();
          if (mudou.length !== 1) throw new Error("o cartão mudou dentro da transação");
          if (decidido.dados.decisao !== null) tx.insert(decisao).values({ escritaId: id, ...decidido.dados.decisao }).run();
          feitos.push(decidido.dados);
        });
        return feitos;
      }),
    );
  } catch (erro) {
    if (!(erro instanceof PassoRecusado) || erro.recusa.ok) throw erro;
    // Depois do desfazer, o cartão atual é o que estava gravado antes da sequência, não o do passo intermediário.
    if (erro.passo === 0 || erro.recusa.erro.atual === undefined) return erro.recusa;
    return { ok: false, erro: { ...erro.recusa.erro, atual: ler(banco.db, id) } };
  }
}

/** Um comando só: o caso de uma sequência de um passo. */
export function mudarCartao(banco: BancoAberto, id: string, comando: ComandoDaEscrita, quem: QuemDaEscrita, agora: Instante): Resultado<DecisaoDaEscrita> {
  const feito = mudarCartaoEmSequencia(banco, id, [{ comando, quem }], agora);
  return feito.ok ? ok(feito.dados[0] as DecisaoDaEscrita) : feito;
}
