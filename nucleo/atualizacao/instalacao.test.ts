import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { retratoDaPasta } from "../../testes/falsos/instalacao-minima";
import { pacoteCom, subirReleaseFalsa, type ReleaseFalsa } from "../../testes/falsos/release";
import { instalarPelaVersao, principal, resolverDestino, type OpcoesDaInstalacao } from "./instalacao";

const MEU_INICIAL = { "AGENTS.md": "# Minhas regras\n", "README.md": "# meu/\n", "skills/.gitkeep": "", "migracoes/.gitkeep": "" };
const DA_020 = {
  "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.2.0" }),
  "entrada.ts": "console.log('0.2.0');\n",
  "nucleo/marca.txt": "0.2.0\n",
  ".claude/settings.json": "{}\n",
};

let release: ReleaseFalsa;
let base: string;
let chamadas: { argv: readonly string[]; cwd: string; tinha: string[]; quieto?: boolean }[];

beforeEach(async () => {
  release = await subirReleaseFalsa();
  base = realpathSync(mkdtempSync(join(tmpdir(), "secretaria-instalacao-")));
  chamadas = [];
});

afterEach(async () => {
  await release.parar();
  rmSync(base, { recursive: true, force: true });
});

function opcoes(destino: string, extra: Partial<OpcoesDaInstalacao> = {}): OpcoesDaInstalacao {
  return {
    destino,
    fonte: release.fonte(500),
    meuInicial: MEU_INICIAL,
    agora: new Date(2026, 10, 15, 9, 30, 12),
    async rodar(argv, cwd, quieto) {
      chamadas.push({ argv, cwd, tinha: existsSync(cwd) ? readdirSync(cwd).sort() : [], quieto });
      return 4;
    },
    avisar() {},
    ...extra,
  };
}

function escrever(pasta: string, arquivos: Readonly<Record<string, string>>): void {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const completo = join(pasta, ...caminho.split("/"));
    mkdirSync(dirname(completo), { recursive: true });
    writeFileSync(completo, conteudo);
  }
}

/** O que sobra na pasta-mãe além do destino e da cópia guardada: nada pode ficar pela metade. */
const restos = () => readdirSync(base).filter((nome) => nome.includes("instalando"));

