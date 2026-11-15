import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LISTA_DO_PACOTE,
  assinarManifesto,
  conferirPacote,
  conferirVersaoPublicada,
  escreverManifesto,
  extrairPacote,
  gerarParDeChaves,
  lerManifesto,
  montarPacote,
  type Manifesto,
  type PacoteConferido,
} from "./index";
import { escreverTar, type ArquivoDoTar } from "./tar";

const pastas: string[] = [];

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-pacote-"));
  pastas.push(pasta);
  return pasta;
}

afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function texto(conteudo: string): Uint8Array {
  return new TextEncoder().encode(conteudo);
}

function manifestoDe(pacote: Uint8Array, versao = "0.2.0"): Manifesto {
  const leitura = lerManifesto(
    escreverManifesto({ versao, data: "2026-11-20", bunMinimo: "1.4.4", sha256: sha256(pacote), bytes: pacote.length, oQueMuda: ["Uma frase."] }),
  );
  if (!leitura.ok) throw new Error(leitura.detalhe);
  return leitura.manifesto;
}

/** Um pacote feito à mão, com o manifesto que bate com ele: só a extração pode recusá-lo. */
function pacoteFeitoAMao(
  arquivos: readonly ArquivoDoTar[],
  opcoes: { readonly lista?: unknown; readonly semLista?: boolean; readonly mexerNoTar?: (tar: Uint8Array) => Uint8Array } = {},
): PacoteConferido {
  const lista = opcoes.lista ?? {
    v: 1,
    versao: "0.2.0",
    arquivos: arquivos.map(({ caminho, dados }) => ({ caminho, sha256: sha256(dados), bytes: dados.length })),
  };
  const entradas = opcoes.semLista ? arquivos : [{ caminho: LISTA_DO_PACOTE, dados: texto(JSON.stringify(lista)), executavel: false }, ...arquivos];
  const tar = (opcoes.mexerNoTar ?? ((bytes) => bytes))(escreverTar(entradas));
  const pacote = Bun.gzipSync(tar);
  const conferencia = conferirPacote(pacote, manifestoDe(pacote));
  if (!conferencia.ok) throw new Error(conferencia.detalhe);
  return conferencia.pacote;
}

/** Troca o tipo da entrada no cabeçalho do tar e refaz a soma do cabeçalho. */
function comTipo(tar: Uint8Array, caminho: string, tipo: string): Uint8Array {
  const copia = new Uint8Array(tar);
  const nome = texto(caminho);
  for (let inicio = 0; inicio + 512 <= copia.length; inicio += 512) {
    if (!nome.every((byte, i) => copia[inicio + i] === byte) || copia[inicio + nome.length] !== 0) continue;
    copia[inicio + 156] = tipo.charCodeAt(0);
    copia.set(texto("alvo"), inicio + 157);
    copia.fill(0x20, inicio + 148, inicio + 156);
    let soma = 0;
    for (let i = 0; i < 512; i++) soma += copia[inicio + i] ?? 0;
    copia.set(texto(`${soma.toString(8).padStart(6, "0")}\0 `), inicio + 148);
    return copia;
  }
  throw new Error(`${caminho} não está no tar`);
}

function arvore(raiz: string): Record<string, string> {
  const achados: Record<string, string> = {};
  const visitar = (relativo: string) => {
    for (const nome of readdirSync(join(raiz, relativo))) {
      const caminho = relativo === "" ? nome : `${relativo}/${nome}`;
      if (statSync(join(raiz, caminho)).isDirectory()) visitar(caminho);
      else achados[caminho] = sha256(readFileSync(join(raiz, caminho)));
    }
  };
  visitar("");
  return achados;
}

