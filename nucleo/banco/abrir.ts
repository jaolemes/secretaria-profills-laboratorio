import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import * as esquema from "./esquema";

export type Drizzle = BunSQLiteDatabase<typeof esquema>;

export interface BancoAberto {
  readonly caminho: string;
  readonly sqlite: Database;
  readonly db: Drizzle;
  fechar(): void;
}

/** Outro processo já é dono do banco. Só o servidor abre o arquivo. */
export class BancoEmUso extends Error {
  constructor(readonly caminho: string) {
    super(`O banco ${caminho} já está aberto por outro processo.`);
    this.name = "BancoEmUso";
  }
}

/**
 * Abre o SQLite como único escritor. `locking_mode=EXCLUSIVE` com WAL segura o arquivo
 * enquanto a conexão vive, então um segundo processo recebe `BancoEmUso` em vez de
 * escrever por cima. O lock é do sistema operacional e some com o processo.
 */
export function abrirExclusivo(caminho: string): Database {
  if (caminho !== ":memory:") {
    mkdirSync(dirname(caminho), { recursive: true });
    // Só o dono lê o banco. O SQLite cria o `-wal` e o `-shm` com o modo do arquivo principal.
    closeSync(openSync(caminho, "a", 0o600));
    if (process.platform !== "win32") chmodSync(caminho, 0o600);
  }
  const sqlite = new Database(caminho, { create: true, strict: true });
  try {
    sqlite.run("PRAGMA busy_timeout = 0");
    sqlite.run("PRAGMA locking_mode = EXCLUSIVE");
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("BEGIN IMMEDIATE");
    sqlite.run("COMMIT");
  } catch (erro) {
    sqlite.close();
    if ((erro as { code?: string }).code === "SQLITE_BUSY") throw new BancoEmUso(caminho);
    throw erro;
  }
  sqlite.run("PRAGMA foreign_keys = ON");
  return sqlite;
}

/** O banco do núcleo, com o esquema do Drizzle. */
export function abrirBanco(caminho: string): BancoAberto {
  const sqlite = abrirExclusivo(caminho);
  return {
    caminho,
    sqlite,
    db: drizzle({ client: sqlite, schema: esquema }),
    // Sem `true`, statement preparado pelo Drizzle e não finalizado adia o fechamento e o lock fica preso.
    fechar: () => sqlite.close(true),
  };
}

/**
 * Segura um SQLite vazio como trava entre processos, do jeito que o atualizador segura a dele.
 * `null`: outro processo vivo já a segura. O sistema solta o lock se este processo morrer.
 */
export function segurarTrava(caminho: string): { soltar(): void } | null {
  try {
    const sqlite = abrirExclusivo(caminho);
    return { soltar: () => sqlite.close() };
  } catch (erro) {
    if (erro instanceof BancoEmUso) return null;
    throw erro;
  }
}

/** Algum processo segura este banco agora? Não cria o arquivo. */
export function bancoEmUso(caminho: string): boolean {
  if (!existsSync(caminho)) return false;
  try {
    abrirExclusivo(caminho).close();
    return false;
  } catch (erro) {
    if (erro instanceof BancoEmUso) return true;
    throw erro;
  }
}
