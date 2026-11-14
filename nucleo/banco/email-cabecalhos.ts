import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import {
  SINAIS,
  type CabecalhoDaConversa,
  type CabecalhoGuardado,
  type ColetaDaConta,
  type ConhecidoDaConta,
  type ConhecidoDaPasta,
  type EnderecoEmail,
  type IdContaEmail,
  type IdDoEmail,
  type Instante,
  type PastaDeEmail,
  type Sinal,
  type TextoExterno,
} from "../dominio";
import type { BancoAberto } from "./abrir";
import { emailCabecalho, emailConta, emailCursor } from "./esquema";

/**
 * Cabeçalhos de e-mail e onde a coleta parou em cada pasta. Só cabeçalho: nenhuma função aqui
 * recebe nem devolve corpo.
 */

type Transacao = Parameters<Parameters<BancoAberto["db"]["transaction"]>[0]>[0];

/** O que a coleta de uma conta leva ao banco. */
export interface ColetaParaGravar {
  readonly contaId: IdContaEmail;
  readonly coleta: ColetaDaConta;
  /** O instante a partir do qual o e-mail está dentro da janela da conta. */
  readonly corte: Instante;
}

function gravarNaTransacao(tx: Transacao, { contaId, coleta, corte }: ColetaParaGravar, lidoEm: Instante): void {
  for (const pasta of coleta.pastas) {
    const cursor = tx.select().from(emailCursor).where(and(eq(emailCursor.contaId, contaId), eq(emailCursor.pasta, pasta.pasta))).get();
    const mesmaGeracao = cursor?.uidValidity === pasta.uidValidity;
    // `UIDVALIDITY` novo: os uids de antes apontam para outras mensagens, então a pasta recomeça.
    if (cursor !== undefined && !mesmaGeracao) {
      tx.delete(emailCabecalho).where(and(eq(emailCabecalho.contaId, contaId), eq(emailCabecalho.pasta, pasta.pasta))).run();
    }
    for (const cabecalho of pasta.cabecalhos) {
      tx.insert(emailCabecalho)
        .values({
          contaId,
          pasta: pasta.pasta,
          uid: cabecalho.uid,
          messageId: cabecalho.messageId,
          conversa: cabecalho.conversa,
          remetente: cabecalho.remetente,
          remetenteNome: cabecalho.remetenteNome,
          destinatarios: JSON.stringify(cabecalho.destinatarios),
          instante: cabecalho.instante,
          assunto: cabecalho.assunto,
          daConta: cabecalho.daConta ? 1 : 0,
          automatico: cabecalho.automatico ? 1 : 0,
          sinaisDoAssunto: JSON.stringify(cabecalho.sinaisDoAssunto),
          sinaisDoNome: JSON.stringify(cabecalho.sinaisDoNome),
        })
        .onConflictDoNothing()
        .run();
    }
    const ultimoUid = Math.max(mesmaGeracao ? (cursor?.ultimoUid ?? 0) : 0, ...pasta.cabecalhos.map((cabecalho) => cabecalho.uid));
    // Cortado no teto: a pasta ainda não foi lida inteira, e o `lido_em` de antes fica como estava.
    const lido = pasta.cortado ? (mesmaGeracao ? (cursor?.lidoEm ?? null) : null) : lidoEm;
    tx.insert(emailCursor)
      .values({ contaId, pasta: pasta.pasta, caminho: pasta.caminho, uidValidity: pasta.uidValidity, ultimoUid, lidoEm: lido })
      .onConflictDoUpdate({
        target: [emailCursor.contaId, emailCursor.pasta],
        set: { caminho: pasta.caminho, uidValidity: pasta.uidValidity, ultimoUid, lidoEm: lido },
      })
      .run();
  }
  // A pasta de enviados que o servidor deixou de ter sai inteira: sem o caminho, o corpo dela não se lê.
  if (coleta.semEnviados) {
    tx.delete(emailCabecalho).where(and(eq(emailCabecalho.contaId, contaId), eq(emailCabecalho.pasta, "enviados"))).run();
    tx.delete(emailCursor).where(and(eq(emailCursor.contaId, contaId), eq(emailCursor.pasta, "enviados"))).run();
  }
  tx.delete(emailCabecalho).where(and(eq(emailCabecalho.contaId, contaId), lt(emailCabecalho.instante, corte))).run();
}

/**
 * Grava as coletas de várias contas numa transação só, pasta por pasta, e apaga o que saiu da
 * janela. Conta que foi removida ou saiu de `conectado` desde a leitura fica de fora, em vez de derrubar a gravação.
 */