const ARQUIVOS_DO_REPO: Record<string, Uint8Array> = {
  "package.json": texto('{"version":"0.2.0"}\n'),
  "instalar.sh": texto("#!/bin/sh\necho oi\n"),
  "nucleo/servidor/index.ts": texto("export const VERSAO = 1;\n"),
  "nucleo/banco/migracoes/0000_fundacao.sql": texto("CREATE TABLE a (b);\r\nSELECT 1;\r\n"),
  "nucleo/painel/icone.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 0, 13, 10]),
  "docs/arquitetura.md": texto("# Arquitetura\n"),
  "testes/preparo.ts": texto(""),
  "novidades/0.2.0.md": texto("---\nversao: 0.2.0\ndata: 2026-11-20\n---\n- Uma frase.\n"),
  ".agents/skills/bom-dia/SKILL.md": texto("bom dia\n"),
  ".claude/settings.json": texto("{}\n"),
  [`nucleo/${"pasta-de-nome-comprido/".repeat(4)}arquivo-de-nome-comprido.ts`]: texto("export {};\n"),
};

const FORA_DA_TROCA: Record<string, Uint8Array> = {
  "meu/AGENTS.md": texto("regras do vendedor\n"),
  "meu/skills/meu-visitas/SKILL.md": texto("visitas\n"),
  ".claude/skills/bom-dia/SKILL.md": texto("cópia gerada\n"),
  ".agents/skills/meu-visitas/SKILL.md": texto("cópia gerada\n"),
  ".github/workflows/ci.yml": texto("name: CI\n"),
};

function repoDeMentira(): { raiz: string; caminhos: string[] } {
  const raiz = pastaTemporaria();
  const todos = { ...ARQUIVOS_DO_REPO, ...FORA_DA_TROCA };
  for (const [caminho, dados] of Object.entries(todos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), dados);
  }
  if (process.platform !== "win32") chmodSync(join(raiz, "instalar.sh"), 0o755);
  return { raiz, caminhos: Object.keys(todos) };
}

