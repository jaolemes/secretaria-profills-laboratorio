/**
 * Uma instalação mínima da Secretária numa pasta temporária, para o teste do atualizador: a 0.1.0
 * instalada pelo pacote, a 0.2.0 extraída em `.atualizacao/nova/`, um `meu/` do vendedor e uma
 * pasta de dados própria com banco de verdade. O `instalar` e o `servidor` dela são o
 * `secretaria-minima.ts`, sem painel, cofre nem wacli.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { conferirPacote, escreverManifesto, extrairPacote, lerManifesto, montarPacote } from "../../nucleo/atualizacao";
import { abrirExclusivo } from "../../nucleo/banco/abrir";
import { migrar } from "../../nucleo/banco/migrar";
import { encerrarPid, vivo } from "../../nucleo/processos";

type Arquivos = Readonly<Record<string, string | Uint8Array>>;

const REPO = join(import.meta.dir, "..", "..");
/** Como o CLI de verdade, este só carrega com o `node_modules` no lugar. */
const CLI = [
  `import "marca";`,
  `import path from "node:path";`,
  `import { principal as daMinima } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "secretaria-minima.ts")).href)};`,
  `export const principal = (argv: readonly string[]) => daMinima(path.resolve(import.meta.dir, "..", ".."), argv);`,
  `if (import.meta.main) process.exit(await principal(process.argv.slice(2)));`,
  "",
].join("\n");
const TRAVA = (versaoDoWacli: string) => JSON.stringify({ wacli: { versao: versaoDoWacli } });
const DO_REPO = (caminho: string) => readFileSync(join(REPO, caminho), "utf8");
const PACOTE = (versao: string) => JSON.stringify({ name: "secretaria-profills", version: versao, scripts: { secretaria: (JSON.parse(DO_REPO("package.json")) as { scripts: { secretaria: string } }).scripts.secretaria } });

const COMUNS: Arquivos = {
  "nucleo/cli/main.ts": CLI,
  "entrada.ts": DO_REPO("entrada.ts"),
  // Sem `node_modules`, o Bun tentaria baixar o pacote que falta: o teste não fala com a rede.
  "bunfig.toml": "[install]\nauto = \"disable\"\n",
  "nucleo/banco/migracoes/0001_base.sql": "CREATE TABLE notas (id INTEGER PRIMARY KEY, texto TEXT NOT NULL);\n",
  "docs/arquitetura.md": "# Arquitetura\n",
};

const DA_010: Arquivos = {
  ...COMUNS,
  "package.json": PACOTE("0.1.0"),
  "ferramentas.lock.json": TRAVA("0.26.0"),
  "LEIAME-ANTIGO.md": "Só a 0.1.0 tem este arquivo.\n",
  "nucleo/marca.txt": "0.1.0\n",
  "nucleo/so-na-antiga.ts": "export const antiga = true;\n",
  ".agents/skills/bom-dia/SKILL.md": "bom dia da 0.1.0\n",
  ".agents/skills/antiga/SKILL.md": "skill que saiu\n",
  ".claude/settings.json": JSON.stringify({ versao: "0.1.0" }),
};

const DA_020: Arquivos = {
  ...COMUNS,
  "package.json": PACOTE("0.2.0"),
  "ferramentas.lock.json": TRAVA("0.26.0"),
  "NOVO.md": "Só a 0.2.0 tem este arquivo.\n",
  "nucleo/marca.txt": "0.2.0\n",
  "nucleo/banco/migracoes/0002_nova.sql": "CREATE TABLE novidade (id INTEGER PRIMARY KEY);\n",
  // O atualizador de verdade vai dentro da versão nova, como no pacote real.
  "nucleo/atualizador/main.ts": DO_REPO("nucleo/atualizador/main.ts"),
  ".agents/skills/bom-dia/SKILL.md": "bom dia da 0.2.0\n",
  ".agents/skills/nova-skill/SKILL.md": "skill que chegou\n",
  ".claude/settings.json": JSON.stringify({ versao: "0.2.0" }),
};