describe("instalar pela versão marcada", () => {
  test("numa pasta nova, extrai a versão publicada e cria o esqueleto de meu/", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "secretaria-profills");

    expect(await instalarPelaVersao(opcoes(destino))).toEqual({ tipo: "instalada", versao: "0.2.0", guardada: null });

    expect(readFileSync(join(destino, "nucleo", "marca.txt"), "utf8")).toBe("0.2.0\n");
    expect(JSON.parse(readFileSync(join(destino, "arquivos-da-versao.json"), "utf8"))).toMatchObject({ versao: "0.2.0" });
    expect(readFileSync(join(destino, "meu", "AGENTS.md"), "utf8")).toBe("# Minhas regras\n");
    expect(existsSync(join(destino, "meu", "migracoes", ".gitkeep"))).toBe(true);
    expect(chamadas).toEqual([]);
    expect(restos()).toEqual([]);
  });

  test.each([
    ["sem release publicada", (r: ReleaseFalsa) => r.responder(404), "sem_versao_publicada"],
    ["sem internet", (r: ReleaseFalsa) => r.pendurar(), "sem_internet"],
    ["com o GitHub recusando", (r: ReleaseFalsa) => r.responder(429), "sem_internet"],
  ] as const)("%s, não cria nada", async (_nome, preparar, motivo) => {
    preparar(release);
    const destino = join(base, "secretaria-profills");

    expect(await instalarPelaVersao(opcoes(destino))).toMatchObject({ tipo: "recusada", motivo });
    expect(readdirSync(base)).toEqual([]);
  });

  test("assinada por uma chave que o script não conhece, recusa antes de baixar o pacote", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020), outraChave: true });

    expect(await instalarPelaVersao(opcoes(join(base, "secretaria-profills")))).toMatchObject({ tipo: "recusada", motivo: "versao_recusada" });
    expect(release.pedidosDoPacote()).toBe(0);
    expect(readdirSync(base)).toEqual([]);
  });

  test("pacote que não bate com o sha256 do manifesto é recusado sem criar a pasta", async () => {
    const pacote = pacoteCom("0.2.0", DA_020);
    const adulterado = new Uint8Array(pacote);
    adulterado[adulterado.length - 1] = (adulterado.at(-1) ?? 0) ^ 1;
    await release.publicar("0.2.0", { pacote, pacoteAdulterado: adulterado });

    expect(await instalarPelaVersao(opcoes(join(base, "secretaria-profills")))).toMatchObject({ tipo: "recusada", motivo: "pacote_recusado" });
    expect(readdirSync(base)).toEqual([]);
  });

  test("versão que pede um Bun mais novo que este é recusada", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020), bunMinimo: "99.0.0" });

    expect(await instalarPelaVersao(opcoes(join(base, "secretaria-profills")))).toMatchObject({ tipo: "recusada", motivo: "bun_antigo" });
    expect(readdirSync(base)).toEqual([]);
  });

  test("por cima de um clone antigo, para a Secretária, guarda a pasta e mantém meu/ e as permissões locais", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "secretaria-profills");
    escrever(destino, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.1.0" }),
      "velho.txt": "só o clone tem\n",
      "node_modules/x/index.js": "1\n",
      "meu/AGENTS.md": "Regras do vendedor.\r\n",
      "meu/migracoes/0001_visitas.sql": "CREATE TABLE visitas (id INTEGER PRIMARY KEY);\n",
      ".claude/settings.local.json": '{"permissions":{"allow":["Bash(ls:*)"]}}',
      ".claude/skills/bom-dia/SKILL.md": "espelho velho\n",
    });
    const meuAntes = retratoDaPasta(join(destino, "meu"));

    const desfecho = await instalarPelaVersao(opcoes(destino));

    const guardada = join(base, "secretaria-profills-antes-2026-11-15-093012");
    expect(desfecho).toEqual({ tipo: "instalada", versao: "0.2.0", guardada });
    expect(chamadas).toEqual([{ argv: [process.execPath, "secretaria", "parar", "--json"], cwd: destino, tinha: expect.arrayContaining(["velho.txt", ".git"]), quieto: true }]);
    const novos = { "README.md": expect.any(String), "skills/.gitkeep": expect.any(String), "migracoes/.gitkeep": expect.any(String) };
    expect(retratoDaPasta(join(destino, "meu"))).toEqual({ ...meuAntes, ...novos });
    expect(readFileSync(join(destino, "meu", "AGENTS.md"), "utf8")).toBe("Regras do vendedor.\r\n");
    expect(readFileSync(join(destino, "meu", "README.md"), "utf8")).toBe("# meu/\n");
    expect(readFileSync(join(destino, ".claude", "settings.local.json"), "utf8")).toBe('{"permissions":{"allow":["Bash(ls:*)"]}}');
    expect(readdirSync(destino).sort()).toEqual([".claude", "arquivos-da-versao.json", "entrada.ts", "meu", "nucleo", "package.json"]);
    expect(readFileSync(join(guardada, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(readFileSync(join(guardada, "velho.txt"), "utf8")).toBe("só o clone tem\n");
    expect(existsSync(join(guardada, "meu"))).toBe(false);
    expect(restos()).toEqual([]);
  });

  test("na versão publicada, instalada pelo pacote, não baixa de novo", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "secretaria-profills");
    await instalarPelaVersao(opcoes(destino));
    const antes = retratoDaPasta(destino);

    expect(await instalarPelaVersao(opcoes(destino))).toEqual({ tipo: "ja_estava", versao: "0.2.0" });
    expect(release.pedidosDoPacote()).toBe(1);
    expect(retratoDaPasta(destino)).toEqual(antes);
  });

  test("pasta com uma versão mais nova que a publicada fica como está", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "secretaria-profills");
    escrever(destino, { "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.3.0" }) });
    const antes = retratoDaPasta(base);

    expect(await instalarPelaVersao(opcoes(destino))).toMatchObject({ tipo: "recusada", motivo: "versao_mais_velha" });
    expect(retratoDaPasta(base)).toEqual(antes);
  });

  test("pasta com outros arquivos, que não é da Secretária, fica como está", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "documentos");
    escrever(destino, { "planilha.txt": "do vendedor\n" });

    const desfecho = await instalarPelaVersao(opcoes(destino));
    expect(desfecho).toMatchObject({ tipo: "recusada", motivo: "pasta_de_outra_coisa" });
    expect(JSON.stringify(desfecho)).not.toContain(base);
    expect(retratoDaPasta(base)).toEqual({ "documentos/planilha.txt": expect.any(String) });
  });

  test("uma troca que falha no meio põe a pasta antiga de volta, inteira", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const destino = join(base, "secretaria-profills");
    escrever(destino, {
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.1.0" }),
      "velho.txt": "só o clone tem\n",
      "meu/AGENTS.md": "Regras do vendedor.\n",
    });
    const antes = retratoDaPasta(base);
    let renames = 0;
    const renomear = (de: string, para: string) => {
      renames += 1;
      if (renames === 5) throw Object.assign(new Error("arquivo em uso"), { code: "EBUSY" });
      renameSync(de, para);
    };

    expect(await instalarPelaVersao(opcoes(destino, { renomear }))).toMatchObject({ tipo: "recusada", motivo: "troca_falhou", detalhe: "EBUSY" });
    expect(retratoDaPasta(base)).toEqual(antes);
    expect(readdirSync(base)).toEqual(["secretaria-profills"]);
  });
});

