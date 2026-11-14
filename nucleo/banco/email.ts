import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  LIMITE_DE_CONTAS_DE_EMAIL,
  PROBLEMAS,
  falha,
  lerEnderecoEmail,
  lerIdContaEmail,
  lerJanela,
  ok,
  type CodigoProblema,
  type ConfigEmail,
  type ContaEmail,
  type EstadoDuravel,
  type IdContaEmail,
  type Instante,
  type JanelaDias,
  type ProblemaDe,
  type Resultado,
} from "../dominio";
import type { BancoAberto } from "./abrir";
import type { DetalheDoEvento, EventoDoHistorico } from "./conectores";
import { emailCabecalho, emailConta, emailCursor, eventoEmail, instalacao } from "./esquema";

type Linha = typeof emailConta.$inferSelect;

const LIMITE_DA_TRILHA = 500;

/** Conta gravada, com o estado durável que o servidor encontra no boot antes da sondagem. */
export interface ContaGravada {
  readonly conta: ContaEmail;
  readonly estado: EstadoDuravel<"email">;
  /** A senha desta conta ainda está na chave antiga do cofre. */
  readonly senhaLegada: boolean;
}

function problemaDe(codigo: string | null): ProblemaDe<"email"> | null {
  if (codigo === null || !Object.hasOwn(PROBLEMAS, codigo)) return null;
  return PROBLEMAS[codigo as CodigoProblema].conector === "email" ? (codigo as ProblemaDe<"email">) : null;
}

/** Linha que não forma estado válido vira `desconectado`, e a sondagem reconcilia. Linha sem conta válida some da lista. */
function deLinha(linha: Linha): ContaGravada | null {
  const id = lerIdContaEmail(linha.id);
  const endereco = lerEnderecoEmail(linha.endereco);
  const janelaDias = lerJanela(linha.janelaDias);
  if (id === null || endereco === null || janelaDias === null) return null;
  const config: ConfigEmail = { endereco, servidor: linha.servidor, porta: linha.porta, seguranca: linha.seguranca };
  const conta: ContaEmail = { id, rotulo: linha.rotulo, provedor: linha.provedor, config, janelaDias };
  let estado: EstadoDuravel<"email"> = { fase: "desconectado" };
  if (linha.fase === "conectado" && linha.verificadoEm !== null) {
    estado = { fase: "conectado", verificadoEm: linha.verificadoEm as Instante, caixaDeEntrada: null };
  } else if (linha.fase === "atencao") {
    const codigo = problemaDe(linha.codigoProblema);
    if (codigo !== null) estado = { fase: "atencao", problema: { codigo, desde: linha.atualizadoEm as Instante } };
  }
  return { conta, estado, senhaLegada: linha.senhaLegada === 1 };
}

export function listarContasEmail(banco: BancoAberto): ContaGravada[] {
  return banco.db
    .select()
    .from(emailConta)
    .orderBy(asc(emailConta.criadaEm), sql`rowid`)
    .all()
    .flatMap((linha) => deLinha(linha) ?? []);
}

function anexarEvento(tx: Pick<BancoAberto["db"], "insert" | "select" | "delete">, id: IdContaEmail, tipo: string, detalhe: DetalheDoEvento, em: Instante): void {
  tx.insert(eventoEmail).values({ contaId: id, tipo, detalhe: JSON.stringify(detalhe), em }).run();
  const recentes = tx
    .select({ id: eventoEmail.id })
    .from(eventoEmail)
    .where(eq(eventoEmail.contaId, id))
    .orderBy(desc(eventoEmail.id))
    .limit(LIMITE_DA_TRILHA);
  tx.delete(eventoEmail)
    .where(and(eq(eventoEmail.contaId, id), notInArray(eventoEmail.id, recentes)))
    .run();
}

/** Repetido sem diferença de maiúscula, como os índices únicos do SQLite. */
function conflitoDe(banco: BancoAberto, conta: Pick<ContaEmail, "rotulo"> & { readonly endereco?: string }, ignorar: IdContaEmail | null): Resultado<never> | null {
  const outras = banco.db
    .select({ id: emailConta.id, rotulo: emailConta.rotulo, endereco: emailConta.endereco })
    .from(emailConta)
    .all()
    .filter((linha) => linha.id !== ignorar);
  const mesmo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (outras.some((linha) => mesmo(linha.rotulo, conta.rotulo))) return falha("email_rotulo_repetido");
  if (conta.endereco !== undefined && outras.some((linha) => mesmo(linha.endereco, conta.endereco ?? ""))) return falha("email_endereco_repetido");
  return null;
}