export function gravarColetasDeEmail(banco: BancoAberto, coletas: readonly ColetaParaGravar[], lidoEm: Instante): void {
  banco.db.transaction((tx) => {
    const existentes = new Set(tx.select({ id: emailConta.id }).from(emailConta).where(eq(emailConta.fase, "conectado")).all().map((linha) => linha.id));
    for (const coleta of coletas) if (existentes.has(coleta.contaId)) gravarNaTransacao(tx, coleta, lidoEm);
  });
}

export function gravarColetaDeEmail(banco: BancoAberto, contaId: IdContaEmail, coleta: ColetaDaConta, corte: Instante, lidoEm: Instante): void {
  gravarColetasDeEmail(banco, [{ contaId, coleta, corte }], lidoEm);
}

/** Os uids e o `UIDVALIDITY` que o banco tem de cada pasta da conta. A coleta pede ao servidor só o que falta. */
export function conhecidoDaConta(banco: BancoAberto, contaId: IdContaEmail): ConhecidoDaConta {
  const vazio = (): ConhecidoDaPasta => ({ caminho: null, uidValidity: null, uids: new Set() });
  const conhecido: { -readonly [P in PastaDeEmail]: ConhecidoDaPasta } = { entrada: vazio(), enviados: vazio() };
  for (const cursor of banco.db.select().from(emailCursor).where(eq(emailCursor.contaId, contaId)).all()) {
    const uids = banco.db.select({ uid: emailCabecalho.uid }).from(emailCabecalho).where(and(eq(emailCabecalho.contaId, contaId), eq(emailCabecalho.pasta, cursor.pasta))).all();
    conhecido[cursor.pasta] = { caminho: cursor.caminho, uidValidity: cursor.uidValidity, uids: new Set(uids.map((linha) => linha.uid)) };
  }
  return conhecido;
}

function listaDe<T extends string>(json: string, validos: readonly T[]): readonly T[] {
  try {
    const lido: unknown = JSON.parse(json);
    return Array.isArray(lido) ? lido.filter((item): item is T => (validos as readonly unknown[]).includes(item)) : [];
  } catch {
    return [];
  }
}

function enderecosDe(json: string): readonly EnderecoEmail[] {
  try {
    const lido: unknown = JSON.parse(json);
    return Array.isArray(lido) ? (lido.filter((item) => typeof item === "string") as EnderecoEmail[]) : [];
  } catch {
    return [];
  }
}

function deLinha(linha: typeof emailCabecalho.$inferSelect, uidValidity: string): CabecalhoGuardado {
  return { ...daConversa(linha, uidValidity), messageId: linha.messageId, destinatarios: enderecosDe(linha.destinatarios) };
}

/** O cabeçalho sem destinatários e sem `Message-ID`: o que os blocos do Meu dia e a consulta ao CRM usam. */
function daConversa(linha: typeof emailCabecalho.$inferSelect, uidValidity: string): CabecalhoDaConversa {
  return {
    contaId: linha.contaId as IdContaEmail,
    uidValidity,
    pasta: linha.pasta,
    uid: linha.uid,
    conversa: linha.conversa,
    remetente: linha.remetente as EnderecoEmail,
    remetenteNome: linha.remetenteNome as TextoExterno | null,
    instante: linha.instante as Instante,
    assunto: linha.assunto as TextoExterno | null,
    daConta: linha.daConta === 1,
    automatico: linha.automatico === 1,
    sinaisDoAssunto: listaDe<Sinal>(linha.sinaisDoAssunto, SINAIS),
    sinaisDoNome: listaDe<Sinal>(linha.sinaisDoNome, SINAIS),
  };
}

export interface FiltroDeCabecalhos {
  readonly contaId?: IdContaEmail;
  /** Endereço do remetente, em minúsculas. */
  readonly de?: EnderecoEmail;
  readonly limite: number;
}

/** Do mais novo para o mais antigo. */
export function listarCabecalhos(banco: BancoAberto, filtro: FiltroDeCabecalhos): CabecalhoGuardado[] {
  const condicoes = [
    ...(filtro.contaId === undefined ? [] : [eq(emailCabecalho.contaId, filtro.contaId)]),
    ...(filtro.de === undefined ? [] : [eq(emailCabecalho.remetente, filtro.de.toLowerCase())]),
  ];
  return banco.db
    .select({ linha: emailCabecalho, uidValidity: emailCursor.uidValidity })
    .from(emailCabecalho)
    .innerJoin(emailCursor, and(eq(emailCursor.contaId, emailCabecalho.contaId), eq(emailCursor.pasta, emailCabecalho.pasta)))
    .where(and(...condicoes))
    .orderBy(desc(emailCabecalho.instante), asc(emailCabecalho.contaId), asc(emailCabecalho.pasta), desc(emailCabecalho.uid))
    .limit(filtro.limite)
    .all()
    .map((achado) => deLinha(achado.linha, achado.uidValidity));
}

