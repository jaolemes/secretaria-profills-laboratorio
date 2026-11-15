import { eq } from "drizzle-orm";
import type { Instante } from "../dominio";
import type { BancoAberto } from "./abrir";
import { conferenciaDeVersao } from "./esquema";

/** A última busca do `versao.json`, com o resultado em JSON. Quem lê o JSON é o servidor. */
export function lerConferenciaDeVersao(banco: BancoAberto): { readonly em: Instante; readonly resultado: string } | null {
  const linha = banco.db.select().from(conferenciaDeVersao).where(eq(conferenciaDeVersao.id, 1)).get();
  return linha === undefined ? null : { em: linha.em as Instante, resultado: linha.resultado };
}

export function gravarConferenciaDeVersao(banco: BancoAberto, em: Instante, resultado: unknown): void {
  const texto = JSON.stringify(resultado);
  banco.db
    .insert(conferenciaDeVersao)
    .values({ id: 1, em, resultado: texto })
    .onConflictDoUpdate({ target: conferenciaDeVersao.id, set: { em, resultado: texto } })
    .run();
}