/** Cria a conta em `desconectado`. Recusa rótulo ou endereço repetido e a sexta conta, numa transação. */
export function inserirContaEmail(banco: BancoAberto, conta: ContaEmail, agora: Instante): Resultado<ContaGravada> {
  return banco.db.transaction((tx) => {
    const total = tx.select({ n: sql<number>`count(*)` }).from(emailConta).get()?.n ?? 0;
    if (total >= LIMITE_DE_CONTAS_DE_EMAIL) return falha("email_limite_de_contas");
    const conflito = conflitoDe(banco, { rotulo: conta.rotulo, endereco: conta.config.endereco }, null);
    if (conflito !== null) return conflito;
    const { endereco, servidor, porta, seguranca } = conta.config;
    tx.insert(emailConta)
      .values({
        id: conta.id,
        rotulo: conta.rotulo,
        provedor: conta.provedor,
        endereco,
        servidor,
        porta,
        seguranca,
        janelaDias: conta.janelaDias,
        criadaEm: agora,
        atualizadoEm: agora,
      })
      .run();
    tx.update(instalacao).set({ emailPuladoEm: null }).where(eq(instalacao.id, 1)).run();
    anexarEvento(tx, conta.id, "adicionada", { rotulo: conta.rotulo, provedor: conta.provedor }, agora);
    return ok({ conta, estado: { fase: "desconectado" }, senhaLegada: false });
  });
}

/**
 * Uma transação: a fase da conta, a configuração nova quando um login passou com ela, e um
 * evento na trilha da conta. Na fase `desconectado`, os cabeçalhos e os cursores da conta saem. `causa` é o evento da máquina que levou a esta gravação.
 */
export function gravarContaEmail(
  banco: BancoAberto,
  id: IdContaEmail,
  estado: EstadoDuravel<"email">,
  config: ConfigEmail | undefined,
  causa: string,
  agora: Instante,
): void {
  const detalhe: Record<string, string> = { causa };
  if (estado.fase === "atencao" && estado.problema.detalhe !== undefined) detalhe.detalhe = estado.problema.detalhe;
  banco.db.transaction((tx) => {
    tx.update(emailConta)
      .set({
        fase: estado.fase,
        codigoProblema: estado.fase === "atencao" ? estado.problema.codigo : null,
        verificadoEm: estado.fase === "conectado" ? estado.verificadoEm : null,
        ...(config === undefined ? {} : { servidor: config.servidor, porta: config.porta, seguranca: config.seguranca }),
        atualizadoEm: agora,
      })
      .where(eq(emailConta.id, id))
      .run();
    anexarEvento(tx, id, estado.fase === "atencao" ? estado.problema.codigo : estado.fase, detalhe, agora);
    // Desconectar corta o acesso à conta: o que a coleta guardou dela sai junto, e a reconexão lê a janela de novo.
    if (estado.fase === "desconectado") {
      tx.delete(emailCabecalho).where(eq(emailCabecalho.contaId, id)).run();
      tx.delete(emailCursor).where(eq(emailCursor.contaId, id)).run();
    }
  });
}

export interface MudancaDaConta {
  readonly rotulo?: string;
  readonly janelaDias?: JanelaDias;
}

export function mudarContaEmail(banco: BancoAberto, id: IdContaEmail, mudanca: MudancaDaConta, agora: Instante): Resultado<null> {
  return banco.db.transaction((tx) => {
    const atual = tx.select().from(emailConta).where(eq(emailConta.id, id)).get();
    if (atual === undefined) return falha("nao_encontrado", "Esta conta de e-mail não existe mais.");
    if (mudanca.rotulo !== undefined) {
      const conflito = conflitoDe(banco, { rotulo: mudanca.rotulo }, id);
      if (conflito !== null) return conflito;
    }
    tx.update(emailConta).set({ ...mudanca, atualizadoEm: agora }).where(eq(emailConta.id, id)).run();
    anexarEvento(tx, id, "mudada", { ...mudanca }, agora);
    return ok(null);
  });
}

/** Apaga a conta e a trilha dela. A senha sai do cofre antes, por quem chama. */
export function removerContaEmail(banco: BancoAberto, id: IdContaEmail): void {
  banco.db.delete(emailConta).where(eq(emailConta.id, id)).run();
}

export function senhaLegadaMigrada(banco: BancoAberto): void {
  banco.db.update(emailConta).set({ senhaLegada: 0 }).where(eq(emailConta.senhaLegada, 1)).run();
}

export function lerEmailPulado(banco: BancoAberto): boolean {
  return (banco.db.select({ em: instalacao.emailPuladoEm }).from(instalacao).where(eq(instalacao.id, 1)).get()?.em ?? null) !== null;
}

/** Pular só vale sem conta na lista; a checagem e a escrita ficam na mesma transação. */
export function gravarEmailPulado(banco: BancoAberto, pulado: boolean, agora: Instante): Resultado<null> {
  return banco.db.transaction((tx) => {
    const total = tx.select({ n: sql<number>`count(*)` }).from(emailConta).get()?.n ?? 0;
    if (pulado && total > 0) return falha("email_pular_com_contas");
    tx.update(instalacao).set({ emailPuladoEm: pulado ? agora : null }).where(eq(instalacao.id, 1)).run();
    return ok(null);
  });
}

export function historicoDaConta(banco: BancoAberto, id: IdContaEmail, limite: number): EventoDoHistorico[] {
  return banco.db
    .select()
    .from(eventoEmail)
    .where(eq(eventoEmail.contaId, id))
    .orderBy(desc(eventoEmail.id))
    .limit(limite)
    .all()
    .map((linha) => ({ id: linha.id, tipo: linha.tipo, detalhe: JSON.parse(linha.detalhe) as DetalheDoEvento, em: linha.em as Instante }));
}
