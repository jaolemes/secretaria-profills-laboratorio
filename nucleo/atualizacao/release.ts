/**
 * Os passos do workflow de release, um por comando. Cada um lança erro em vez de publicar algo
 * que a Secretária instalada recusaria.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHAVES_PUBLICAS, type ChavePublica } from "./chaves";
import { abrirEnvelope, assinarManifesto, gerarParDeChaves } from "./envelope";
import { escreverManifesto, lerManifesto, nomeDoPacote } from "./manifesto";
import { lerNovidades } from "./novidades";
import { conferirPacote, extrairPacote, montarPacote } from "./pacote";

export interface VersaoAPublicar {
  readonly tag: string;
  readonly versao: string;
  /** Tag `vX.Y.Z-teste`: sai como release de teste, que o endereço da última versão ignora. */
  readonly deTeste: boolean;
  readonly data: string;
  readonly bunMinimo: string;
  readonly oQueMuda: readonly string[];
}

const ARQUIVO_DO_MANIFESTO = "manifesto.json";
const ARQUIVO_ASSINADO = "versao.json";
const ARQUIVO_DAS_NOTAS = "notas.md";

/** A tag, o `package.json` e o arquivo de novidades precisam dizer a mesma versão. */
export function prepararVersao(raiz: string, tag: string): VersaoAPublicar {
  const casamento = /^v(\d+\.\d+\.\d+)(-teste)?$/.exec(tag);
  if (casamento === null) throw new Error(`a tag ${JSON.stringify(tag)} precisa ser vX.Y.Z ou vX.Y.Z-teste`);
  const versao = casamento[1] ?? "";
  const pacote = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8")) as { version?: unknown; engines?: { bun?: unknown } };
  if (pacote.version !== versao) throw new Error(`a tag é da ${versao} e o package.json diz ${String(pacote.version)}`);
  const bun = /^>=(\d+\.\d+\.\d+)$/.exec(String(pacote.engines?.bun ?? ""));
  if (bun === null) throw new Error("o package.json precisa de engines.bun no formato >=X.Y.Z");
  const arquivo = path.join(raiz, "novidades", `${versao}.md`);
  if (!existsSync(arquivo)) throw new Error(`falta o arquivo de novidades da ${versao}`);
  const leitura = lerNovidades(readFileSync(arquivo, "utf8"));
  if (!leitura.ok) throw new Error(`as novidades da ${versao} estão fora da regra: ${leitura.problemas.join("; ")}`);
  if (leitura.novidades.versao !== versao) throw new Error(`o arquivo de novidades da ${versao} diz ${leitura.novidades.versao}`);
  return { tag, versao, deTeste: casamento[2] !== undefined, data: leitura.novidades.data, bunMinimo: bun[1] ?? "", oQueMuda: leitura.novidades.linhas };
}

function montar(raiz: string, tag: string, caminhos: readonly string[]): { versao: VersaoAPublicar; pacote: Uint8Array; manifesto: string } {
  const versao = prepararVersao(raiz, tag);
  const { pacote, sha256 } = montarPacote({ raiz, caminhos, versao: versao.versao });
  const manifesto = escreverManifesto({ ...versao, sha256, bytes: pacote.length });
  return { versao, pacote, manifesto };
}

/** Grava em `dir` o pacote, o manifesto ainda sem assinatura e as notas da release. */
export function montarVersao(opcoes: { readonly raiz: string; readonly tag: string; readonly caminhos: readonly string[]; readonly dir: string }): string {
  const { versao, pacote, manifesto } = montar(opcoes.raiz, opcoes.tag, opcoes.caminhos);
  mkdirSync(opcoes.dir, { recursive: true });
  writeFileSync(path.join(opcoes.dir, nomeDoPacote(versao.versao)), pacote);
  writeFileSync(path.join(opcoes.dir, ARQUIVO_DO_MANIFESTO), manifesto);
  writeFileSync(path.join(opcoes.dir, ARQUIVO_DAS_NOTAS), versao.oQueMuda.map((frase) => `- ${frase}\n`).join(""));
  return `montou ${nomeDoPacote(versao.versao)} com ${pacote.length} bytes`;
}

/** Roda em cada sistema: o pacote de `dir` bate com o manifesto e sai inteiro em `destino`. */
export function conferirVersaoMontada(opcoes: { readonly tag: string; readonly dir: string; readonly destino: string }): string {
  const leitura = lerManifesto(readFileSync(path.join(opcoes.dir, ARQUIVO_DO_MANIFESTO), "utf8"), opcoes.tag);
  if (!leitura.ok) throw new Error(`${leitura.motivo}: ${leitura.detalhe}`);
  const pacote = new Uint8Array(readFileSync(path.join(opcoes.dir, nomeDoPacote(leitura.manifesto.versao))));
  const conferencia = conferirPacote(pacote, leitura.manifesto);
  if (!conferencia.ok) throw new Error(`${conferencia.motivo}: ${conferencia.detalhe}`);
  const extracao = extrairPacote(conferencia.pacote, opcoes.destino);
  if (!extracao.ok) throw new Error(`${extracao.motivo}: ${extracao.detalhe}`);
  return `extraiu ${extracao.lista.arquivos.length} arquivos da ${leitura.manifesto.versao}`;
}

