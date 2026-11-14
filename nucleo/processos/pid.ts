import { readFileSync } from "node:fs";
import type { Registro } from "../registro";

const INTERVALO_DA_CONFERENCIA_MS = 25;
const PRAZO_DA_HORA_MS = 10_000;

function saidaDe(argv: readonly [string, ...string[]], env?: Record<string, string>): string | null {
  try {
    const feito = Bun.spawnSync([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: PRAZO_DA_HORA_MS, windowsHide: true, env });
    const texto = feito.stdout.toString().trim();
    return feito.exitCode === 0 && texto !== "" ? texto : null;
  } catch {
    return null;
  }
}

/**
 * Hora de início do processo como o sistema a registra, em texto opaco: só serve para comparar com
 * outra leitura da mesma máquina. Pid e hora juntos identificam um processo, porque o sistema
 * reaproveita o pid. `null` quando o processo não existe ou o sistema não deixou ler.
 */
export function horaDeInicio(pid: number, plataforma: NodeJS.Platform = process.platform): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (plataforma === "linux") {
    try {
      // O nome do processo vem entre parênteses e pode ter espaço; o campo 22, starttime, conta depois dele.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    } catch {
      return null;
    }
  }
  if (plataforma === "win32") {
    return saidaDe(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`]);
  }
  return saidaDe(["ps", "-o", "lstart=", "-p", String(pid)], { PATH: process.env.PATH ?? "/bin:/usr/bin", LC_ALL: "C" });
}

export function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: o processo existe e é de outro usuário.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function morreuEm(pid: number, limiteMs: number): Promise<boolean> {
  const fim = Date.now() + limiteMs;
  while (vivo(pid)) {
    if (Date.now() >= fim) return false;
    // Não é filho deste processo, então não existe `exited` para esperar: só resta conferir.
    await new Promise((resolver) => setTimeout(resolver, INTERVALO_DA_CONFERENCIA_MS));
  }
  return true;
}

/**
 * Encerra um processo que não é filho de quem chama. Devolve `true` quando ele não existe mais.
 * `educado` pede a saída com SIGINT e só força depois de 5 s; sem ele, força na hora, que é o
 * caso do processo que já não responde. No Windows não existe pedido educado: `process.kill` é
 * TerminateProcess com qualquer sinal.
 */
export async function encerrarPid(
  pid: number,
  opcoes: { readonly educado: boolean; readonly plataforma?: NodeJS.Platform; readonly registro?: Registro },
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (!vivo(pid)) return true;
  const plataforma = opcoes.plataforma ?? process.platform;
  const passos: readonly (readonly [NodeJS.Signals, number])[] =
    plataforma === "win32" ? [["SIGTERM", 5_000]] : opcoes.educado ? [["SIGINT", 5_000], ["SIGKILL", 2_000]] : [["SIGKILL", 5_000]];
  for (const [sinal, prazoMs] of passos) {
    let recusa: string | null = null;
    try {
      process.kill(pid, sinal);
    } catch (erro) {
      recusa = (erro as NodeJS.ErrnoException).code ?? "desconhecido";
    }
    const morreu = recusa === null ? await morreuEm(pid, prazoMs) : !vivo(pid);
    opcoes.registro?.info("processo.orfao_sinalizado", { pid, sinal, recusa: recusa ?? "", morreu });
    if (morreu) return true;
  }
  return false;
}
