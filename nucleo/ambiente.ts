import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { instante, type Instante } from "./dominio";

/**
 * Tudo o que muda entre a máquina do vendedor e um teste. É a única costura de teste:
 * não existe modo de teste no código, só um `Ambiente` que aponta para falsos.
 */
export interface Ambiente {
  readonly plataforma: NodeJS.Platform;
  /** Raiz do checkout do repo. */
  readonly dirRepo: string;
  /** Pasta de dados do vendedor, sempre fora do checkout. */
  readonly dirDados: string;
  readonly porta: number;
  /** argv inicial do wacli. Produção: o binário em `<dados>/bin/wacli`. Teste: `[bun, "testes/falsos/wacli.ts"]`. */
  readonly wacli: readonly string[];
  /** argv que abre uma URL para o vendedor, com a URL no fim. `null` usa o programa padrão do sistema. */
  readonly navegador: readonly string[] | null;
  /** URL do recurso MCP do CRM. */
  readonly crmRecurso: URL;
  /** URL pública do documento CIMD, que é o `client_id`. `null` faz o login cair em `crm_app_nao_liberado` sem falar com o CRM. */
  readonly crmClientId: URL | null;
  /** CA extra em PEM para o IMAP falso com TLS. Não existe opção de desligar a verificação. */
  readonly caExtra: string | null;
  readonly agora: () => Instante;
}

export const PORTA_PADRAO = 47115;
export const CRM_RECURSO_PADRAO = "https://mcp.profills.com/mcp";
/**
 * A URL do CIMD, que é o `client_id` e tem de ser igual ao `client_id` de `cliente-oauth.json`.
 * Enquanto o CRM não publicar o documento nem aceitar o endereço, o login cai em `crm_app_nao_liberado`.
 */
export const CRM_CLIENT_ID_PADRAO: string | null = "https://www.crmprofills.com.br/oauth/apps/secretaria.json";

/** Caminhos derivados da pasta de dados. Ninguém monta esses caminhos à mão. */
export function caminhosDosDados(ambiente: Pick<Ambiente, "dirDados" | "plataforma">) {
  const p = ambiente.plataforma === "win32" ? path.win32 : path.posix;
  const em = (...partes: string[]) => p.join(ambiente.dirDados, ...partes);
  return {
    banco: em("secretaria.db"),
    /** Tabelas do vendedor, criadas por `meu/migracoes`. O núcleo não guarda nada aqui. */
    bancoDoVendedor: em("meu.db"),
    backups: em("backups"),
    logs: em("logs"),
    bin: em("bin"),
    wacli: em("bin", ambiente.plataforma === "win32" ? "wacli.exe" : "wacli"),
    storeDoWacli: em("wacli"),
    servidor: em("servidor.json"),
    /** Pid do servidor desde antes de abrir o banco. É a saída de quem travou antes do `servidor.json`. */
    pid: em("servidor.pid"),
    ambiente: em("ambiente.json"),
  } as const;
}

/**
 * Cria a pasta de dados e as subpastas com modo 0700 e fecha as que já existem: só o dono lê.
 * Roda em todo caminho que cria a pasta (instalar, abrir, servidor). O Windows não tem esse
 * modo; lá vale a ACL do perfil do usuário.
 */
export function fecharPastaDeDados(ambiente: Pick<Ambiente, "dirDados" | "plataforma">): void {
  for (const pasta of pastasDosDados(ambiente)) {
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
    if (ambiente.plataforma !== "win32") chmodSync(pasta, 0o700);
  }
}

export function pastasDosDados(ambiente: Pick<Ambiente, "dirDados" | "plataforma">): string[] {
  const caminhos = caminhosDosDados(ambiente);
  return [ambiente.dirDados, caminhos.logs, caminhos.backups, caminhos.bin];
}

export class PastaDeDadosInvalida extends Error {
  constructor(
    readonly pasta: string,
    motivo: string,
  ) {
    super(`A pasta de dados ${pasta} não serve: ${motivo}`);
    this.name = "PastaDeDadosInvalida";
  }
}

export interface Sistema {
  readonly plataforma: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

/** Linux: XDG ou `~/.local/share`. macOS: `~/Library/Application Support`. Windows: `%LOCALAPPDATA%`. */
export function pastaDeDadosPadrao(sistema: Sistema): string {
  const { plataforma, env, home } = sistema;
  if (plataforma === "win32") {
    return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local"), "SecretariaProfills");
  }
  if (plataforma === "darwin") return path.posix.join(home, "Library", "Application Support", "SecretariaProfills");
  const base = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== "" ? env.XDG_DATA_HOME : path.posix.join(home, ".local", "share");
  return path.posix.join(base, "secretaria-profills");
}

function realOuResolvido(p: typeof path.posix, alvo: string, nativo: boolean): string {
  const absoluto = p.resolve(alvo);
  return nativo && existsSync(absoluto) ? realpathSync(absoluto) : absoluto;
}

/**
 * Dados dentro do checkout acabariam num commit. Compara caminhos reais, e sem diferença
 * de maiúsculas no Windows e no macOS, onde o sistema de arquivos costuma ignorá-las.
 */
export function conferirPastaDeDados(dirDados: string, dirRepo: string, plataforma: NodeJS.Platform): string {
  const p = plataforma === "win32" ? path.win32 : path.posix;
  if (!p.isAbsolute(dirDados)) throw new PastaDeDadosInvalida(dirDados, "o caminho precisa ser absoluto");
  const normalizar = (alvo: string) => {
    const real = realOuResolvido(p, alvo, plataforma === process.platform);
    return plataforma === "win32" || plataforma === "darwin" ? real.toLowerCase() : real;
  };
  const relativo = p.relative(normalizar(dirRepo), normalizar(dirDados));
  if (relativo === "" || (!relativo.startsWith("..") && !p.isAbsolute(relativo))) {
    throw new PastaDeDadosInvalida(dirDados, "ela fica dentro do checkout do repo");
  }
  return p.resolve(dirDados);
}

const urlSegura = z
  .string()
  .transform((texto, ctx) => {
    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      ctx.addIssue({ code: "custom", message: "URL inválida" });
      return z.NEVER;
    }
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      ctx.addIssue({ code: "custom", message: "precisa ser https, salvo em 127.0.0.1" });
      return z.NEVER;
    }
    return url;
  });

