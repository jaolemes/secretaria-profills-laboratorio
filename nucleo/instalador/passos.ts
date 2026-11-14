import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { caminhosDosDados, fecharPastaDeDados, pastasDosDados } from "../ambiente";
import {
  BancoEmUso,
  PASTA_DO_NUCLEO,
  abrirBanco,
  bancoEmUso,
  definirBackendDoCofre,
  esquema,
  garantirInstalacao,
  migracoesPendentes,
  pendentesDoVendedor,
  prepararBanco,
  type BancoAberto,
} from "../banco";
import { escolherBackend } from "../cofre";
import type { Instante } from "../dominio";
import type { Supervisor } from "../processos";
import { instalarExecutavel, limparTemporarios, type Alvo, type TravaDeFerramentas } from "./ferramentas";
import { diferencasDoEspelho, espelharSkills } from "./skills";

export interface ContextoDaInstalacao {
  readonly raizDoRepo: string;
  readonly dirDados: string;
  readonly plataforma: NodeJS.Platform;
  readonly arquitetura: NodeJS.Architecture;
  /** `os.release()`. No macOS é a versão do Darwin. */
  readonly versaoDoSistema: string;
  readonly versaoDoBun: string;
  readonly trava: TravaDeFerramentas;
  /** Roda comandos curtos. É o único jeito de abrir processo fora de `nucleo/processos`. */
  readonly supervisor: Supervisor;
  readonly sondarCofre: () => Promise<boolean>;
  readonly agora: () => Instante;
}

/**
 * `ok`: nada a fazer. `falta`: `aplicar` resolve. `depende_do_usuario`: `aplicar` não resolve,
 * e `detalhe` diz o que o vendedor ou o agente dele faz antes de rodar de novo. Quando ninguém
 * resolve, `verificar` lança.
 */
export type Verificacao =
  | { readonly situacao: "ok"; readonly detalhe: string }
  | { readonly situacao: "falta"; readonly detalhe: string }
  | { readonly situacao: "depende_do_usuario"; readonly detalhe: string };

export interface Passo {
  readonly id: string;
  /** Passos que precisam ter terminado bem antes deste rodar. */
  readonly depende: readonly string[];
  /** Não muda nada. */
  verificar(ctx: ContextoDaInstalacao): Promise<Verificacao>;
  /** Só roda depois de `falta`. O passo conta como feito quando `verificar` passa logo depois. */
  aplicar(ctx: ContextoDaInstalacao): Promise<void>;
}

export type ResultadoDoPasso = "feito" | "ja_estava" | "falhou" | "depende_do_usuario";

export interface RelatorioDeInstalacao {
  pronto: boolean;
  passos: Array<{ id: string; resultado: ResultadoDoPasso; detalhe: string }>;
}

const ok = (detalhe: string): Verificacao => ({ situacao: "ok", detalhe });
const falta = (detalhe: string): Verificacao => ({ situacao: "falta", detalhe });

