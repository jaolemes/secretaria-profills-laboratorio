import { and, eq, lte } from "drizzle-orm";
import type { Dia, Ignorados, Instante, MarcaDeIgnorado, TextoExterno, TipoDeIgnorado } from "../dominio";
import type { BancoAberto } from "./abrir";
import { itemIgnorado } from "./esquema";

/** Marca o item até `marca.ate`. Ignorar de novo um item já ignorado empurra a data e troca quem e o motivo. */
export function ignorarItem(banco: BancoAberto, marca: MarcaDeIgnorado, agora: Instante): void {
  const campos = { ate: marca.ate, criadoEm: agora, quem: marca.quem, motivo: marca.motivo, nome: marca.nome, codigo: marca.codigo };
  banco.db
    .insert(itemIgnorado)
    .values({ tipo: marca.tipo, crmId: marca.id, ...campos })
    .onConflictDoUpdate({ target: [itemIgnorado.tipo, itemIgnorado.crmId], set: campos })
    .run();
}

/** Tira a marca. Devolve se havia uma. */
export function desfazerIgnorado(banco: BancoAberto, tipo: TipoDeIgnorado, crmId: number): boolean {
  const apagadas = banco.db.delete(itemIgnorado).where(and(eq(itemIgnorado.tipo, tipo), eq(itemIgnorado.crmId, crmId))).returning({ tipo: itemIgnorado.tipo }).all();
  return apagadas.length > 0;
}

/** As marcas que valem em `hoje`. A marca vencida (o dia `ate` chegou) sai do banco aqui. */
export function ignoradosValendo(banco: BancoAberto, hoje: Dia): Ignorados {
  banco.db.delete(itemIgnorado).where(lte(itemIgnorado.ate, hoje)).run();
  return banco.db
    .select()
    .from(itemIgnorado)
    .all()
    .map((linha) => ({
      tipo: linha.tipo,
      id: linha.crmId,
      nome: linha.nome as TextoExterno,
      codigo: linha.codigo as TextoExterno | null,
      quem: linha.quem,
      motivo: linha.motivo,
      ate: linha.ate as Dia,
    }));
}