/** `<dados>/ambiente.json`: troca de alvos para teste e para o suporte. Nenhum campo guarda segredo. */
const arquivoDeAmbiente = z
  .object({
    porta: z.number().int().min(0).max(65_535),
    wacli: z.array(z.string().min(1)).min(1),
    navegador: z.array(z.string().min(1)).min(1),
    crmRecurso: urlSegura,
    crmClientId: urlSegura,
    /** Caminho de um arquivo PEM. */
    caExtra: z.string().min(1),
  })
  .partial()
  .strict();

export type ArquivoDeAmbiente = z.input<typeof arquivoDeAmbiente>;

/** O `ambiente.json` não serve. A mensagem diz ao vendedor o que tirar ou corrigir, sem o conteúdo do arquivo. */
export class AmbienteInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "AmbienteInvalido";
  }
}

function lerArquivoDeAmbiente(caminho: string): z.output<typeof arquivoDeAmbiente> {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new AmbienteInvalido("Não consegui ler o ambiente.json da pasta de dados.");
  }
  let cru: unknown;
  try {
    // O Notepad antigo e o `Set-Content -Encoding UTF8` do PowerShell 5.1 gravam o BOM, que o JSON.parse recusa.
    cru = JSON.parse(texto.replace(/^﻿/, ""));
  } catch {
    throw new AmbienteInvalido("O ambiente.json da pasta de dados não é um JSON válido.");
  }
  const lido = arquivoDeAmbiente.safeParse(cru);
  if (lido.success) return lido.data;
  const problema = lido.error.issues[0];
  if (problema?.code === "unrecognized_keys") {
    const sobra = problema.keys.map((campo) => `\`${campo}\``).join(", ");
    const existem = Object.keys(arquivoDeAmbiente.shape);
    const lista = `${existem.slice(0, -1).join(", ")} e ${existem.at(-1)}`;
    const campo = problema.keys.length === 1 ? `o campo ${sobra}, que não existe` : `os campos ${sobra}, que não existem`;
    throw new AmbienteInvalido(`O ambiente.json da pasta de dados tem ${campo}. Os campos que existem são ${lista}.`);
  }
  const campo = problema?.path[0];
  if (campo === undefined) throw new AmbienteInvalido("O ambiente.json da pasta de dados precisa ser um objeto JSON entre chaves.");
  // Só a mensagem de `urlSegura` é nossa e em português; a do zod vem em inglês.
  const motivo = problema?.code === "custom" ? `: ${problema.message}` : "";
  throw new AmbienteInvalido(`O campo \`${String(campo)}\` do ambiente.json da pasta de dados não serve${motivo}.`);
}

/**
 * Monta o `Ambiente` da máquina. `SECRETARIA_DADOS` troca a pasta de dados (o CI usa uma
 * pasta temporária); `<dados>/ambiente.json`, se existir, troca os alvos externos.
 */
export function resolverAmbiente(
  sistema: Sistema = { plataforma: process.platform, env: process.env, home: homedir() },
  dirRepo: string = path.resolve(import.meta.dir, ".."),
): Ambiente {
  const pedida = sistema.env.SECRETARIA_DADOS;
  const dirDados = conferirPastaDeDados(
    pedida !== undefined && pedida !== "" ? pedida : pastaDeDadosPadrao(sistema),
    dirRepo,
    sistema.plataforma,
  );
  const caminhos = caminhosDosDados({ dirDados, plataforma: sistema.plataforma });
  const extra = existsSync(caminhos.ambiente) ? lerArquivoDeAmbiente(caminhos.ambiente) : {};
  const clientIdPadrao = CRM_CLIENT_ID_PADRAO === null ? null : new URL(CRM_CLIENT_ID_PADRAO);
  return {
    plataforma: sistema.plataforma,
    dirRepo,
    dirDados,
    porta: extra.porta ?? PORTA_PADRAO,
    wacli: extra.wacli ?? [caminhos.wacli],
    navegador: extra.navegador ?? null,
    crmRecurso: extra.crmRecurso ?? new URL(CRM_RECURSO_PADRAO),
    crmClientId: extra.crmClientId ?? clientIdPadrao,
    caExtra: extra.caExtra === undefined ? null : readFileSync(extra.caExtra, "utf8"),
    agora: () => instante(new Date()),
  };
}
