import { destacar } from "../processos";

/** Tempo para o programa de abrir URL dizer que falhou. Quem passa disso vivo segurou o navegador aberto. */
const ESPERA_MS = 2_000;
const SONDA_MS = 50;

export type AberturaDoNavegador = { readonly abriu: true } | { readonly abriu: false; readonly motivo: string };

export function programaPadrao(plataforma: NodeJS.Platform): readonly [string, ...string[]] {
  if (plataforma === "win32") return ["rundll32", "url.dll,FileProtocolHandler"];
  return plataforma === "darwin" ? ["open"] : ["xdg-open"];
}

/**
 * Abre a URL no navegador padrão, ou no programa de `navegador`. O motivo da falha cita só o
 * programa, nunca a URL: ela leva o bilhete de entrada.
 */
export async function abrirNoNavegador(
  url: string,
  navegador: readonly string[] | null,
  plataforma: NodeJS.Platform = process.platform,
): Promise<AberturaDoNavegador> {
  const [programa = "", ...args] = navegador ?? programaPadrao(plataforma);
  const filho = destacar([programa, ...args, url]);
  const fim = Date.now() + ESPERA_MS;
  while (Date.now() < fim) {
    const erro = filho.erro();
    if (erro === "ENOENT") return { abriu: false, motivo: `o programa \`${programa}\` não existe nesta máquina` };
    if (erro !== null) return { abriu: false, motivo: `o programa \`${programa}\` existe mas não pôde ser iniciado (${erro})` };
    const codigo = filho.saida();
    if (codigo === 0) return { abriu: true };
    if (codigo !== null) return { abriu: false, motivo: `o programa \`${programa}\` saiu com o código ${codigo}` };
    await Bun.sleep(SONDA_MS);
  }
  return { abriu: true };
}
