import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pacote from "../../package.json";

const REPO = join(import.meta.dir, "..", "..");
const FIXADA = pacote.packageManager.replace("bun@", "");

describe("scripts de entrada", () => {
  test("a versão do Bun nos dois scripts é a do package.json", () => {
    expect(pacote.engines.bun).toBe(`>=${FIXADA}`);
    expect(readFileSync(join(REPO, "instalar.sh"), "utf8")).toContain(`BUN_VERSAO="${FIXADA}"`);
    expect(readFileSync(join(REPO, "instalar.ps1"), "utf8")).toContain(`$BunVersao = "${FIXADA}"`);
  });

  /**
   * Roda o `instalar.sh` de verdade com um `bun` e um `curl` falsos no PATH. O `bun` falso responde
   * a versão pedida e anota cada chamada; o `curl` falso entrega um "instalador" que anota a versão
   * que mandaram instalar e põe um `bun` novo em `$BUN_INSTALL/bin`.
   */
  async function rodarInstalarSh(versaoNoPath: string | null, versaoEmBunInstall: string | null) {
    const raiz = mkdtempSync(join(tmpdir(), "secretaria-entrada-"));
    const bin = join(raiz, "bin");
    const bunInstall = join(raiz, "bun-install");
    mkdirSync(bin);
    const bunFalso = (versao: string) =>
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${versao}"; exit 0; fi\necho "${versao}: $*" >> "${join(raiz, "chamadas")}"\n`;
    const executavel = (caminho: string, texto: string) => {
      writeFileSync(caminho, texto);
      chmodSync(caminho, 0o755);
    };
    if (versaoNoPath !== null) executavel(join(bin, "bun"), bunFalso(versaoNoPath));
    if (versaoEmBunInstall !== null) {
      mkdirSync(join(bunInstall, "bin"), { recursive: true });
      executavel(join(bunInstall, "bin", "bun"), bunFalso(versaoEmBunInstall));
    }
    executavel(join(raiz, "bun-instalado"), bunFalso("instalado"));
    executavel(
      join(bin, "curl"),
      `#!/bin/sh\ncat <<'FIM'\necho "$1" > "${join(raiz, "instalou")}"\nmkdir -p "${join(bunInstall, "bin")}"\ncp "${join(raiz, "bun-instalado")}" "${join(bunInstall, "bin", "bun")}"\nFIM\n`,
    );
    executavel(join(bin, "unzip"), "#!/bin/sh\nexit 0\n");
    try {
      const processo = Bun.spawn(["/bin/sh", join(REPO, "instalar.sh")], {
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: raiz, BUN_INSTALL: bunInstall },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [codigo, stderr] = await Promise.all([processo.exited, new Response(processo.stderr).text()]);
      const ler = (nome: string) => (existsSync(join(raiz, nome)) ? readFileSync(join(raiz, nome), "utf8").trim().split("\n") : []);
      return { codigo, stderr, instalou: ler("instalou"), chamadas: ler("chamadas") };
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  }

  const passos = (bun: string) => [`${bun}: install --frozen-lockfile`, `${bun}: secretaria instalar`, `${bun}: secretaria abrir`];

  test.skipIf(process.platform === "win32").each([
    ["o Bun fixado no PATH", FIXADA, null, [], FIXADA],
    ["um Bun mais novo no PATH, sem rebaixar", "1.5.0", null, [], "1.5.0"],
    ["um Bun de outra versão maior no PATH", "2.0.1", null, [], "2.0.1"],
    ["o Bun de $BUN_INSTALL quando o do PATH é velho", "1.4.3", "1.4.10", [], "1.4.10"],
    ["o Bun de $BUN_INSTALL quando não há Bun no PATH", null, FIXADA, [], FIXADA],
  ] as const)("instalar.sh usa %s", async (_nome, noPath, emBunInstall, instalou, usado) => {
    expect(await rodarInstalarSh(noPath, emBunInstall)).toEqual({ codigo: 0, stderr: "", instalou: [...instalou], chamadas: passos(usado) });
  });

  test.skipIf(process.platform === "win32").each([
    ["o Bun do PATH é velho", "1.4.3", null],
    ["não há Bun nenhum", null, null],
    ["os dois são velhos", "1.3.9", "0.9.0"],
  ] as const)("instalar.sh instala o Bun fixado quando %s", async (_nome, noPath, emBunInstall) => {
    expect(await rodarInstalarSh(noPath, emBunInstall)).toEqual({ codigo: 0, stderr: "", instalou: [`bun-v${FIXADA}`], chamadas: passos("instalado") });
  });
});
