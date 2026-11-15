import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAVES_PUBLICAS,
  LISTA_DO_PACOTE,
  conferirPacote,
  escreverManifesto,
  extrairPacote,
  lerManifesto,
  montarPacote,
} from "../../nucleo/atualizacao";

const REPO = join(import.meta.dir, "..", "..");
const PASTA_DOS_WORKFLOWS = join(REPO, ".github", "workflows");

interface Passo {
  readonly uses?: string;
  readonly run?: string;
}

interface Job {
  readonly "timeout-minutes"?: unknown;
  readonly permissions?: Record<string, string>;
  readonly environment?: unknown;
  readonly needs?: unknown;
  readonly strategy?: { readonly matrix?: { readonly os?: unknown } };
  readonly steps: readonly Passo[];
}

interface Workflow {
  readonly on: unknown;
  readonly permissions?: Record<string, string>;
  readonly jobs: Record<string, Job>;
}

const workflows = new Map<string, Workflow>(
  readdirSync(PASTA_DOS_WORKFLOWS)
    .filter((nome) => /\.ya?ml$/.test(nome))
    .map((nome) => [nome, Bun.YAML.parse(readFileSync(join(PASTA_DOS_WORKFLOWS, nome), "utf8")) as Workflow]),
);

function jobs(): [string, Job][] {
  return [...workflows].flatMap(([nome, workflow]) => Object.entries(workflow.jobs).map(([id, job]): [string, Job] => [`${nome}:${id}`, job]));
}

describe("workflows do GitHub", () => {
  test("toda ação é fixada pelo SHA do commit", () => {
    const soltas = jobs().flatMap(([id, job]) =>
      job.steps.filter((passo) => passo.uses !== undefined && !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(passo.uses)).map((passo) => `${id}: ${passo.uses}`),
    );
    expect(soltas).toEqual([]);
  });

  test("todo job tem prazo", () => {
    expect(jobs().filter(([, job]) => job["timeout-minutes"] === undefined).map(([id]) => id)).toEqual([]);
  });

  test("só o job que publica a release escreve no repo", () => {
    const comEscrita: string[] = [];
    for (const [nome, workflow] of workflows) {
      if (workflow.permissions === undefined) comEscrita.push(`${nome}: sem permissions no topo`);
      for (const [escopo, nivel] of Object.entries(workflow.permissions ?? {})) if (nivel !== "read") comEscrita.push(`${nome}: ${escopo} ${nivel}`);
    }
    for (const [id, job] of jobs()) {
      for (const [escopo, nivel] of Object.entries(job.permissions ?? {})) if (nivel !== "read") comEscrita.push(`${id}: ${escopo} ${nivel}`);
    }
    expect(comEscrita).toEqual(["release.yml:publicar: contents write"]);
  });

  test("nenhum comando recebe expressão do GitHub dentro do texto", () => {
    const comExpressao = jobs().flatMap(([id, job]) => job.steps.filter((passo) => passo.run?.includes("${{")).map(() => id));
    expect(comExpressao).toEqual([]);
  });
});

describe("CI", () => {
  test("a instalação pelo script e a atualização pelo botão rodam nos três sistemas", () => {
    const job = workflows.get("ci.yml")?.jobs.instalacao;
    expect(job?.strategy?.matrix?.os).toEqual(["ubuntu-latest", "macos-latest", "windows-latest"]);
    expect(job?.steps.map((passo) => passo.run)).toContain("bun testes/instalacao/pelo-script.ts");
  });
});