describe("o script", () => {
  test("sem pasta, instala na pasta atual quando ela é a Secretária, e numa pasta nova dentro dela quando não é", () => {
    const secretaria = join(base, "minha");
    escrever(secretaria, { "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.1.0" }) });
    expect(resolverDestino(secretaria, undefined)).toBe(secretaria);
    expect(resolverDestino(base, undefined)).toBe(join(base, "secretaria-profills"));
    expect(resolverDestino(base, "outra pasta")).toBe(join(base, "outra pasta"));
  });

  test("depois de instalar, roda as dependências, o instalar e o abrir na pasta da Secretária", async () => {
    await release.publicar("0.2.0", { pacote: pacoteCom("0.2.0", DA_020) });
    const saida: string[] = [];
    const codigo = await principal([], { fonte: release.fonte(500), meuInicial: MEU_INICIAL }, {
      cwd: base,
      agora: new Date(),
      async rodar(argv, cwd) {
        chamadas.push({ argv, cwd, tinha: [] });
        return 0;
      },
      escrever: (texto) => saida.push(texto),
    });

    const destino = join(base, "secretaria-profills");
    expect(codigo).toBe(0);
    expect(chamadas.map(({ argv, cwd }) => [argv.slice(1).join(" "), cwd])).toEqual([
      ["install --frozen-lockfile", destino],
      ["secretaria instalar", destino],
      ["secretaria abrir", destino],
    ]);
    expect(saida.join("\n")).toContain(destino);
  });

  test("sem release publicada, diz isso em palavras do vendedor e sai com erro, sem rodar nada", async () => {
    const saida: string[] = [];
    const codigo = await principal([], { fonte: release.fonte(500), meuInicial: MEU_INICIAL }, {
      cwd: base,
      agora: new Date(),
      async rodar(argv, cwd) {
        chamadas.push({ argv, cwd, tinha: [] });
        return 0;
      },
      escrever: (texto) => saida.push(texto),
    });

    expect(codigo).toBe(1);
    expect(chamadas).toEqual([]);
    expect(saida.join("\n")).toContain("Ainda não existe uma versão da Secretária publicada");
    expect(readdirSync(base)).toEqual([]);
  });
});