/** O que é do vendedor ou gerado na máquina dele. A atualização nunca muda nada disto. */
const DO_VENDEDOR: Arquivos = {
  "meu/AGENTS.md": "Regras do vendedor.\r\nCom fim de linha do Windows.\r\n",
  "meu/skills/meu-coisa/SKILL.md": "skill do vendedor\n",
  "meu/migracoes/0001_visitas.sql": "CREATE TABLE visitas (id INTEGER PRIMARY KEY, cliente TEXT NOT NULL);\n",
  "meu/dados.bin": new Uint8Array([0, 255, 13, 10, 10, 0, 128]),
  ".agents/skills/meu-coisa/SKILL.md": "cópia gerada da skill do vendedor\n",
  ".claude/skills/bom-dia/SKILL.md": "espelho gerado\n",
  ".claude/settings.local.json": JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }),
  "notas-do-vendedor.txt": "arquivo solto na raiz\n",
};

function escrever(pasta: string, arquivos: Arquivos): void {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const completo = join(pasta, ...caminho.split("/"));
    mkdirSync(dirname(completo), { recursive: true });
    writeFileSync(completo, conteudo);
  }
}

/** Monta o pacote de `arquivos` e o extrai em `destino`, pelo mesmo caminho que uma versão publicada faz. */
function instalarDoPacote(fonte: string, arquivos: Arquivos, versao: string, destino: string): void {
  rmSync(fonte, { recursive: true, force: true });
  escrever(fonte, arquivos);
  const { pacote, sha256 } = montarPacote({ raiz: fonte, caminhos: Object.keys(arquivos), versao });
  const manifesto = lerManifesto(escreverManifesto({ versao, data: "2026-11-20", bunMinimo: "1.4.4", sha256, bytes: pacote.length, oQueMuda: ["Uma frase."] }));
  if (!manifesto.ok) throw new Error(manifesto.detalhe);
  const conferido = conferirPacote(pacote, manifesto.manifesto);
  if (!conferido.ok) throw new Error(conferido.detalhe);
  const extraido = extrairPacote(conferido.pacote, destino);
  if (!extraido.ok) throw new Error(extraido.detalhe);
}

/** Abre o banco da instalação e aplica as migrações que o código de `raiz` traz, como o servidor faz ao subir. */
export function migrarInstalacao(raiz: string, dirDados: string): Database {
  const banco = abrirExclusivo(join(dirDados, "secretaria.db"));
  const comum = { dirBackups: join(dirDados, "backups"), agora: new Date().toISOString() };
  try {
    migrar(banco, { ...comum, trilha: "nucleo", pasta: join(raiz, "nucleo", "banco", "migracoes") });
    const doVendedor = abrirExclusivo(join(dirDados, "meu.db"));
    try {
      migrar(doVendedor, { ...comum, trilha: "meu", pasta: join(raiz, "meu", "migracoes") });
    } finally {
      doVendedor.close(true);
    }
    return banco;
  } catch (erro) {
    banco.close(true);
    throw erro;
  }
}

/** Caminho com `/` e o sha256 de cada arquivo da pasta, sem a pasta de trabalho da atualização. */
export function retratoDaPasta(pasta: string): Record<string, string> {
  const retrato: Record<string, string> = {};
  const visitar = (dir: string) => {
    for (const nome of readdirSync(dir).sort()) {
      const completo = join(dir, nome);
      if (dir === pasta && nome === ".atualizacao") continue;
      if (statSync(completo).isDirectory()) visitar(completo);
      else retrato[relative(pasta, completo).split(sep).join("/")] = new Bun.CryptoHasher("sha256").update(readFileSync(completo)).digest("hex");
    }
  };
  if (existsSync(pasta)) visitar(pasta);
  return retrato;
}

function linhas(caminho: string, consultas: Readonly<Record<string, string>>): Record<string, unknown[]> | null {
  if (!existsSync(caminho)) return null;
  const banco = new Database(caminho, { readonly: true });
  try {
    return Object.fromEntries(Object.entries(consultas).map(([nome, sql]) => [nome, banco.query(sql).all()]));
  } finally {
    banco.close();
  }
}