function lerJson(caminho: string): unknown {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

const pacote = z.object({
  engines: z.object({ bun: z.string() }),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

const COMANDO_DE_ENTRADA = "rode instalar.sh (Linux e macOS) ou instalar.ps1 (Windows) na raiz do repo";

const bun: Passo = {
  id: "bun",
  depende: [],
  async verificar(ctx) {
    const pedida = pacote.parse(lerJson(path.join(ctx.raizDoRepo, "package.json"))).engines.bun;
    return Bun.semver.satisfies(ctx.versaoDoBun, pedida)
      ? ok(`Bun ${ctx.versaoDoBun}`)
      : { situacao: "depende_do_usuario", detalhe: `o Bun ${ctx.versaoDoBun} não atende ${pedida}: ${COMANDO_DE_ENTRADA}` };
  },
  async aplicar() {},
};

const dependencias: Passo = {
  id: "dependencias",
  depende: ["bun"],
  async verificar(ctx) {
    const lido = pacote.parse(lerJson(path.join(ctx.raizDoRepo, "package.json")));
    const pedidas = { ...lido.dependencies, ...lido.devDependencies };
    const erradas = Object.entries(pedidas).filter(([nome, versao]) => {
      const instalado = path.join(ctx.raizDoRepo, "node_modules", nome, "package.json");
      if (!existsSync(instalado)) return true;
      const { version } = z.object({ version: z.string() }).parse(lerJson(instalado));
      return !Bun.semver.satisfies(version, versao);
    });
    return erradas.length === 0
      ? ok(`${Object.keys(pedidas).length} pacotes nas versões do package.json`)
      : falta(`faltam ou estão em outra versão: ${erradas.map(([nome]) => nome).join(", ")}`);
  },
  async aplicar(ctx) {
    const argv = [process.execPath, "install", "--frozen-lockfile", `--cwd=${ctx.raizDoRepo}`] as const;
    const saida = await ctx.supervisor.executar({ argv, env: {} }, 600_000);
    if (saida.codigo !== 0) throw new Error(`bun install --frozen-lockfile saiu com ${saida.codigo ?? "limite de tempo"}`);
  },
};

const pastaDados: Passo = {
  id: "pasta_dados",
  depende: [],
  async verificar(ctx) {
    const erradas = pastasDosDados(ctx).filter((pasta) => {
      if (!existsSync(pasta)) return true;
      // Só o dono lê a pasta de dados. O Windows não tem esse modo; lá vale a ACL do perfil.
      return ctx.plataforma !== "win32" && (statSync(pasta).mode & 0o077) !== 0;
    });
    return erradas.length === 0 ? ok(ctx.dirDados) : falta(`criar ou fechar ${erradas.join(", ")}`);
  },
  async aplicar(ctx) {
    fecharPastaDeDados(ctx);
  },
};

/** Desde o macOS 11, a versão do macOS é a do Darwin menos 9. */
function versaoDoMacos(versaoDoDarwin: string): number {
  return Number.parseInt(versaoDoDarwin, 10) - 9;
}

async function versaoDoExecutavel(ctx: ContextoDaInstalacao, executavel: string): Promise<string | null> {
  const saida = await ctx.supervisor.executar({ argv: [executavel, "--version"], env: {} }, 15_000);
  return saida.iniciou && saida.codigo === 0 ? saida.stdout.trim() : null;
}

const wacli: Passo = {
  id: "wacli",
  depende: ["pasta_dados"],
  async verificar(ctx) {
    const { versao, macosMinimo, artefatos } = ctx.trava.wacli;
    if (ctx.plataforma === "darwin" && versaoDoMacos(ctx.versaoDoSistema) < macosMinimo) {
      return {
        situacao: "depende_do_usuario",
        detalhe: `o wacli pede macOS ${macosMinimo} ou mais novo; este Mac está no ${versaoDoMacos(ctx.versaoDoSistema)}. Atualize o macOS e rode a instalação de novo`,
      };
    }
    const alvo: Alvo = `${ctx.plataforma}-${ctx.arquitetura}`;
    if (artefatos[alvo] === undefined) throw new Error(`o wacli ${versao} não tem binário oficial para ${alvo}`);
    const executavel = caminhosDosDados(ctx).wacli;
    if (!existsSync(executavel)) return falta(`baixar o wacli ${versao}`);
    const atual = await versaoDoExecutavel(ctx, executavel);
    if (atual === `wacli ${versao}`) return ok(atual);
    const troca = `trocar ${atual ?? "um wacli que não responde"} pelo wacli ${versao}`;
    // O servidor ligado pode estar rodando o wacli, e o Windows não troca um executável em uso.
    if (bancoEmUso(caminhosDosDados(ctx).banco)) {
      return {
        situacao: "depende_do_usuario",
        detalhe: `falta ${troca}, e o servidor está ligado: rode \`bun secretaria parar\`, depois \`bun secretaria instalar\` e \`bun secretaria abrir\``,
      };
    }
    return falta(troca);
  },
  async aplicar(ctx) {
    const { versao, artefatos } = ctx.trava.wacli;
    const artefato = artefatos[`${ctx.plataforma}-${ctx.arquitetura}`];
    if (artefato === undefined) throw new Error("sem artefato para esta plataforma");
    const caminhos = caminhosDosDados(ctx);
    limparTemporarios(caminhos.bin);
    await instalarExecutavel({
      ...artefato,
      destino: caminhos.wacli,
      plataforma: ctx.plataforma,
      async conferir(novo) {
        const atual = await versaoDoExecutavel(ctx, novo);
        if (atual !== `wacli ${versao}`) throw new Error(`o wacli baixado respondeu ${atual ?? "nada"} ao --version`);
      },
    });
  },
};

const PASTA_DO_VENDEDOR = (ctx: ContextoDaInstalacao) => path.join(ctx.raizDoRepo, "meu", "migracoes");

/** `null` quando o servidor está ligado: ele é o dono do banco e migra ao subir. */
function abrirSeLivre(ctx: ContextoDaInstalacao): BancoAberto | null {
  try {
    return abrirBanco(caminhosDosDados(ctx).banco);
  } catch (erro) {
    if (erro instanceof BancoEmUso) return null;
    throw erro;
  }
}

const banco: Passo = {
  id: "banco",
  depende: ["pasta_dados"],
  async verificar(ctx) {
    if (!existsSync(caminhosDosDados(ctx).banco)) return falta("criar o banco");
    const aberto = abrirSeLivre(ctx);
    if (aberto === null) return ok("o servidor está ligado e cuida das migrações");
    try {
      const doVendedor = pendentesDoVendedor({ caminhoDoVendedor: caminhosDosDados(ctx).bancoDoVendedor, pastaDoVendedor: PASTA_DO_VENDEDOR(ctx) });
      const pendentes = [
        ...migracoesPendentes(aberto.sqlite, "nucleo", PASTA_DO_NUCLEO).map((tag) => `nucleo/${tag}`),
        ...doVendedor.map((tag) => `meu/${tag}`),
      ];
      return pendentes.length === 0 ? ok("sem migração pendente") : falta(`aplicar ${pendentes.join(", ")}`);
    } finally {
      aberto.fechar();
    }
  },
  async aplicar(ctx) {
    const caminhos = caminhosDosDados(ctx);
    prepararBanco({
      caminho: caminhos.banco,
      caminhoDoVendedor: caminhos.bancoDoVendedor,
      dirBackups: caminhos.backups,
      pastaDoVendedor: PASTA_DO_VENDEDOR(ctx),
      agora: ctx.agora(),
    }).fechar();
  },
};

const cofre: Passo = {
  id: "cofre",
  depende: ["banco"],
  async verificar(ctx) {
    const aberto = abrirSeLivre(ctx);
    if (aberto === null) return ok("o servidor está ligado; o diagnóstico mostra o backend do cofre");
    try {
      const linha = aberto.db.select().from(esquema.instalacao).get();
      if (linha?.cofreBackend === undefined || linha.cofreBackend === null) return falta("sondar o chaveiro do sistema");
      return ok(linha.cofreBackend === "sistema" ? "cofre no chaveiro do sistema" : "cofre em arquivo na pasta de dados");
    } finally {
      aberto.fechar();
    }
  },
  async aplicar(ctx) {
    const backend = await escolherBackend(ctx.sondarCofre);
    const aberto = abrirBanco(caminhosDosDados(ctx).banco);
    try {
      garantirInstalacao(aberto, ctx.agora());
      definirBackendDoCofre(aberto, backend);
    } finally {
      aberto.fechar();
    }
  },
};

const skills: Passo = {
  id: "skills",
  depende: [],
  async verificar(ctx) {
    const diferencas = diferencasDoEspelho(ctx.raizDoRepo);
    return diferencas.length === 0 ? ok(".claude/skills igual às fontes") : falta(`regerar ${diferencas.length} arquivos do espelho`);
  },
  async aplicar(ctx) {
    espelharSkills(ctx.raizDoRepo);
  },
};

const doctor = z.object({ success: z.literal(true) });

const saude: Passo = {
  id: "saude",
  depende: ["wacli", "banco"],
  async verificar(ctx) {
    const caminhos = caminhosDosDados(ctx);
    const saida = await ctx.supervisor.executar(
      {
        argv: [caminhos.wacli, "--read-only", "--json", "doctor"],
        env: { WACLI_STORE_DIR: caminhos.storeDoWacli, WACLI_READONLY: "1" },
      },
      15_000,
    );
    let lido = false;
    try {
      lido = doctor.safeParse(JSON.parse(saida.stdout)).success;
    } catch {
      lido = false;
    }
    if (!lido) throw new Error(`o wacli doctor não respondeu sucesso (saída ${saida.codigo ?? "nenhuma"})`);
    return ok("o wacli responde ao doctor na store desta instalação");
  },
  async aplicar() {},
};

/** Ordem fixa. O relatório e a skill de setup seguem esta lista. */
export const PASSOS: readonly Passo[] = [bun, dependencias, pastaDados, wacli, banco, cofre, skills, saude];

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

async function rodarPasso(passo: Passo, ctx: ContextoDaInstalacao): Promise<{ resultado: ResultadoDoPasso; detalhe: string }> {
  try {
    const antes = await passo.verificar(ctx);
    if (antes.situacao === "ok") return { resultado: "ja_estava", detalhe: antes.detalhe };
    if (antes.situacao === "depende_do_usuario") return { resultado: "depende_do_usuario", detalhe: antes.detalhe };
    await passo.aplicar(ctx);
    const depois = await passo.verificar(ctx);
    return depois.situacao === "ok"
      ? { resultado: "feito", detalhe: depois.detalhe }
      : { resultado: "falhou", detalhe: `aplicado, mas ainda falta: ${depois.detalhe}` };
  } catch (erro) {
    return { resultado: "falhou", detalhe: mensagem(erro) };
  }
}

/**
 * Roda todos os passos em ordem. Um passo cujo pré-requisito não terminou bem não roda e herda
 * o resultado dele; os independentes seguem, para o relatório mostrar tudo o que falta de uma vez.
 */
export async function executarPassos(passos: readonly Passo[], ctx: ContextoDaInstalacao): Promise<RelatorioDeInstalacao> {
  const feitos = new Map<string, ResultadoDoPasso>();
  const relatorio: RelatorioDeInstalacao["passos"] = [];
  for (const passo of passos) {
    const bloqueio = passo.depende.find((id) => feitos.get(id) !== "feito" && feitos.get(id) !== "ja_estava");
    const saida =
      bloqueio === undefined
        ? await rodarPasso(passo, ctx)
        : {
            resultado: feitos.get(bloqueio) === "depende_do_usuario" ? ("depende_do_usuario" as const) : ("falhou" as const),
            detalhe: `não rodou: espera o passo ${bloqueio}`,
          };
    feitos.set(passo.id, saida.resultado);
    relatorio.push({ id: passo.id, ...saida });
  }
  return { pronto: relatorio.every(({ resultado }) => resultado === "feito" || resultado === "ja_estava"), passos: relatorio };
}