/**
 * Os cabeçalhos não automáticos de todas as contas, com o `UIDVALIDITY` da pasta, para agrupar por
 * conta e conversa. Sem `limite`: a janela da conta já limita. Não lê nem converte `destinatarios`.
 */
export function listarCabecalhosDasConversas(banco: BancoAberto): CabecalhoDaConversa[] {
  return banco.db
    .select({ linha: emailCabecalho, uidValidity: emailCursor.uidValidity })
    .from(emailCabecalho)
    .innerJoin(emailCursor, and(eq(emailCursor.contaId, emailCabecalho.contaId), eq(emailCursor.pasta, emailCabecalho.pasta)))
    .where(eq(emailCabecalho.automatico, 0))
    .all()
    .map((achado) => daConversa(achado.linha, achado.uidValidity));
}

export interface CabecalhoComCaminho {
  readonly cabecalho: CabecalhoGuardado;
  /** O caminho da pasta no servidor, para abrir e ler o corpo. */
  readonly caminho: string;
}

/** `null` quando o id não está no banco ou é de um `UIDVALIDITY` que a pasta já deixou para trás. */
export function lerCabecalhoDeEmail(banco: BancoAberto, contaId: IdContaEmail, id: IdDoEmail): CabecalhoComCaminho | null {
  const achado = banco.db
    .select({ linha: emailCabecalho, uidValidity: emailCursor.uidValidity, caminho: emailCursor.caminho })
    .from(emailCabecalho)
    .innerJoin(emailCursor, and(eq(emailCursor.contaId, emailCabecalho.contaId), eq(emailCursor.pasta, emailCabecalho.pasta)))
    .where(and(eq(emailCabecalho.contaId, contaId), eq(emailCabecalho.pasta, id.pasta), eq(emailCabecalho.uid, id.uid), eq(emailCursor.uidValidity, id.uidValidity)))
    .get();
  return achado === undefined ? null : { cabecalho: deLinha(achado.linha, achado.uidValidity), caminho: achado.caminho };
}

/**
 * Quando cada conta foi lida inteira pela última vez: o `lido_em` mais antigo entre as pastas dela.
 * A conta com alguma pasta ainda não lida inteira (cortada no teto) fica de fora.
 */
export function lidoEmDasContas(banco: BancoAberto): ReadonlyMap<IdContaEmail, Instante> {
  const resultado = new Map<IdContaEmail, Instante>();
  const incompletas = new Set<IdContaEmail>();
  for (const cursor of banco.db.select().from(emailCursor).orderBy(asc(emailCursor.contaId), asc(emailCursor.pasta)).all()) {
    const id = cursor.contaId as IdContaEmail;
    if (cursor.lidoEm === null) {
      incompletas.add(id);
      continue;
    }
    const atual = resultado.get(id);
    if (atual === undefined || cursor.lidoEm < atual) resultado.set(id, cursor.lidoEm as Instante);
  }
  for (const id of incompletas) resultado.delete(id);
  return resultado;
}

/** As contas com a caixa de entrada lida e sem cursor de enviados: o servidor não mostrou a pasta `\\Sent`. */
export function contasSemEnviados(banco: BancoAberto): ReadonlySet<IdContaEmail> {
  const pastas = new Map<IdContaEmail, Set<string>>();
  for (const cursor of banco.db.select({ contaId: emailCursor.contaId, pasta: emailCursor.pasta }).from(emailCursor).all()) {
    const id = cursor.contaId as IdContaEmail;
    pastas.set(id, (pastas.get(id) ?? new Set()).add(cursor.pasta));
  }
  return new Set([...pastas].filter(([, lidas]) => lidas.has("entrada") && !lidas.has("enviados")).map(([id]) => id));
}

/** Total de cabeçalhos guardados por conta. */
export function contarCabecalhos(banco: BancoAberto): ReadonlyMap<IdContaEmail, number> {
  const linhas = banco.db
    .select({ contaId: emailCabecalho.contaId, total: sql<number>`count(*)` })
    .from(emailCabecalho)
    .groupBy(emailCabecalho.contaId)
    .all();
  return new Map(linhas.map((linha) => [linha.contaId as IdContaEmail, linha.total]));
}