export interface InstalacaoMinima {
  readonly raiz: string;
  readonly dirDados: string;
  readonly nova: string;
  /** Os arquivos que a atualização nunca muda, com o sha256 de agora. */
  doVendedor(): Record<string, string>;
  /** As migrações aplicadas, as tabelas e as linhas dos dois bancos. Só com o servidor parado. */
  retratoDosBancos(): unknown;
  /** O pid do servidor que anunciou o `servidor.json`, ou `null`. */
  pidDoServidor(): number | null;
  versaoNoAr(): Promise<string | null>;
  pararServidor(): Promise<void>;
  limpar(): Promise<void>;
}

/**
 * `naNova` acrescenta ou troca arquivos da 0.2.0: `instalar-falha` faz o `instalar` dela sair
 * com erro, e `servidor-mudo` faz o servidor dela segurar o banco sem atender.
 */
export function montarInstalacao(opcoes: { readonly naNova?: Arquivos } = {}): InstalacaoMinima {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "secretaria-atualizador-")));
  const raiz = join(base, "instalacao");
  const dirDados = join(base, "dados");
  const nova = join(raiz, ".atualizacao", "nova");

  instalarDoPacote(join(base, "fonte"), DA_010, "0.1.0", raiz);
  escrever(raiz, { ...DO_VENDEDOR, "node_modules/marca/index.js": "module.exports = '0.1.0';\n" });
  instalarDoPacote(join(base, "fonte"), { ...DA_020, ...opcoes.naNova }, "0.2.0", nova);
  escrever(nova, { "node_modules/marca/index.js": "module.exports = '0.2.0';\n" });
  rmSync(join(base, "fonte"), { recursive: true, force: true });

  mkdirSync(join(dirDados, "bin"), { recursive: true });
  writeFileSync(join(dirDados, "bin", process.platform === "win32" ? "wacli.exe" : "wacli"), "wacli da 0.1.0");
  const banco = migrarInstalacao(raiz, dirDados);
  banco.run("INSERT INTO notas (texto) VALUES ('anotado antes da atualização')");
  banco.close(true);
  const doVendedor = abrirExclusivo(join(dirDados, "meu.db"));
  doVendedor.run("INSERT INTO visitas (cliente) VALUES ('cliente do vendedor')");
  doVendedor.close(true);

  const arquivoDoServidor = join(dirDados, "servidor.json");
  const lerServidor = (): { origem: string; pid: number } | null => {
    try {
      return JSON.parse(readFileSync(arquivoDoServidor, "utf8")) as { origem: string; pid: number };
    } catch {
      return null;
    }
  };

  const instalacao: InstalacaoMinima = {
    raiz,
    dirDados,
    nova,
    doVendedor() {
      const retrato = retratoDaPasta(raiz);
      return Object.fromEntries(Object.keys(DO_VENDEDOR).map((caminho) => [caminho, retrato[caminho] ?? "ausente"]));
    },
    retratoDosBancos: () => ({
      nucleo: linhas(join(dirDados, "secretaria.db"), {
        migracoes: "SELECT tag, sha256 FROM __migracoes_nucleo ORDER BY tag",
        tabelas: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        notas: "SELECT id, texto FROM notas ORDER BY id",
      }),
      meu: linhas(join(dirDados, "meu.db"), {
        migracoes: "SELECT tag, sha256 FROM __migracoes_meu ORDER BY tag",
        visitas: "SELECT id, cliente FROM visitas ORDER BY id",
      }),
    }),
    pidDoServidor() {
      const pid = lerServidor()?.pid;
      return pid !== undefined && vivo(pid) ? pid : null;
    },
    async versaoNoAr() {
      const servidor = lerServidor();
      if (servidor === null) return null;
      try {
        const resposta = await fetch(`${servidor.origem}/api/info`, { signal: AbortSignal.timeout(3_000) });
        return ((await resposta.json()) as { dados: { versaoNucleo: string } }).dados.versaoNucleo;
      } catch {
        return null;
      }
    },
    async pararServidor() {
      const pid = instalacao.pidDoServidor();
      if (pid !== null && !(await encerrarPid(pid, { educado: false }))) throw new Error(`o servidor mínimo (pid ${pid}) não morreu`);
      rmSync(arquivoDoServidor, { force: true });
    },
    async limpar() {
      await instalacao.pararServidor();
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  return instalacao;
}
