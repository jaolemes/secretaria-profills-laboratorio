import { and, eq } from "drizzle-orm";
import type { Instante } from "../dominio";
import type { BancoAberto } from "./abrir";
import { conversasCache, crmCache, type RECURSOS_DO_CACHE } from "./esquema";

export type RecursoDoCache = (typeof RECURSOS_DO_CACHE)[number];

/** Uma linha do cache. O `json` é cru: quem lê confere a forma, porque um núcleo antigo pode ter gravado outra. */
export interface LinhaDoCache {
  readonly chave: string;
  readonly json: unknown;
  readonly lidoEm: Instante;
}

/** Troca a linha inteira. Quem chama grava só a leitura completa de uma fonte. */
export function gravarCache(banco: BancoAberto, recurso: RecursoDoCache, chave: string, json: unknown, lidoEm: Instante): void {
  const linha = { recurso, chave, json: JSON.stringify(json), lidoEm };
  banco.db
    .insert(crmCache)
    .values(linha)
    .onConflictDoUpdate({ target: [crmCache.recurso, crmCache.chave], set: { json: linha.json, lidoEm } })
    .run();
}

function deLinha(linha: typeof crmCache.$inferSelect): LinhaDoCache | null {
  try {
    return { chave: linha.chave, json: JSON.parse(linha.json) as unknown, lidoEm: linha.lidoEm as Instante };
  } catch {
    return null;
  }
}

export function lerCache(banco: BancoAberto, recurso: RecursoDoCache, chave: string): LinhaDoCache | null {
  const linha = banco.db.select().from(crmCache).where(and(eq(crmCache.recurso, recurso), eq(crmCache.chave, chave))).get();
  return linha === undefined ? null : deLinha(linha);
}

export function listarCache(banco: BancoAberto, recurso: RecursoDoCache): LinhaDoCache[] {
  return banco.db
    .select()
    .from(crmCache)
    .where(eq(crmCache.recurso, recurso))
    .all()
    .map(deLinha)
    .filter((linha): linha is LinhaDoCache => linha !== null);
}

/** Apaga o cache inteiro. Nada do vendedor mora aqui. */
export function apagarCache(banco: BancoAberto): void {
  banco.db.delete(crmCache).run();
  banco.db.delete(conversasCache).run();
}
