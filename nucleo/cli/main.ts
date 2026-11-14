import path from "node:path";
import { AmbienteInvalido, resolverAmbiente, type Ambiente } from "../ambiente";
import { codigoDeSaida, falha, paraOLeitor, saida, type Resultado } from "../dominio";
import { acharServidor } from "./cliente";
import { COMANDOS, opcoesAceitas, type Argumentos, type Comando, type ContextoDoCli } from "./comandos";

const RAIZ_DO_REPO = path.resolve(import.meta.dir, "..", "..");

function separar(argv: readonly string[], comValor: readonly string[]): Argumentos | string {
  const posicionais: string[] = [];
  const opcoes: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      posicionais.push(arg);
      continue;
    }
    const [nome = "", valorJunto] = arg.slice(2).split("=", 2);
    if (!comValor.includes(nome)) {
      opcoes[nome] = valorJunto ?? true;
      continue;
    }
    const valor = valorJunto ?? argv[(i += 1)];
    if (valor === undefined) return `\`--${nome}\` precisa de um valor.`;
    opcoes[nome] = valor;
  }
  return { posicionais, opcoes };
}

interface Execucao {
  readonly resultado: Resultado<unknown>;
  readonly comando: Comando | null;
  readonly emPrimeiroPlano: Promise<void> | null;
}

async function executar(argv: readonly string[]): Promise<Execucao> {
  const [nome, ...resto] = argv.filter((arg) => arg !== "--json");
  const comando = COMANDOS.find((candidato) => candidato.nome === (nome ?? "ajuda")) ?? null;
  const uso = (texto: string): Execucao => ({ resultado: falha("uso_invalido", texto), comando, emPrimeiroPlano: null });
  if (comando === null) return uso(`Comando desconhecido: ${nome}. Os comandos são ${COMANDOS.map((c) => c.nome).join(", ")}.`);
  const separados = comando.repassar ? { posicionais: resto, opcoes: {} } : separar(resto, comando.opcoesComValor ?? []);
  if (typeof separados === "string") return uso(separados);
  const aceitas = opcoesAceitas(comando);
  const desconhecida = Object.keys(separados.opcoes).find((opcao) => !aceitas.has(opcao));
  if (desconhecida !== undefined) return uso(`\`${comando.nome}\` não aceita --${desconhecida}.`);
  const interpretado = comando.interpretar(separados);
  if (!interpretado.ok) return uso(interpretado.uso);

  let ambiente: Ambiente | null = null;
  let emPrimeiroPlano: Promise<void> | null = null;
  const ctx: ContextoDoCli = {
    ambiente: () => (ambiente ??= resolverAmbiente()),
    raizDoRepo: RAIZ_DO_REPO,
    subida: { argv: [process.execPath, path.join(RAIZ_DO_REPO, "nucleo", "cli", "main.ts"), "servidor", "--json"], prazoMs: 20_000 },
    manterVivo: (ate: Promise<void>) => {
      emPrimeiroPlano = ate;
    },
  };
  try {
    let servidor = null;
    if (!comando.semServidor) {
      const achado = await acharServidor(ctx.ambiente());
      if (!achado.ok) return { resultado: achado, comando, emPrimeiroPlano: null };
      servidor = achado.dados;
    }
    const resultado = await comando.executar(interpretado.args, ctx, servidor);
    return { resultado, comando, emPrimeiroPlano };
  } catch (erro) {
    if (erro instanceof AmbienteInvalido) return { resultado: falha("ambiente_invalido", erro.message), comando, emPrimeiroPlano: null };
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    return { resultado: falha("interno", `Falha inesperada: ${detalhe}`), comando, emPrimeiroPlano: null };
  }
}

/** Com `--json`, uma linha em stdout, sempre o envelope. Sem ele, texto curto; erro vai para stderr. */
export async function principal(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  const { resultado, comando, emPrimeiroPlano } = await executar(argv);
  const final: Resultado<unknown> = resultado.ok ? resultado : { ok: false, erro: paraOLeitor(resultado.erro, "agente") };
  if (json) console.log(JSON.stringify(saida(final)));
  else if (final.ok) console.log(comando?.descrever(final.dados) ?? "");
  else {
    const atual = final.erro.atual === undefined ? "" : `\nComo está agora: ${JSON.stringify(final.erro.atual)}`;
    console.error(`${final.erro.mensagem}\n${final.erro.acao}${atual}`);
  }
  if (!final.ok) return codigoDeSaida(final.erro);
  if (emPrimeiroPlano !== null) await emPrimeiroPlano;
  return 0;
}

if (import.meta.main) process.exit(await principal(process.argv.slice(2)));
