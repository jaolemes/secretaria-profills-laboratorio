import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { caminhosDosDados } from "../ambiente";
import { abrirBanco } from "../banco";
import { instante } from "../dominio";
import type { Comando, Supervisor } from "../processos";
import { baixarConferido, instalarExecutavel, lerDoZip, type TravaDeFerramentas } from "./ferramentas";
import { executarPassos, PASSOS, type ContextoDaInstalacao } from "./passos";

const VERSAO = "0.26.0";
const CONTEUDO = new TextEncoder().encode("wacli falso para teste\n");
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Zip mínimo, como o do release do Windows: LICENSE e o executável, comprimidos com deflate. */
function zipCom(arquivos: Record<string, Uint8Array>, { crcErrado = false } = {}): Uint8Array<ArrayBuffer> {
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  for (const [nome, dados] of Object.entries(arquivos)) {
    const nomeEmBytes = new TextEncoder().encode(nome);
    const comprimido = new Uint8Array(deflateRawSync(dados));
    const crc = Bun.hash.crc32(dados) ^ (crcErrado ? 1 : 0);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc >>> 0, true);
    local.setUint32(18, comprimido.byteLength, true);
    local.setUint32(22, dados.byteLength, true);
    local.setUint16(26, nomeEmBytes.byteLength, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc >>> 0, true);
    central.setUint32(20, comprimido.byteLength, true);
    central.setUint32(24, dados.byteLength, true);
    central.setUint16(28, nomeEmBytes.byteLength, true);
    central.setUint32(42, deslocamento, true);
    locais.push(new Uint8Array(local.buffer), nomeEmBytes, comprimido);
    centrais.push(new Uint8Array(central.buffer), nomeEmBytes);
    deslocamento += 30 + nomeEmBytes.byteLength + comprimido.byteLength;
  }
  const tamanhoCentral = centrais.reduce((soma, parte) => soma + parte.byteLength, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, Object.keys(arquivos).length, true);
  fim.setUint16(10, Object.keys(arquivos).length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, deslocamento, true);
  return new Uint8Array(Bun.concatArrayBuffers([...locais, ...centrais, new Uint8Array(fim.buffer)]));
}

const TAR_GZ = await new Bun.Archive({ "./LICENSE": "MIT", "./wacli": CONTEUDO }, { compress: "gzip" }).bytes();
const ZIP = zipCom({ LICENSE: new TextEncoder().encode("MIT"), "wacli.exe": CONTEUDO });

let servidor: ReturnType<typeof Bun.serve>;
let base: string;
/** Socket cru: promete o arquivo inteiro no Content-Length, manda metade e fecha. O `Bun.serve` corrigiria o cabeçalho. */
let cortador: Bun.TCPSocketListener<undefined>;
let baseCortada: string;
const pedidos: string[] = [];

beforeAll(() => {
  servidor = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(pedido) {
      const { pathname } = new URL(pedido.url);
      pedidos.push(pathname);
      if (pathname.endsWith("/bom.tar.gz")) return new Response(TAR_GZ);
      if (pathname.endsWith("/bom.zip")) return new Response(ZIP);
      return new Response("não existe", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${servidor.port}`;
  cortador = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${TAR_GZ.byteLength}\r\n\r\n`);
        socket.write(TAR_GZ.subarray(0, TAR_GZ.byteLength >> 1));
        socket.end();
      },
    },
  });
  baseCortada = `http://127.0.0.1:${cortador.port}`;
});

afterAll(() => {
  servidor.stop(true);
  cortador.stop(true);
});

function pastaTemporaria(): string {
  return mkdtempSync(path.join(tmpdir(), "secretaria-instalador-"));
}

/** Responde como o wacli 0.26.0 quando o executável é o que o servidor falso entregou. */
function supervisorFalso(): Supervisor & { readonly comandos: Comando[] } {
  const comandos: Comando[] = [];
  const nao = () => {
    throw new Error("o instalador só roda comandos curtos");
  };
  return {
    comandos,
    async executar(comando) {
      comandos.push(comando);
      const [executavel, ...args] = comando.argv;
      const ehOFalso = existsSync(executavel) && Buffer.from(readFileSync(executavel)).equals(Buffer.from(CONTEUDO));
      if (!ehOFalso) return { iniciou: false, codigo: null, stdout: "", estourouOLimite: false };
      const stdout = args.includes("doctor") ? JSON.stringify({ success: true, data: { lock_held: false } }) : `wacli ${VERSAO}\n`;
      return { iniciou: true, codigo: 0, stdout, estourouOLimite: false };
    },
    iniciar: nao,
    parar: nao,
    situacao: nao,
    encerrarPid: nao,
    pids: () => [],
    encerrar: async () => {},
  };
}

