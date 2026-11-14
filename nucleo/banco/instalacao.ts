import { eq } from "drizzle-orm";
import type { BackendDoCofre } from "../cofre";
import type { Instante } from "../dominio";
import type { BancoAberto } from "./abrir";
import { instalacao } from "./esquema";

export interface DadosDaInstalacao {
  readonly id: string;
  readonly criadaEm: Instante;
  readonly cofreBackend: BackendDoCofre | null;
}

/** Cria a linha única no primeiro boot. Nos seguintes, devolve a que existe. */
export function garantirInstalacao(
  banco: BancoAberto,
  agora: Instante,
  gerarId: () => string = () => crypto.randomUUID(),
): DadosDaInstalacao {
  banco.db.insert(instalacao).values({ id: 1, idInstalacao: gerarId(), criadaEm: agora }).onConflictDoNothing().run();
  const linha = banco.db.select().from(instalacao).where(eq(instalacao.id, 1)).get();
  if (linha === undefined) throw new Error("a linha de instalacao sumiu logo depois de criada");
  return { id: linha.idInstalacao, criadaEm: linha.criadaEm as Instante, cofreBackend: linha.cofreBackend };
}

export function definirBackendDoCofre(banco: BancoAberto, backend: BackendDoCofre): void {
  banco.db.update(instalacao).set({ cofreBackend: backend }).where(eq(instalacao.id, 1)).run();
}
