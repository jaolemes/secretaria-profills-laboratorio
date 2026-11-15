import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CHAVES_PUBLICAS } from "../../nucleo/atualizacao";
import { ARQUIVO_DO_SCRIPT, ESQUELETO_DE_MEU, instaladorEmbutido, montarInstalador } from "../../nucleo/atualizacao/script";
import pacote from "../../package.json";

const REPO = join(import.meta.dir, "..", "..");
const FIXADA = pacote.packageManager.replace("bun@", "");
const lerScript = (tipo: "sh" | "ps1") => readFileSync(join(REPO, ARQUIVO_DO_SCRIPT[tipo]), "utf8");

describe("scripts de entrada", () => {
  test("a versão do Bun nos dois scripts é a do package.json", () => {
    expect(pacote.engines.bun).toBe(`>=${FIXADA}`);
    expect(lerScript("sh")).toContain(`BUN_VERSAO="${FIXADA}"`);
    expect(lerScript("ps1")).toContain(`$BunVersao = "${FIXADA}"`);
  });

  test("o instalador embutido nos dois scripts é o que nucleo/atualizacao monta agora (rode bun nucleo/atualizacao/script.ts)", async () => {
    const montado = await montarInstalador(REPO);
    expect(montado.length).toBeGreaterThan(1_000);
    expect(instaladorEmbutido(lerScript("sh"), "sh")).toBe(montado);
    expect(instaladorEmbutido(lerScript("ps1"), "ps1")).toBe(montado);
  });

  test("o instalador embutido aceita as chaves públicas do código e nenhuma outra", () => {
    const embutidas = [...instaladorEmbutido(lerScript("sh"), "sh").matchAll(/publica: "([A-Za-z0-9+/]{43}=)"/g)].map((casamento) => casamento[1]);
    expect(embutidas.sort()).toEqual(CHAVES_PUBLICAS.map(({ publica }) => publica).sort());
  });

  test("o esqueleto de meu/ que a instalação cria é o meu/ versionado", () => {
    const versionados = Bun.spawnSync(["git", "ls-files", "meu"], { cwd: REPO }).stdout.toString().trim().split("\n");
    expect(versionados.map((caminho) => caminho.slice("meu/".length)).sort()).toEqual([...ESQUELETO_DE_MEU].sort());
  });

  /**
   * Roda o `instalar.sh` de verdade com um `bun` e um `curl` falsos no PATH. O `bun` falso responde
   * a versão pedida, anota cada chamada e copia o arquivo que recebeu; o `curl` falso entrega um
   * "instalador" que anota a versão que mandaram instalar e põe um `bun` novo em `$BUN_INSTALL/bin`.
   */
  async function rodarInstalarSh(versaoNoPath: string | null, versaoEmBunInstall: string | null, argumentos: readonly string[] = [], mktempDoMacos = false) {
    const raiz = mkdtempSync(join(tmpdir(), "secretaria-entrada-"));
    const bin = join(raiz, "bin");
    const bunInstall = join(raiz, "bun-install");
    mkdirSync(bin);
    const bunFalso = (versao: string) =>
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${versao}"; exit 0; fi\necho "${versao}: $*" >> "${join(raiz, "chamadas")}"\ncp "$1" "${join(raiz, "recebido.js")}"\n`;
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
    if (mktempDoMacos) {
      // O mktemp do macOS, sem modelo, cria em _CS_DARWIN_USER_TEMP_DIR e ignora o TMPDIR (shell_cmds/mktemp/mktemp.c).
      const doUsuario = join(raiz, "temporaria-do-usuario");
      mkdirSync(doUsuario);
      executavel(
        join(bin, "mktemp"),
        `#!/bin/sh\nfor argumento in "$@"; do case "$argumento" in -*) ;; *) exec /usr/bin/mktemp "$@" ;; esac; done\nexec /usr/bin/mktemp -d "${doUsuario}/tmp.XXXXXXXXXX"\n`,
      );
    }
    try {
      const processo = Bun.spawn(["/bin/sh", join(REPO, "instalar.sh"), ...argumentos], {
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: raiz, BUN_INSTALL: bunInstall, TMPDIR: raiz },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [codigo, stderr] = await Promise.all([processo.exited, new Response(processo.stderr).text()]);
      const ler = (nome: string) => (existsSync(join(raiz, nome)) ? readFileSync(join(raiz, nome), "utf8").trim().split("\n") : []);
      const chamadas = ler("chamadas");
      // O arquivo do instalador mora numa pasta temporária que o script apaga ao sair.
      const temporarios = chamadas.map((chamada) => /: (\S+)\/instalar\.js/.exec(chamada)?.[1] ?? "");
      return {
        codigo,
        stderr,
        instalou: ler("instalou"),
        chamadas: chamadas.map((chamada, i) => chamada.replace(temporarios[i] ?? "", "<temporaria>")),
        recebido: existsSync(join(raiz, "recebido.js")) ? readFileSync(join(raiz, "recebido.js"), "utf8") : null,
        sobrou: temporarios.filter((pasta) => pasta === "" || existsSync(pasta) || dirname(pasta) !== raiz),
      };
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  }

  const embutido = `${instaladorEmbutido(lerScript("sh"), "sh")}\n`;
  const passos = (bun: string) => [`${bun}: <temporaria>/instalar.js`];

  test.skipIf(process.platform === "win32")("instalar.sh entrega a pasta pedida ao instalador embutido, como ele está no script", async () => {
    expect(await rodarInstalarSh(FIXADA, null, ["minha pasta"])).toEqual({
      codigo: 0,
      stderr: "",
      instalou: [],
      chamadas: [`${FIXADA}: <temporaria>/instalar.js minha pasta`],
      recebido: embutido,
      sobrou: [],
    });
  });

  test.skipIf(process.platform === "win32")("instalar.sh cria a pasta temporária no TMPDIR também com o mktemp do macOS", async () => {
    expect(await rodarInstalarSh(FIXADA, null, [], true)).toEqual({ codigo: 0, stderr: "", instalou: [], chamadas: passos(FIXADA), recebido: embutido, sobrou: [] });
  });

  test.skipIf(process.platform === "win32").each([
    ["o Bun fixado no PATH", FIXADA, null, [], FIXADA],
    ["um Bun mais novo no PATH, sem rebaixar", "1.5.0", null, [], "1.5.0"],
    ["um Bun de outra versão maior no PATH", "2.0.1", null, [], "2.0.1"],
    ["o Bun de $BUN_INSTALL quando o do PATH é velho", "1.4.3", "1.4.10", [], "1.4.10"],
    ["o Bun de $BUN_INSTALL quando não há Bun no PATH", null, FIXADA, [], FIXADA],
  ] as const)("instalar.sh usa %s", async (_nome, noPath, emBunInstall, instalou, usado) => {
    expect(await rodarInstalarSh(noPath, emBunInstall)).toEqual({ codigo: 0, stderr: "", instalou: [...instalou], chamadas: passos(usado), recebido: embutido, sobrou: [] });
  });

  test.skipIf(process.platform === "win32").each([
    ["o Bun do PATH é velho", "1.4.3", null],
    ["não há Bun nenhum", null, null],
    ["os dois são velhos", "1.3.9", "0.9.0"],
  ] as const)("instalar.sh instala o Bun fixado quando %s", async (_nome, noPath, emBunInstall) => {
    expect(await rodarInstalarSh(noPath, emBunInstall)).toEqual({ codigo: 0, stderr: "", instalou: [`bun-v${FIXADA}`], chamadas: passos("instalado"), recebido: embutido, sobrou: [] });
  });
});