/**
 * Assina o manifesto de `dir` e grava o `versao.json`. Antes, monta tudo de novo a partir do
 * repo: só assina se o pacote e o manifesto que os outros passos testaram forem, byte a byte,
 * os que este checkout dá. Depois, confere a assinatura com as chaves do código.
 */
export async function assinarVersaoMontada(opcoes: {
  readonly raiz: string;
  readonly tag: string;
  readonly caminhos: readonly string[];
  readonly dir: string;
  readonly privada: string;
  readonly chaves?: readonly ChavePublica[];
}): Promise<string> {
  const { versao, pacote, manifesto } = montar(opcoes.raiz, opcoes.tag, opcoes.caminhos);
  const montado = readFileSync(path.join(opcoes.dir, nomeDoPacote(versao.versao)));
  if (!montado.equals(pacote)) throw new Error("o pacote montado antes não é o que este repo monta");
  if (readFileSync(path.join(opcoes.dir, ARQUIVO_DO_MANIFESTO), "utf8") !== manifesto) {
    throw new Error("o manifesto montado antes não é o que este repo monta");
  }
  const envelope = await assinarManifesto(manifesto, opcoes.privada);
  const aberto = await abrirEnvelope(envelope, opcoes.chaves ?? CHAVES_PUBLICAS);
  if (!aberto.ok) throw new Error(`a chave que assinou não é nenhuma das chaves públicas do código (${aberto.motivo})`);
  writeFileSync(path.join(opcoes.dir, ARQUIVO_ASSINADO), envelope);
  return `assinou a ${versao.versao} com a chave ${aberto.papel}`;
}

/** Gera um par de chaves, grava a privada em `arquivo` (fora do repo, só para o dono) e devolve a linha da pública. */
export async function gerarChave(opcoes: { readonly arquivo: string; readonly raiz: string }): Promise<{ readonly linha: string; readonly id: string }> {
  const relativo = path.relative(path.resolve(opcoes.raiz), path.resolve(opcoes.arquivo));
  if (!relativo.startsWith("..") && !path.isAbsolute(relativo)) throw new Error("a chave privada não pode ficar dentro do repo");
  const par = await gerarParDeChaves();
  writeFileSync(opcoes.arquivo, `${par.privada}\n`, { flag: "wx", mode: 0o600 });
  return { linha: `{ papel: "ativa", publica: "${par.publica}" },`, id: par.id };
}

const USO = `uso:
  git ls-files -z | bun nucleo/atualizacao/release.ts montar <tag> <dir>
  bun nucleo/atualizacao/release.ts conferir <tag> <dir> <destino>
  git ls-files -z | bun nucleo/atualizacao/release.ts assinar <tag> <dir>   (chave em SECRETARIA_CHAVE_DE_ASSINATURA)
  bun nucleo/atualizacao/release.ts gerar-chave <arquivo fora do repo>
`;

async function caminhosDaEntrada(): Promise<string[]> {
  const caminhos = (await Bun.stdin.text()).split("\0").filter((caminho) => caminho !== "");
  if (caminhos.length === 0) throw new Error("a lista de arquivos vem pela entrada: git ls-files -z");
  return caminhos;
}

async function rodar(argumentos: readonly string[]): Promise<string> {
  const raiz = path.join(import.meta.dir, "..", "..");
  const [comando, primeiro, segundo, terceiro] = argumentos;
  if (comando === "montar" && primeiro !== undefined && segundo !== undefined) {
    return montarVersao({ raiz, tag: primeiro, caminhos: await caminhosDaEntrada(), dir: segundo });
  }
  if (comando === "conferir" && primeiro !== undefined && segundo !== undefined && terceiro !== undefined) {
    return conferirVersaoMontada({ tag: primeiro, dir: segundo, destino: terceiro });
  }
  if (comando === "assinar" && primeiro !== undefined && segundo !== undefined) {
    const privada = process.env.SECRETARIA_CHAVE_DE_ASSINATURA ?? "";
    if (privada === "") throw new Error("falta a chave em SECRETARIA_CHAVE_DE_ASSINATURA");
    rmSync(path.join(segundo, ARQUIVO_ASSINADO), { force: true });
    return assinarVersaoMontada({ raiz, tag: primeiro, caminhos: await caminhosDaEntrada(), dir: segundo, privada });
  }
  if (comando === "gerar-chave" && primeiro !== undefined) {
    const { linha, id } = await gerarChave({ arquivo: primeiro, raiz });
    return `chave ${id} gravada em ${primeiro}\nlinha para CHAVES_PUBLICAS (troque o papel para "reserva" na chave reserva):\n  ${linha}`;
  }
  throw new Error(USO);
}

if (import.meta.main) {
  try {
    process.stdout.write(`${await rodar(process.argv.slice(2))}\n`);
  } catch (erro) {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  }
}