describe("pacote da versão", () => {
  test("ida e volta: o pacote montado, assinado e conferido sai igual ao que entrou", async () => {
    const { raiz, caminhos } = repoDeMentira();
    const montado = montarPacote({ raiz, caminhos, versao: "0.2.0" });
    const chave = await gerarParDeChaves();
    const envelope = await assinarManifesto(
      escreverManifesto({
        versao: "0.2.0",
        data: "2026-11-20",
        bunMinimo: "1.4.4",
        sha256: montado.sha256,
        bytes: montado.pacote.length,
        oQueMuda: ["Uma frase."],
      }),
      chave.privada,
    );

    const versao = await conferirVersaoPublicada(envelope, { instalada: "0.1.0", chaves: [{ papel: "ativa", publica: chave.publica }] });
    if (!versao.ok) throw new Error(versao.detalhe);
    const conferencia = conferirPacote(montado.pacote, versao.manifesto);
    if (!conferencia.ok) throw new Error(conferencia.detalhe);
    const destino = join(pastaTemporaria(), "nova");
    const extracao = extrairPacote(conferencia.pacote, destino);

    const esperado = Object.fromEntries(Object.entries(ARQUIVOS_DO_REPO).map(([caminho, dados]) => [caminho, sha256(dados)]));
    const { [LISTA_DO_PACOTE]: lista, ...extraido } = arvore(destino);
    expect(extraido).toEqual(esperado);
    expect(lista).toBeString();
    expect(extracao).toMatchObject({ ok: true, lista: { v: 1, versao: "0.2.0" } });
    if (!extracao.ok) return;
    expect(Object.fromEntries(extracao.lista.arquivos.map((arquivo) => [arquivo.caminho, arquivo.sha256]))).toEqual(esperado);
    expect(JSON.parse(readFileSync(join(destino, LISTA_DO_PACOTE), "utf8"))).toEqual(extracao.lista);
  });

  test.skipIf(process.platform === "win32")("o script de instalação continua executável", () => {
    const { raiz, caminhos } = repoDeMentira();
    const montado = montarPacote({ raiz, caminhos, versao: "0.2.0" });
    const conferencia = conferirPacote(montado.pacote, manifestoDe(montado.pacote));
    if (!conferencia.ok) throw new Error(conferencia.detalhe);
    const destino = join(pastaTemporaria(), "nova");
    expect(extrairPacote(conferencia.pacote, destino).ok).toBe(true);
    expect(statSync(join(destino, "instalar.sh")).mode & 0o111).toBe(0o111);
    expect(statSync(join(destino, "package.json")).mode & 0o111).toBe(0);
  });

  test("montar duas vezes dá o mesmo pacote", () => {
    const { raiz, caminhos } = repoDeMentira();
    const primeiro = montarPacote({ raiz, caminhos, versao: "0.2.0" });
    const segundo = montarPacote({ raiz, caminhos: [...caminhos].reverse(), versao: "0.2.0" });
    expect(segundo.sha256).toBe(primeiro.sha256);
  });

  test.skipIf(process.platform === "win32")("link no repo não entra no pacote", () => {
    const { raiz, caminhos } = repoDeMentira();
    symlinkSync("/etc/hosts", join(raiz, "nucleo", "link.ts"));
    expect(() => montarPacote({ raiz, caminhos: [...caminhos, "nucleo/link.ts"], versao: "0.2.0" })).toThrow(/nucleo\/link\.ts/);
  });

  test("um byte trocado no pacote é recusado", () => {
    const { raiz, caminhos } = repoDeMentira();
    const { pacote } = montarPacote({ raiz, caminhos, versao: "0.2.0" });
    const manifesto = manifestoDe(pacote);
    const trocado = new Uint8Array(pacote);
    const meio = Math.floor(trocado.length / 2);
    trocado[meio] = (trocado[meio] ?? 0) ^ 1;
    expect(conferirPacote(trocado, manifesto)).toMatchObject({ ok: false, motivo: "pacote_nao_confere" });
    expect(conferirPacote(pacote.subarray(0, pacote.length - 1), manifesto)).toMatchObject({ ok: false, motivo: "pacote_nao_confere" });
    expect(conferirPacote(pacote, manifesto).ok).toBe(true);
  });

  const dados = texto("conteúdo");
  const CAMINHOS_RECUSADOS: readonly (readonly [string, string])[] = [
    ["sobe de pasta", "../fora.txt"],
    ["sobe de pasta no meio", "nucleo/../../fora.txt"],
    ["é absoluto", "/tmp/fora.txt"],
    ["é absoluto no Windows", "C:/fora.txt"],
    ["usa barra invertida", "nucleo\\..\\..\\fora.txt"],
    ["tem ponto sozinho", "nucleo/./a.ts"],
    ["tem pasta vazia", "nucleo//a.ts"],
    ["é do vendedor", "meu/AGENTS.md"],
    ["é do vendedor com outra caixa", "MEU/AGENTS.md"],
    ["é cópia de skill do vendedor", ".agents/skills/meu-visitas/SKILL.md"],
    ["é cópia gerada das skills", ".claude/skills/bom-dia/SKILL.md"],
    ["é a permissão local do agente", ".claude/settings.local.json"],
    ["é do Git", ".git/config"],
    ["é dependência", "node_modules/zod/index.js"],
    ["é da própria atualização", ".atualizacao/anterior/package.json"],
    ["tem nome que o Windows reserva", "nucleo/con.ts"],
    ["termina em ponto", "nucleo/a.ts."],
    ["tem dois-pontos", "nucleo/a.ts:fluxo"],
    ["tem espaço", "nucleo/a b.ts"],
  ];

  test.each(CAMINHOS_RECUSADOS)("a extração recusa caminho que %s", (_nome, caminho) => {
    const pasta = pastaTemporaria();
    const destino = join(pasta, "nova");
    const pacote = pacoteFeitoAMao([
      { caminho: "nucleo/bom.ts", dados, executavel: false },
      { caminho, dados, executavel: false },
    ]);
    expect(extrairPacote(pacote, destino)).toMatchObject({ ok: false, motivo: "caminho_recusado" });
    expect(readdirSync(pasta)).toEqual([]);
  });

  test.each([
    ["link simbólico", "2"],
    ["link físico", "1"],
    ["pasta", "5"],
    ["dispositivo", "3"],
    ["cabeçalho estendido", "x"],
  ])("a extração recusa %s", (_nome, tipo) => {
    const pasta = pastaTemporaria();
    const destino = join(pasta, "nova");
    const pacote = pacoteFeitoAMao(
      [
        { caminho: "nucleo/bom.ts", dados, executavel: false },
        { caminho: "nucleo/estranho.ts", dados: new Uint8Array(0), executavel: false },
      ],
      { mexerNoTar: (tar) => comTipo(tar, "nucleo/estranho.ts", tipo) },
    );
    expect(extrairPacote(pacote, destino)).toMatchObject({ ok: false, motivo: "caminho_recusado" });
    expect(readdirSync(pasta)).toEqual([]);
  });

  test("a extração recusa dois caminhos que são o mesmo no Windows e no macOS", () => {
    const pasta = pastaTemporaria();
    const pacote = pacoteFeitoAMao([
      { caminho: "nucleo/a.ts", dados, executavel: false },
      { caminho: "nucleo/A.ts", dados, executavel: false },
    ]);
    expect(extrairPacote(pacote, join(pasta, "nova"))).toMatchObject({ ok: false, motivo: "caminho_recusado" });
    expect(readdirSync(pasta)).toEqual([]);
  });

  const umArquivo: ArquivoDoTar = { caminho: "nucleo/a.ts", dados, executavel: false };
  const itemDaLista = { caminho: "nucleo/a.ts", sha256: sha256(dados), bytes: dados.length };

  test.each([
    ["sem a lista", { semLista: true }],
    ["com lista que não é JSON de lista", { lista: ["nucleo/a.ts"] }],
    ["com lista de outra versão", { lista: { v: 1, versao: "0.3.0", arquivos: [itemDaLista] } }],
    ["com arquivo que a lista não tem", { lista: { v: 1, versao: "0.2.0", arquivos: [] } }],
    ["com sha256 diferente do da lista", { lista: { v: 1, versao: "0.2.0", arquivos: [{ ...itemDaLista, sha256: "0".repeat(64) }] } }],
    [
      "sem um arquivo que a lista tem",
      { lista: { v: 1, versao: "0.2.0", arquivos: [itemDaLista, { ...itemDaLista, caminho: "nucleo/b.ts" }] } },
    ],
  ])("a extração recusa pacote %s", (_nome, opcoes) => {
    const pasta = pastaTemporaria();
    expect(extrairPacote(pacoteFeitoAMao([umArquivo], opcoes), join(pasta, "nova"))).toMatchObject({ ok: false, motivo: "lista_nao_confere" });
    expect(readdirSync(pasta)).toEqual([]);
  });

  test("a extração recusa arquivo que não é tar.gz", () => {
    const pasta = pastaTemporaria();
    const lixo = texto("isto não é um pacote");
    const conferencia = conferirPacote(lixo, manifestoDe(lixo));
    if (!conferencia.ok) throw new Error(conferencia.detalhe);
    expect(extrairPacote(conferencia.pacote, join(pasta, "nova"))).toMatchObject({ ok: false, motivo: "pacote_invalido" });

    const cortado = pacoteFeitoAMao([umArquivo], { mexerNoTar: (tar) => tar.subarray(0, 700) });
    expect(extrairPacote(cortado, join(pasta, "nova"))).toMatchObject({ ok: false, motivo: "pacote_invalido" });
    expect(readdirSync(pasta)).toEqual([]);
  });

  test("a extração não escreve por cima de pasta que já tem arquivo", () => {
    const destino = pastaTemporaria();
    writeFileSync(join(destino, "sobra.txt"), "de outra tentativa");
    expect(() => extrairPacote(pacoteFeitoAMao([umArquivo]), destino)).toThrow();
    expect(readdirSync(destino)).toEqual(["sobra.txt"]);
    expect(existsSync(join(destino, "nucleo"))).toBe(false);
  });
});
