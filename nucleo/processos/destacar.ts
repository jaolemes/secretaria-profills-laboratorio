import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export interface Destacado {
  readonly pid: number | undefined;
  /** Código de saída, `null` enquanto vive ou quando não pôde nascer (veja `erro`). */
  saida(): number | null;
  /** Código do erro do sistema quando o processo não pôde nascer (`ENOENT`, `EACCES`), `null` senão. */
  erro(): string | null;
}

/**
 * Processo que sobrevive a quem o abriu: o servidor que `abrir` sobe e o navegador. O supervisor
 * cuida de filhos que morrem com o servidor; este caso é o contrário, e por isso usa
 * `node:child_process` com `detached`, que no Windows tira o filho do job do pai.
 */
export function destacar(argv: readonly [string, ...string[]], opcoes: { readonly saidaEm?: string; readonly cwd?: string } = {}): Destacado {
  let arquivo: number | "ignore" = "ignore";
  if (opcoes.saidaEm !== undefined) {
    mkdirSync(dirname(opcoes.saidaEm), { recursive: true });
    arquivo = openSync(opcoes.saidaEm, "a", 0o600);
  }
  const [executavel, ...args] = argv;
  const filho = spawn(executavel, args, { detached: true, stdio: ["ignore", arquivo, arquivo], windowsHide: true, cwd: opcoes.cwd });
  if (typeof arquivo === "number") closeSync(arquivo);
  let codigo: number | null = null;
  let erro: string | null = null;
  filho.on("exit", (saiu) => {
    codigo = saiu ?? 1;
  });
  filho.on("error", (falha: NodeJS.ErrnoException) => {
    erro = falha.code ?? "desconhecido";
  });
  filho.unref();
  return { pid: filho.pid, saida: () => codigo, erro: () => erro };
}
