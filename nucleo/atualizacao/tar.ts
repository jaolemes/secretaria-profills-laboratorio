/**
 * Tar no formato ustar, escrito e lido aqui. O leitor entrega o tipo de cada entrada sem
 * interpretar nada (link, pasta, cabeçalho estendido), para quem extrai poder recusar; o
 * escritor só grava arquivo comum, sem data nem dono, e o mesmo conteúdo dá os mesmos bytes.
 */

export interface ArquivoDoTar {
  readonly caminho: string;
  readonly dados: Uint8Array;
  readonly executavel: boolean;
}

export interface EntradaDoTar extends ArquivoDoTar {
  /** O tipo como está no cabeçalho: `0` é arquivo comum, `1` e `2` são links, `5` é pasta. */
  readonly tipo: string;
}

const BLOCO = 512;
const CAMPO = {
  nome: [0, 100],
  modo: [100, 108],
  dono: [108, 116],
  grupo: [116, 124],
  tamanho: [124, 136],
  data: [136, 148],
  soma: [148, 156],
  tipo: [156, 157],
  magia: [257, 263],
  versao: [263, 265],
  prefixo: [345, 500],
} as const;

type Campo = keyof typeof CAMPO;

const codificador = new TextEncoder();

function gravar(bloco: Uint8Array, campo: Campo, texto: string): void {
  bloco.set(codificador.encode(texto), CAMPO[campo][0]);
}

function octal(valor: number, casas: number): string {
  return `${valor.toString(8).padStart(casas, "0")}\0`;
}

/** O nome cabe em 100 bytes; o que passa disso vai para o prefixo, cortado numa barra. */
function partir(caminho: string): readonly [prefixo: string, nome: string] {
  const tamanho = (texto: string) => codificador.encode(texto).length;
  if (tamanho(caminho) <= 100) return ["", caminho];
  for (let barra = caminho.indexOf("/"); barra !== -1; barra = caminho.indexOf("/", barra + 1)) {
    const prefixo = caminho.slice(0, barra);
    const nome = caminho.slice(barra + 1);
    if (tamanho(prefixo) <= 155 && tamanho(nome) <= 100 && nome !== "") return [prefixo, nome];
  }
  throw new Error(`o caminho ${caminho} é comprido demais para o tar`);
}

function somaDoCabecalho(bloco: Uint8Array): number {
  let soma = 0;
  for (let i = 0; i < BLOCO; i++) soma += i >= CAMPO.soma[0] && i < CAMPO.soma[1] ? 0x20 : (bloco[i] ?? 0);
  return soma;
}

export function escreverTar(arquivos: readonly ArquivoDoTar[]): Uint8Array<ArrayBuffer> {
  const blocos = (bytes: number) => Math.ceil(bytes / BLOCO) * BLOCO;
  const tar = new Uint8Array(arquivos.reduce((total, { dados }) => total + BLOCO + blocos(dados.length), 2 * BLOCO));
  let cursor = 0;
  for (const { caminho, dados, executavel } of arquivos) {
    const cabecalho = tar.subarray(cursor, cursor + BLOCO);
    const [prefixo, nome] = partir(caminho);
    gravar(cabecalho, "nome", nome);
    gravar(cabecalho, "modo", octal(executavel ? 0o755 : 0o644, 7));
    gravar(cabecalho, "dono", octal(0, 7));
    gravar(cabecalho, "grupo", octal(0, 7));
    gravar(cabecalho, "tamanho", octal(dados.length, 11));
    gravar(cabecalho, "data", octal(0, 11));
    gravar(cabecalho, "tipo", "0");
    gravar(cabecalho, "magia", "ustar\0");
    gravar(cabecalho, "versao", "00");
    gravar(cabecalho, "prefixo", prefixo);
    gravar(cabecalho, "soma", `${somaDoCabecalho(cabecalho).toString(8).padStart(6, "0")}\0 `);
    tar.set(dados, cursor + BLOCO);
    cursor += BLOCO + blocos(dados.length);
  }
  return tar;
}

const decodificador = new TextDecoder("utf-8", { fatal: true });

function ler(bloco: Uint8Array, campo: Campo): string {
  const bytes = bloco.subarray(CAMPO[campo][0], CAMPO[campo][1]);
  const fim = bytes.indexOf(0);
  return decodificador.decode(fim === -1 ? bytes : bytes.subarray(0, fim));
}

function lerOctal(bloco: Uint8Array, campo: Campo): number {
  const texto = ler(bloco, campo).trim();
  if (!/^[0-7]+$/.test(texto)) throw new Error(`o tar tem ${campo} que não é número`);
  return Number.parseInt(texto, 8);
}

/** Lê todas as entradas. Tar cortado, com soma errada ou fora do ustar lança erro. */
export function lerTar(tar: Uint8Array): EntradaDoTar[] {
  const entradas: EntradaDoTar[] = [];
  for (let cursor = 0; ; ) {
    if (cursor + BLOCO > tar.length) throw new Error("o tar acaba sem o bloco de fim");
    const cabecalho = tar.subarray(cursor, cursor + BLOCO);
    if (cabecalho.every((byte) => byte === 0)) {
      if (!tar.subarray(cursor).every((byte) => byte === 0)) throw new Error("o tar tem dados depois do fim");
      return entradas;
    }
    if (lerOctal(cabecalho, "soma") !== somaDoCabecalho(cabecalho)) throw new Error("o tar tem cabeçalho com a soma errada");
    if (ler(cabecalho, "magia") !== "ustar") throw new Error("o tar não está no formato ustar");
    const tamanho = lerOctal(cabecalho, "tamanho");
    const inicio = cursor + BLOCO;
    if (inicio + tamanho > tar.length) throw new Error("o tar acaba no meio de um arquivo");
    const prefixo = ler(cabecalho, "prefixo");
    const nome = ler(cabecalho, "nome");
    const tipo = ler(cabecalho, "tipo");
    entradas.push({
      caminho: prefixo === "" ? nome : `${prefixo}/${nome}`,
      dados: tar.subarray(inicio, inicio + tamanho),
      executavel: (lerOctal(cabecalho, "modo") & 0o100) !== 0,
      tipo: tipo === "" ? "0" : tipo,
    });
    cursor = inicio + Math.ceil(tamanho / BLOCO) * BLOCO;
  }
}
