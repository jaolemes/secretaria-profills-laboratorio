import { and, eq, lte, notInArray } from "drizzle-orm";
import { z } from "zod";
import { desfazerNoVinculo, type CanalDeVinculo, type CandidatoDeVinculo, type Dia, type Instante, type MarcaDeConversaIgnorada, type MotivoDaDuvida, type MotivoNoBanco, type Resultado, type TextoExterno, type VinculoDeContato } from "../dominio";
import type { BancoAberto, Drizzle } from "./abrir";
import { contatoVinculo, conversaIgnorada, conversasCache } from "./esquema";

type Transacao = Parameters<Parameters<Drizzle["transaction"]>[0]>[0];
type Leitor = Drizzle | Transacao;

const candidato = z.object({ id: z.number().int(), nome: z.string(), cidade: z.string().nullable(), uf: z.string().nullable() });
const candidatos = z.array(candidato).min(1);

/**
 * O CHECK de `contato_vinculo` só aceita quatro motivos, e recriar a tabela para somar um é o que
 * já gerou SQL com defeito. O motivo do e-mail vai como `sem_prova_do_telefone` e volta pelo canal.
 */
function motivoParaOBanco(motivo: MotivoDaDuvida): MotivoNoBanco {
  return motivo === "sem_prova_do_email" ? "sem_prova_do_telefone" : motivo;
}

function motivoDoBanco(canal: CanalDeVinculo, motivo: MotivoNoBanco): MotivoDaDuvida {
  return canal === "email" && motivo === "sem_prova_do_telefone" ? "sem_prova_do_email" : motivo;
}

/** O texto do banco já passou pelos CHECKs; a conferência aqui pega só o JSON de `candidatos` que um núcleo de outra versão tenha gravado. */
function deLinha(linha: typeof contatoVinculo.$inferSelect): VinculoDeContato | null {
  const base = { canal: linha.canal, chave: linha.chave, conferidoEm: linha.conferidoEm as Instante };
  const cliente = linha.clienteId === null || linha.clienteNome === null ? null : { id: linha.clienteId, nome: linha.clienteNome as TextoExterno, cidade: linha.clienteCidade as TextoExterno | null };
  switch (linha.estado) {
    case "auto":
      return cliente === null ? null : { ...base, estado: "auto", cliente, decididoEm: null };
    case "confirmado":
      return cliente === null || linha.decididoEm === null ? null : { ...base, estado: "confirmado", cliente, decididoEm: linha.decididoEm as Instante };
    case "ambiguo":
    case "nao_cliente": {
      if (linha.motivo === null || linha.candidatos === null) return null;
      let lidos: z.ZodSafeParseResult<z.infer<typeof candidatos>>;
      try {
        lidos = candidatos.safeParse(JSON.parse(linha.candidatos));
      } catch {
        return null;
      }
      if (!lidos.success) return null;
      const candidatosLidos = lidos.data as unknown as readonly CandidatoDeVinculo[];
      const motivo = motivoDoBanco(linha.canal, linha.motivo);
      if (linha.estado === "ambiguo") return { ...base, estado: "ambiguo", motivo, candidatos: candidatosLidos, decididoEm: null };
      return linha.decididoEm === null ? null : { ...base, estado: "nao_cliente", motivo, candidatos: candidatosLidos, decididoEm: linha.decididoEm as Instante };
    }
    case "sem_cliente":
      return { ...base, estado: "sem_cliente", decididoEm: null };
  }
}

function paraLinha(vinculo: VinculoDeContato): typeof contatoVinculo.$inferInsert {
  const comum = { canal: vinculo.canal, chave: vinculo.chave, estado: vinculo.estado, conferidoEm: vinculo.conferidoEm, decididoEm: vinculo.decididoEm };
  const semCliente = { clienteId: null, clienteNome: null, clienteCidade: null, candidatos: null, motivo: null };
  switch (vinculo.estado) {
    case "auto":
    case "confirmado":
      return { ...comum, ...semCliente, clienteId: vinculo.cliente.id, clienteNome: vinculo.cliente.nome, clienteCidade: vinculo.cliente.cidade };
    case "ambiguo":
    case "nao_cliente":
      return { ...comum, ...semCliente, candidatos: JSON.stringify(vinculo.candidatos), motivo: motivoParaOBanco(vinculo.motivo) };
    default:
      return { ...comum, ...semCliente };
  }
}

function ler(db: Leitor, canal: CanalDeVinculo, chave: string): VinculoDeContato | null {
  const linha = db.select().from(contatoVinculo).where(and(eq(contatoVinculo.canal, canal), eq(contatoVinculo.chave, chave))).get();
  return linha === undefined ? null : deLinha(linha);
}

export function lerVinculo(banco: BancoAberto, canal: CanalDeVinculo, chave: string): VinculoDeContato | null {
  return ler(banco.db, canal, chave);
}

/** Todos os vínculos de um canal, pela chave. Linha que não bate com a forma conta como sem vínculo. */
export function listarVinculos(banco: BancoAberto, canal: CanalDeVinculo): Map<string, VinculoDeContato> {
  const vinculos = new Map<string, VinculoDeContato>();
  for (const linha of banco.db.select().from(contatoVinculo).where(eq(contatoVinculo.canal, canal)).all()) {
    const vinculo = deLinha(linha);
    if (vinculo !== null) vinculos.set(linha.chave, vinculo);
  }
  return vinculos;
}

/**
 * Grava o que a consulta ao CRM decidiu. Número que o vendedor confirmou ou marcou como "não é
 * cliente" fica como está, mesmo que a decisão dele tenha entrado no meio da consulta: o WHERE do
 * upsert é a conferência. Devolve se gravou.
 */