describe("workflow de release", () => {
  const release = workflows.get("release.yml");

  test("só roda por tag de versão", () => {
    expect(release?.on).toEqual({ push: { tags: ["v*"] } });
    expect(release?.permissions).toEqual({});
  });

  test("a chave de assinatura só aparece no job do ambiente protegido", () => {
    const comSegredo = Object.entries(release?.jobs ?? {})
      .filter(([, job]) => JSON.stringify(job).includes("secrets."))
      .map(([id]) => id);
    expect(comSegredo).toEqual(["publicar"]);
    expect(release?.jobs.publicar?.environment).toBe("release");
    expect(Object.entries(release?.jobs ?? {}).filter(([, job]) => job.environment !== undefined).map(([id]) => id)).toEqual(["publicar"]);
  });

  test("publica só depois de o pacote passar nos três sistemas", () => {
    expect(release?.jobs.publicar?.needs).toEqual(["montar", "conferir"]);
    expect(release?.jobs.conferir?.needs).toBe("montar");
    expect(release?.jobs.conferir?.strategy?.matrix?.os).toEqual(["ubuntu-latest", "macos-latest", "windows-latest"]);
  });
});

describe("pacote do repo de verdade", () => {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-conferencia-"));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  const git = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO });
  const versionados = git.stdout.toString().split("\0").filter((caminho) => caminho !== "");

  test("todo arquivo versionado entra no pacote ou é de uma pasta que fica de fora", () => {
    expect(versionados.length).toBeGreaterThan(100);
    const { pacote, sha256, lista } = montarPacote({ raiz: REPO, caminhos: versionados, versao: "9.9.9" });
    const noPacote = new Set(lista.arquivos.map(({ caminho }) => caminho));
    const deFora = versionados.filter((caminho) => !noPacote.has(caminho));
    expect(deFora.filter((caminho) => !/^(meu|\.claude\/skills|\.github)\//.test(caminho))).toEqual([]);
    expect(deFora.some((caminho) => caminho.startsWith("meu/"))).toBe(true);

    const manifesto = lerManifesto(
      escreverManifesto({ versao: "9.9.9", data: "2026-11-14", bunMinimo: "1.4.4", sha256, bytes: pacote.length, oQueMuda: ["Uma frase."] }),
    );
    if (!manifesto.ok) throw new Error(manifesto.detalhe);
    const conferencia = conferirPacote(pacote, manifesto.manifesto);
    if (!conferencia.ok) throw new Error(conferencia.detalhe);
    const destino = join(pasta, "nova");
    expect(extrairPacote(conferencia.pacote, destino)).toMatchObject({ ok: true });

    const diferentes = lista.arquivos.filter(({ caminho }) => !readFileSync(join(destino, caminho)).equals(readFileSync(join(REPO, caminho))));
    expect(diferentes).toEqual([]);
    expect(readdirSync(destino)).toContain(LISTA_DO_PACOTE);
    expect(readdirSync(destino)).not.toContain("meu");
  });

  test("o módulo da atualização só usa o Bun, sem pacote do npm", () => {
    const modulo = join(REPO, "nucleo", "atualizacao");
    const deFora = readdirSync(modulo)
      .filter((nome) => nome.endsWith(".ts") && !nome.endsWith(".test.ts"))
      .flatMap((nome) =>
        [...readFileSync(join(modulo, nome), "utf8").matchAll(/\bfrom\s*["']([^"']+)["']/g)]
          .map((casamento) => casamento[1] ?? "")
          .filter((alvo) => !alvo.startsWith("./") && !alvo.startsWith("node:"))
          .map((alvo) => `${nome}: ${alvo}`),
      );
    expect(deFora).toEqual([]);
  });

  test("as chaves públicas do código têm 32 bytes e no máximo uma por papel", () => {
    for (const { publica } of CHAVES_PUBLICAS) expect(Buffer.from(publica, "base64")).toHaveLength(32);
    expect(new Set(CHAVES_PUBLICAS.map(({ publica }) => publica)).size).toBe(CHAVES_PUBLICAS.length);
    expect(CHAVES_PUBLICAS.filter(({ papel }) => papel === "ativa").length).toBeLessThanOrEqual(1);
    expect(CHAVES_PUBLICAS.filter(({ papel }) => papel === "reserva").length).toBeLessThanOrEqual(1);
  });
});