function trava(arquivo: string, sha256: string, origem = base): TravaDeFerramentas {
  const artefato = { url: `${origem}/${arquivo}`, sha256 };
  return {
    wacli: {
      versao: VERSAO,
      licenca: "MIT",
      origem: "https://github.com/openclaw/wacli/releases/tag/v0.26.0",
      checksums: "https://github.com/openclaw/wacli/releases/download/v0.26.0/checksums.txt",
      macosMinimo: 15,
      artefatos: { [`${process.platform}-${process.arch}`]: artefato },
    },
  };
}

function repoFalso(): string {
  const raiz = pastaTemporaria();
  writeFileSync(path.join(raiz, "package.json"), JSON.stringify({ engines: { bun: ">=1.0.0" } }));
  mkdirSync(path.join(raiz, ".agents", "skills", "secretaria-setup"), { recursive: true });
  writeFileSync(path.join(raiz, ".agents", "skills", "secretaria-setup", "SKILL.md"), "---\nname: secretaria-setup\n---\n");
  return raiz;
}

function contexto(sobre: Partial<ContextoDaInstalacao> = {}): ContextoDaInstalacao {
  const arquivo = process.platform === "win32" ? "bom.zip" : "bom.tar.gz";
  return {
    raizDoRepo: repoFalso(),
    dirDados: path.join(pastaTemporaria(), "dados"),
    plataforma: process.platform,
    arquitetura: process.arch,
    versaoDoSistema: "24.1.0",
    versaoDoBun: Bun.version,
    trava: trava(arquivo, sha(process.platform === "win32" ? ZIP : TAR_GZ)),
    supervisor: supervisorFalso(),
    sondarCofre: async () => false,
    agora: () => instante(new Date("2026-11-11T12:00:00.000Z")),
    ...sobre,
  };
}