export function gravarVinculoConsultado(banco: BancoAberto, vinculo: VinculoDeContato): boolean {
  const linha = paraLinha(vinculo);
  const { canal: _canal, chave: _chave, ...campos } = linha;
  return (
    banco.db
      .insert(contatoVinculo)
      .values(linha)
      .onConflictDoUpdate({ target: [contatoVinculo.canal, contatoVinculo.chave], set: campos, setWhere: notInArray(contatoVinculo.estado, ["confirmado", "nao_cliente"]) })
      .returning({ chave: contatoVinculo.chave })
      .all().length > 0
  );
}

/**
 * A decisão do vendedor sobre um número, lida e gravada na mesma transação. `decidir` é a regra
 * pura. Devolve o vínculo como ficou e se a linha mudou (repetir o mesmo pedido não muda nada).
 */
export function decidirVinculoDoVendedor(
  banco: BancoAberto,
  canal: CanalDeVinculo,
  chave: string,
  decidir: (atual: VinculoDeContato | null) => Resultado<VinculoDeContato>,
): Resultado<{ readonly vinculo: VinculoDeContato; readonly mudou: boolean }> {
  return banco.db.transaction((tx) => {
    const atual = ler(tx, canal, chave);
    const decisao = decidir(atual);
    if (!decisao.ok) return decisao;
    const mudou = atual === null || JSON.stringify(atual) !== JSON.stringify(decisao.dados);
    if (mudou) {
      const linha = paraLinha(decisao.dados);
      const { canal: _canal, chave: _chave, ...campos } = linha;
      tx.insert(contatoVinculo).values(linha).onConflictDoUpdate({ target: [contatoVinculo.canal, contatoVinculo.chave], set: campos }).run();
    }
    return { ok: true, dados: { vinculo: decisao.dados, mudou } };
  });
}

/**
 * Desfaz a decisão do vendedor sobre um número, lida e gravada na mesma transação (`desfazerNoVinculo`).
 * `desfeito` é verdadeiro quando o número ficou sem decisão do vendedor e havia o que desfazer, ou
 * já estava `ambiguo`: repetir o pedido devolve o mesmo resultado. `mudou` diz se a linha mudou.
 */
export function desfazerDecisaoDoVendedor(banco: BancoAberto, canal: CanalDeVinculo, chave: string, agora: Instante): { readonly desfeito: boolean; readonly mudou: boolean } {
  return banco.db.transaction((tx) => {
    const atual = ler(tx, canal, chave);
    const decisao = desfazerNoVinculo(atual, agora);
    if (decisao.acao === "voltar_a_perguntar") {
      const { canal: _canal, chave: _chave, ...campos } = paraLinha(decisao.vinculo);
      tx.update(contatoVinculo).set(campos).where(and(eq(contatoVinculo.canal, canal), eq(contatoVinculo.chave, chave))).run();
      return { desfeito: true, mudou: true };
    }
    return { desfeito: atual?.estado === "ambiguo", mudou: false };
  });
}

/** Marca a conversa até `marca.ate`. Ignorar de novo empurra a data e troca quem e o motivo. */
export function ignorarConversa(banco: BancoAberto, canal: CanalDeVinculo, marca: MarcaDeConversaIgnorada, agora: Instante): void {
  const campos = { ate: marca.ate, criadoEm: agora, quem: marca.quem, motivo: marca.motivo, nome: marca.nome };
  banco.db
    .insert(conversaIgnorada)
    .values({ canal, chave: marca.id, ...campos })
    .onConflictDoUpdate({ target: [conversaIgnorada.canal, conversaIgnorada.chave], set: campos })
    .run();
}

/** Tira a marca. Devolve se havia uma. */
export function desfazerConversaIgnorada(banco: BancoAberto, canal: CanalDeVinculo, chave: string): boolean {
  return (
    banco.db.delete(conversaIgnorada).where(and(eq(conversaIgnorada.canal, canal), eq(conversaIgnorada.chave, chave))).returning({ chave: conversaIgnorada.chave }).all().length > 0
  );
}

/** As marcas de conversa que valem em `hoje`. A vencida sai do banco aqui. */
export function conversasIgnoradasValendo(banco: BancoAberto, canal: CanalDeVinculo, hoje: Dia): MarcaDeConversaIgnorada[] {
  banco.db.delete(conversaIgnorada).where(lte(conversaIgnorada.ate, hoje)).run();
  return banco.db
    .select()
    .from(conversaIgnorada)
    .where(eq(conversaIgnorada.canal, canal))
    .all()
    .map((linha) => ({ tipo: "conversa", id: linha.chave, nome: linha.nome as TextoExterno, quem: linha.quem, motivo: linha.motivo, ate: linha.ate as Dia }));
}

const CHAVE_DAS_CONVERSAS = "atual";

/** Troca a leitura das conversas inteira. Quem chama grava só a leitura completa. */
export function gravarConversasLidas(banco: BancoAberto, json: unknown, lidoEm: Instante): void {
  const linha = { chave: CHAVE_DAS_CONVERSAS, json: JSON.stringify(json), lidoEm };
  banco.db.insert(conversasCache).values(linha).onConflictDoUpdate({ target: conversasCache.chave, set: { json: linha.json, lidoEm } }).run();
}

/** A última leitura das conversas, com o `json` cru: quem lê confere a forma. */
export function lerConversasLidas(banco: BancoAberto): { readonly json: unknown; readonly lidoEm: Instante } | null {
  const linha = banco.db.select().from(conversasCache).where(eq(conversasCache.chave, CHAVE_DAS_CONVERSAS)).get();
  if (linha === undefined) return null;
  try {
    return { json: JSON.parse(linha.json) as unknown, lidoEm: linha.lidoEm as Instante };
  } catch {
    return null;
  }
}
