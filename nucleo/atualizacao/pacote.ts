import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Manifesto } from "./manifesto";
import { PADRAO_DE_VERSAO } from "./novidades";
import { recusar, type Recusa } from "./recusa";
import { escreverTar, lerTar, type ArquivoDoTar } from "./tar";

/**
 * O que o pacote traz, com o sha256 de cada arquivo. Vai dentro do pacote e fica na raiz da
 * instalação: é por ela que a atualização seguinte sabe o que a Profills entregou.
 */
export const LISTA_DO_PACOTE = "arquivos-da-versao.json";

export interface ArquivoDoPacote {
  readonly caminho: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ListaDoPacote {
  readonly v: 1;
  readonly versao: string;
  readonly arquivos: readonly ArquivoDoPacote[];
}

const TETO_DESCOMPRIMIDO_BYTES = 256 * 1024 * 1024;

const SEGMENTO = /^[A-Za-z0-9._-]+$/;
const RESERVADO_NO_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** Caminho com `/`, relativo, que dá o mesmo arquivo no Linux, no macOS e no Windows. */
function problemaDoCaminho(caminho: string): string | null {
  for (const segmento of caminho.split("/")) {
    if (!SEGMENTO.test(segmento)) return "só aceita pastas e nomes com letras sem acento, números, ponto, traço e sublinhado";
    if (segmento.endsWith(".")) return "tem nome que termina em ponto";
    if (RESERVADO_NO_WINDOWS.test(segmento)) return "tem nome que o Windows reserva";
  }
  return null;
}

const PASTAS_DA_PROFILLS = ["nucleo/", "docs/", "testes/", "novidades/"];
const FORA_DA_RAIZ = ["meu", "node_modules", ".git", ".atualizacao", ".agents", ".claude"];

/**
 * A lista de troca: o que é da Profills e a atualização põe no lugar. `meu/`, as cópias geradas
 * das skills, `node_modules` e as permissões locais do agente nunca entram, nem na montagem
 * nem na extração.
 */
function entraNaTroca(caminho: string): boolean {
  const partes = caminho.split("/");
  if (partes.length === 1) return !FORA_DA_RAIZ.includes(caminho.toLowerCase());
  if (PASTAS_DA_PROFILLS.some((pasta) => caminho.startsWith(pasta))) return true;
  if (caminho === ".claude/settings.json") return true;
  const skill = partes[2] ?? "";
  return partes[0] === ".agents" && partes[1] === "skills" && partes.length >= 4 && !skill.toLowerCase().startsWith("meu-");
}

/** Dois caminhos que só mudam na caixa, ou um arquivo com nome de pasta, são um só no Windows e no macOS. */
function problemaDoConjunto(caminhos: readonly string[]): string | null {
  const arquivos = new Set<string>();
  const pastas = new Set<string>();
  for (const caminho of caminhos) {
    const chave = caminho.toLowerCase();
    if (arquivos.has(chave)) return `${JSON.stringify(caminho)} aparece duas vezes`;
    arquivos.add(chave);
    for (let barra = chave.indexOf("/"); barra !== -1; barra = chave.indexOf("/", barra + 1)) pastas.add(chave.slice(0, barra));
  }
  for (const caminho of caminhos) if (pastas.has(caminho.toLowerCase())) return `${JSON.stringify(caminho)} é arquivo e pasta`;
  return null;
}

function sha256De(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/**
 * Monta o pacote com os arquivos de `caminhos` que estão na lista de troca. O que está fora
 * dela é pulado; caminho da troca que não serve nos três sistemas, link e pasta lançam erro.
 */
export function montarPacote(opcoes: { readonly raiz: string; readonly caminhos: readonly string[]; readonly versao: string }): {
  readonly pacote: Uint8Array;
  readonly sha256: string;
  readonly lista: ListaDoPacote;
} {
  const arquivos: ArquivoDoTar[] = [];
  for (const caminho of [...new Set(opcoes.caminhos)].sort()) {
    if (!entraNaTroca(caminho)) continue;
    const problema = caminho === LISTA_DO_PACOTE ? "é o nome da lista do pacote" : problemaDoCaminho(caminho);
    if (problema !== null) throw new Error(`${caminho} não pode entrar no pacote: ${problema}`);
    const completo = path.join(opcoes.raiz, ...caminho.split("/"));
    const estado = lstatSync(completo);
    if (!estado.isFile()) throw new Error(`${caminho} não pode entrar no pacote: não é arquivo comum`);
    arquivos.push({ caminho, dados: new Uint8Array(readFileSync(completo)), executavel: (estado.mode & 0o100) !== 0 });
  }
  const conflito = problemaDoConjunto(arquivos.map(({ caminho }) => caminho));
  if (conflito !== null) throw new Error(`o pacote não fecha: ${conflito}`);
  const lista: ListaDoPacote = {
    v: 1,
    versao: opcoes.versao,
    arquivos: arquivos.map(({ caminho, dados }) => ({ caminho, sha256: sha256De(dados), bytes: dados.length })),
  };
  const daLista = { caminho: LISTA_DO_PACOTE, dados: new TextEncoder().encode(`${JSON.stringify(lista)}\n`), executavel: false };
  const pacote = Bun.gzipSync(escreverTar([daLista, ...arquivos]));
  return { pacote, sha256: sha256De(pacote), lista };
}

declare const conferido: unique symbol;

/** Os bytes de um pacote cujo tamanho e sha256 são os do manifesto. Só `conferirPacote` cria um. */
export interface PacoteConferido {
  readonly bytes: Uint8Array;
  readonly versao: string;
  readonly [conferido]: true;
}

export function conferirPacote(bytes: Uint8Array, manifesto: Manifesto): { readonly ok: true; readonly pacote: PacoteConferido } | Recusa {
  if (bytes.length !== manifesto.pacote.bytes) {
    return recusar("pacote_nao_confere", `o pacote tem ${bytes.length} bytes e o manifesto pede ${manifesto.pacote.bytes}`);
  }
  const obtido = sha256De(bytes);
  if (obtido !== manifesto.pacote.sha256) {
    return recusar("pacote_nao_confere", `o sha256 do pacote é ${obtido} e o manifesto pede ${manifesto.pacote.sha256}`);
  }
  return { ok: true, pacote: { bytes, versao: manifesto.versao } as PacoteConferido };
}

function lerLista(bytes: Uint8Array): ListaDoPacote | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const { v, versao, arquivos } = bruto as Record<string, unknown>;
  if (v !== 1 || typeof versao !== "string" || !PADRAO_DE_VERSAO.test(versao) || !Array.isArray(arquivos)) return null;
  const lidos: ArquivoDoPacote[] = [];
  for (const item of arquivos as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { caminho, sha256, bytes: tamanho } = item as Record<string, unknown>;
    if (typeof caminho !== "string" || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
    if (typeof tamanho !== "number" || !Number.isSafeInteger(tamanho) || tamanho < 0) return null;
    lidos.push({ caminho, sha256, bytes: tamanho });
  }
  return { v, versao, arquivos: lidos };
}

/**
 * Extrai o pacote em `destino`, que precisa não existir ou estar vazio. Confere tudo antes de
 * gravar o primeiro byte: só arquivo comum, caminho relativo da lista de troca, e cada arquivo
 * com o sha256 que a lista do pacote diz. Pacote recusado não cria nada.
 */
export function extrairPacote(pacote: PacoteConferido, destino: string): { readonly ok: true; readonly lista: ListaDoPacote } | Recusa {
  if (existsSync(destino) && readdirSync(destino).length > 0) throw new Error(`a pasta ${destino} já tem arquivo`);

  let entradas: ReturnType<typeof lerTar>;
  try {
    entradas = lerTar(new Uint8Array(gunzipSync(pacote.bytes, { maxOutputLength: TETO_DESCOMPRIMIDO_BYTES })));
  } catch (erro) {
    return recusar("pacote_invalido", erro instanceof Error ? erro.message : String(erro));
  }

  const arquivos = new Map<string, ArquivoDoTar>();
  let bytesDaLista: Uint8Array | null = null;
  for (const entrada of entradas) {
    const citado = JSON.stringify(entrada.caminho);
    if (entrada.tipo !== "0") return recusar("caminho_recusado", `${citado} não é arquivo comum: o pacote não traz link nem pasta`);
    if (entrada.caminho === LISTA_DO_PACOTE) {
      if (bytesDaLista !== null) return recusar("caminho_recusado", `${citado} aparece duas vezes`);
      bytesDaLista = entrada.dados;
      continue;
    }
    const problema = problemaDoCaminho(entrada.caminho) ?? (entraNaTroca(entrada.caminho) ? null : "está fora do que a atualização troca");
    if (problema !== null) return recusar("caminho_recusado", `${citado} ${problema}`);
    if (arquivos.has(entrada.caminho)) return recusar("caminho_recusado", `${citado} aparece duas vezes`);
    arquivos.set(entrada.caminho, entrada);
  }
  const conflito = problemaDoConjunto([...arquivos.keys()]);
  if (conflito !== null) return recusar("caminho_recusado", conflito);

  const lista = bytesDaLista === null ? null : lerLista(bytesDaLista);
  if (bytesDaLista === null || lista === null) return recusar("lista_nao_confere", `o pacote não traz ${LISTA_DO_PACOTE} no formato`);
  if (lista.versao !== pacote.versao) return recusar("lista_nao_confere", `a lista é da ${lista.versao} e o manifesto, da ${pacote.versao}`);
  const naLista = new Set(lista.arquivos.map(({ caminho }) => caminho));
  if (naLista.size !== lista.arquivos.length || naLista.size !== arquivos.size) return recusar("lista_nao_confere", "a lista e o pacote não têm os mesmos arquivos");
  for (const { caminho, sha256, bytes } of lista.arquivos) {
    const arquivo = arquivos.get(caminho);
    if (arquivo === undefined) return recusar("lista_nao_confere", `${JSON.stringify(caminho)} está na lista e não está no pacote`);
    if (arquivo.dados.length !== bytes || sha256De(arquivo.dados) !== sha256) {
      return recusar("lista_nao_confere", `${JSON.stringify(caminho)} não tem o sha256 da lista`);
    }
  }

  const raiz = path.resolve(destino);
  const gravar = (caminho: string, dados: Uint8Array, executavel: boolean) => {
    const alvo = path.join(raiz, ...caminho.split("/"));
    mkdirSync(path.dirname(alvo), { recursive: true });
    writeFileSync(alvo, dados, { flag: "wx" });
    if (executavel && process.platform !== "win32") chmodSync(alvo, 0o755);
  };
  gravar(LISTA_DO_PACOTE, bytesDaLista, false);
  for (const { caminho, dados, executavel } of arquivos.values()) gravar(caminho, dados, executavel);
  return { ok: true, lista };
}