describe("instalar", () => {
  test("a primeira rodada aplica, a segunda devolve ja_estava em tudo", async () => {
    const ctx = contexto();
    const primeira = await executarPassos(PASSOS, ctx);
    expect(primeira.pronto).toBe(true);
    expect(primeira.passos.map(({ id }) => id)).toEqual(["bun", "dependencias", "pasta_dados", "wacli", "banco", "cofre", "skills", "saude"]);
    expect(Object.fromEntries(primeira.passos.map(({ id, resultado }) => [id, resultado]))).toMatchObject({
      pasta_dados: "feito",
      wacli: "feito",
      banco: "feito",
      cofre: "feito",
      skills: "feito",
    });
    expect(primeira.passos.find(({ id }) => id === "cofre")?.detalhe).toBe("cofre em arquivo na pasta de dados");

    const segunda = await executarPassos(PASSOS, ctx);
    expect(segunda).toEqual({ pronto: true, passos: segunda.passos.map((passo) => ({ ...passo, resultado: "ja_estava" })) });
    expect(pedidos.filter((pedido) => pedido.startsWith("/bom")).length).toBeGreaterThan(0);
  });

  test.skipIf(process.platform === "win32")("a pasta de dados fica só para o dono", async () => {
    const ctx = contexto();
    await executarPassos(PASSOS, ctx);
    expect(statSync(ctx.dirDados).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(ctx.dirDados, "bin")).mode & 0o777).toBe(0o700);
  });

  test("sha256 errado falha e não deixa binário nem sobra", async () => {
    const ctx = contexto({ trava: trava("bom.tar.gz", "0".repeat(64)) });
    const relatorio = await executarPassos(PASSOS, ctx);
    const wacli = relatorio.passos.find(({ id }) => id === "wacli");
    expect(wacli?.resultado).toBe("falhou");
    expect(wacli?.detalhe).toContain("sha256");
    expect(relatorio.passos.find(({ id }) => id === "saude")).toEqual({ id: "saude", resultado: "falhou", detalhe: "não rodou: espera o passo wacli" });
    expect(relatorio.pronto).toBe(false);
    expect(readdirSync(path.join(ctx.dirDados, "bin"))).toEqual([]);
  });

  test("download cortado falha e não deixa binário pela metade", async () => {
    const ctx = contexto({ trava: trava("wacli.tar.gz", sha(TAR_GZ), baseCortada) });
    const relatorio = await executarPassos(PASSOS, ctx);
    const wacli = relatorio.passos.find(({ id }) => id === "wacli");
    expect(wacli?.resultado).toBe("falhou");
    expect(wacli?.detalhe).not.toContain("sha256");
    expect(readdirSync(path.join(ctx.dirDados, "bin"))).toEqual([]);
  });

  test("macOS abaixo do 15 deixa o wacli com o vendedor", async () => {
    const wacli = PASSOS.find(({ id }) => id === "wacli");
    const verificacao = await wacli?.verificar(contexto({ plataforma: "darwin", arquitetura: "arm64", versaoDoSistema: "23.6.0" }));
    expect(verificacao?.situacao).toBe("depende_do_usuario");
    expect(verificacao?.detalhe).toContain("macOS 15");
  });

  test("um pré-requisito do vendedor passa adiante como depende_do_usuario", async () => {
    const ctx = contexto({ versaoDoBun: "0.9.0" });
    const relatorio = await executarPassos(PASSOS.filter(({ id }) => id === "bun" || id === "dependencias"), ctx);
    expect(relatorio.passos.map(({ resultado }) => resultado)).toEqual(["depende_do_usuario", "depende_do_usuario"]);
    expect(relatorio.passos[0]?.detalhe).toContain("instalar.sh");
  });

  test("trocar o wacli com o servidor ligado fica com quem pode parar o servidor", async () => {
    const ctx = contexto();
    expect((await executarPassos(PASSOS, ctx)).pronto).toBe(true);
    const caminhos = caminhosDosDados(ctx);
    // Um wacli de outra versão no lugar, e o banco na mão de um servidor.
    writeFileSync(caminhos.wacli, "wacli antigo");
    const servidorLigado = abrirBanco(caminhos.banco);
    const antes = pedidos.length;
    try {
      const relatorio = await executarPassos(PASSOS, ctx);
      const wacli = relatorio.passos.find(({ id }) => id === "wacli");
      expect(wacli?.resultado).toBe("depende_do_usuario");
      expect(wacli?.detalhe).toContain("bun secretaria parar");
      expect(readFileSync(caminhos.wacli, "utf8")).toBe("wacli antigo");
      expect(pedidos.length).toBe(antes);
    } finally {
      servidorLigado.fechar();
    }
    // Com o servidor parado, a mesma rodada troca o binário.
    const depois = await executarPassos(PASSOS, ctx);
    expect(depois.passos.find(({ id }) => id === "wacli")?.resultado).toBe("feito");
  });

  test("download que para de responder falha no prazo e não deixa arquivo", async () => {
    // Manda o cabeçalho e metade do corpo, e nunca mais responde nem fecha.
    const mudo = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${TAR_GZ.byteLength}\r\n\r\n`);
          socket.write(TAR_GZ.subarray(0, TAR_GZ.byteLength >> 1));
        },
      },
    });
    const destino = path.join(pastaTemporaria(), "pacote.tar.gz");
    try {
      const inicio = Date.now();
      const erro = await baixarConferido(`http://127.0.0.1:${mudo.port}/wacli.tar.gz`, sha(TAR_GZ), destino, 300).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(Error);
      expect(Date.now() - inicio).toBeLessThan(3_000);
      expect(existsSync(destino)).toBe(false);
    } finally {
      mudo.stop(true);
    }
  }, 6_000);

  test("sobra de uma instalação que caiu é apagada antes de baixar", async () => {
    const ctx = contexto();
    mkdirSync(path.join(ctx.dirDados, "bin"), { recursive: true });
    writeFileSync(path.join(ctx.dirDados, "bin", ".baixando-velho.tar.gz"), "meio arquivo");
    await executarPassos(PASSOS, ctx);
    expect(readdirSync(path.join(ctx.dirDados, "bin"))).toEqual([process.platform === "win32" ? "wacli.exe" : "wacli"]);
  });
});

describe("extração", () => {
  test("tira o executável do zip do Windows e do tar.gz", async () => {
    for (const [arquivo, nome] of [
      ["bom.zip", "wacli.exe"],
      ["bom.tar.gz", "wacli"],
    ] as const) {
      const dir = pastaTemporaria();
      const destino = path.join(dir, nome);
      await instalarExecutavel({
        url: `${base}/${arquivo}`,
        sha256: sha(arquivo.endsWith(".zip") ? ZIP : TAR_GZ),
        destino,
        plataforma: process.platform,
        conferir: async () => {},
      });
      expect(new Uint8Array(readFileSync(destino))).toEqual(CONTEUDO);
      expect(readdirSync(dir)).toEqual([nome]);
    }
  });

  test("zip com CRC errado é recusado", () => {
    expect(() => lerDoZip(zipCom({ "wacli.exe": CONTEUDO }, { crcErrado: true }), "wacli.exe")).toThrow("corrompido");
  });

  test("executável que não confere não chega ao destino", async () => {
    const dir = pastaTemporaria();
    const promessa = instalarExecutavel({
      url: `${base}/bom.tar.gz`,
      sha256: sha(TAR_GZ),
      destino: path.join(dir, "wacli"),
      plataforma: process.platform,
      conferir: async () => {
        throw new Error("respondeu outra versão");
      },
    });
    await expect(promessa).rejects.toThrow("outra versão");
    expect(readdirSync(dir)).toEqual([]);
  });
});
