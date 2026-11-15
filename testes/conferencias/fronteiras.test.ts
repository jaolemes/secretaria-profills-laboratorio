import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

const REPO = join(import.meta.dir, "..", "..");

/** Caminho relativo ao repo, sempre com `/`, para as regras valerem igual no Windows. */
type Caminho = string;

const EXTENSOES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** O atualizador roda sozinho enquanto o resto do núcleo muda de lugar: ele não pode importar o banco nem os processos. */
const ATUALIZADOR = "nucleo/atualizador/main.ts";
/** O instalador roda embutido no script, antes de a Secretária existir: ele só leva `nucleo/atualizacao`, sem os processos. */
const INSTALADOR = "nucleo/atualizacao/instalacao.ts";

/** Onde cada API só pode aparecer. Arquivos de teste ficam de fora: eles sobem processos e revelam canários. */
const DONOS_DE_API: readonly { readonly padrao: RegExp; readonly nome: string; readonly donos: readonly string[] }[] = [
  { padrao: /from\s*["']bun:sqlite["']/, nome: "bun:sqlite", donos: ["nucleo/banco/", ATUALIZADOR] },
  { padrao: /\bBun\.spawn/, nome: "Bun.spawn", donos: ["nucleo/processos/", INSTALADOR] },
  { padrao: /["'](node:)?child_process["']/, nome: "node:child_process", donos: ["nucleo/processos/", ATUALIZADOR] },
  { padrao: /\bBun\.secrets\b/, nome: "Bun.secrets", donos: ["nucleo/cofre/"] },
  { padrao: /from\s*["']imapflow["']/, nome: "imapflow", donos: ["nucleo/conectores/email/imap.ts"] },
  {
    padrao: /\.revelar\(/,
    nome: ".revelar(",
    donos: ["nucleo/cofre/", "nucleo/conectores/crm/oauth.ts", "nucleo/conectores/crm/mcp.ts", "nucleo/conectores/email/imap.ts"],
  },
  { padrao: /\bconsole\./, nome: "console.", donos: ["nucleo/registro/", "nucleo/cli/main.ts"] },
];

const ENTRADAS_QUE_LEEM_O_VENDEDOR = ["nucleo/servidor/main.ts", "nucleo/cli/main.ts", "nucleo/painel/App.tsx"];

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function imports(fonte: string): string[] {
  const achados: string[] = [];
  const padrao = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
  for (const casamento of semComentarios(fonte).matchAll(padrao)) {
    const alvo = casamento[1] ?? casamento[2] ?? casamento[3];
    if (alvo !== undefined) achados.push(alvo);
  }
  return achados;
}

function resolver(origem: Caminho, alvo: string, existe: (caminho: Caminho) => boolean): Caminho | null {
  let base: string;
  if (alvo.startsWith("@/")) base = posix.join("nucleo/painel", alvo.slice(2));
  else if (alvo.startsWith(".")) base = posix.join(posix.dirname(origem), alvo);
  else return null;
  return EXTENSOES.map((extensao) => base + extensao).find(existe) ?? base;
}

/** `nucleo/banco` para `nucleo/banco/abrir.ts`; o próprio arquivo para `nucleo/ambiente.ts`. */
function moduloDoNucleo(caminho: Caminho): string | null {
  const partes = caminho.split("/");
  if (partes[0] !== "nucleo" || partes.length < 2) return null;
  return partes.length === 2 ? caminho : `nucleo/${partes[1]}`;
}

function ehTeste(caminho: Caminho): boolean {
  return /\.test\.tsx?$/.test(caminho);
}

function violacoes(arquivos: ReadonlyMap<Caminho, string>): string[] {
  const existe = (caminho: Caminho) => arquivos.has(caminho);
  const achadas: string[] = [];
  for (const [origem, fonte] of arquivos) {
    const moduloDeOrigem = moduloDoNucleo(origem);
    for (const alvo of imports(fonte)) {
      const destino = resolver(origem, alvo, existe);
      const moduloDeDestino = destino === null ? null : moduloDoNucleo(destino);

      if (origem.startsWith("nucleo/dominio/") && !ehTeste(origem)) {
        const permitido = destino !== null && (destino.startsWith("nucleo/dominio/") || moduloDeDestino === "nucleo/cofre");
        if (!permitido) achadas.push(`${origem}: o domínio não importa ${alvo}`);
      }

      if (destino === null) continue;

      if (moduloDeOrigem !== null && moduloDeDestino !== null && moduloDeOrigem !== moduloDeDestino) {
        const pelaEntrada = destino === moduloDeDestino || /^nucleo\/[^/]+\/index\.tsx?$/.test(destino);
        if (!pelaEntrada) achadas.push(`${origem}: importa ${destino} sem passar pelo index de ${moduloDeDestino}`);
      }

      if (origem.startsWith("nucleo/") && destino.startsWith("meu/")) {
        const entrada = ENTRADAS_QUE_LEEM_O_VENDEDOR.includes(origem);
        if (!entrada || !/^meu\/extensao(\.tsx?)?$/.test(destino)) achadas.push(`${origem}: o núcleo não importa ${destino}`);
      }

      if (origem.startsWith("meu/") && destino.startsWith("nucleo/")) {
        const permitido = /^nucleo\/extensao(\.tsx?)?$/.test(destino) || destino.startsWith("nucleo/painel/components/ui/");
        if (!permitido) achadas.push(`${origem}: o código do vendedor só importa nucleo/extensao e os componentes de UI`);
      }
    }

    if (origem.startsWith("nucleo/") && !ehTeste(origem)) {
      const codigo = semComentarios(fonte);
      for (const { padrao, nome, donos } of DONOS_DE_API) {
        if (padrao.test(codigo) && !donos.some((dono) => origem === dono || origem.startsWith(dono))) {
          achadas.push(`${origem}: ${nome} só pode aparecer em ${donos.join(", ")}`);
        }
      }
    }
  }
  return achadas;
}

function lerArvore(): Map<Caminho, string> {
  const arquivos = new Map<Caminho, string>();
  const visitar = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const completo = join(dir, nome);
      if (statSync(completo).isDirectory()) visitar(completo);
      else if (/\.tsx?$/.test(nome)) arquivos.set(relative(REPO, completo).split(sep).join("/"), readFileSync(completo, "utf8"));
    }
  };
  for (const raiz of ["nucleo", "meu"]) if (existsSync(join(REPO, raiz))) visitar(join(REPO, raiz));
  return arquivos;
}

describe("fronteiras do repo", () => {
  test("a árvore real respeita todas as regras", () => {
    const arvore = lerArvore();
    expect(arvore.size).toBeGreaterThan(10);
    expect(violacoes(arvore)).toEqual([]);
  });

  const casos: readonly (readonly [string, Record<Caminho, string>, string])[] = [
    [
      "import de arquivo interno de outro módulo",
      { "nucleo/banco/a.ts": 'import { x } from "../cofre/arquivo";', "nucleo/cofre/arquivo.ts": "" },
      "sem passar pelo index",
    ],
    [
      "import type também conta",
      { "nucleo/banco/a.ts": 'import type { X } from "../cofre/contrato";', "nucleo/cofre/contrato.ts": "" },
      "sem passar pelo index",
    ],
    ["domínio importando pacote", { "nucleo/dominio/a.ts": 'import { z } from "zod";' }, "o domínio não importa zod"],
    [
      "domínio importando o banco",
      { "nucleo/dominio/a.ts": 'import { abrirBanco } from "../banco";', "nucleo/banco/index.ts": "" },
      "o domínio não importa",
    ],
    ["bun:sqlite fora do banco", { "nucleo/cofre/a.ts": 'import { Database } from "bun:sqlite";' }, "bun:sqlite só pode"],
    ["Bun.spawn fora dos processos", { "nucleo/banco/a.ts": "Bun.spawn(['x']);" }, "Bun.spawn só pode"],
    ["node:child_process fora dos processos", { "nucleo/cli/a.ts": 'import { spawn } from "node:child_process";' }, "node:child_process só pode"],
    ["child_process por require", { "nucleo/cli/a.ts": 'const { spawn } = require("child_process");' }, "node:child_process só pode"],
    ["Bun.secrets fora do cofre", { "nucleo/banco/a.ts": "await Bun.secrets.get({});" }, "Bun.secrets só pode"],
    ["revelar fora da rede e do cofre", { "nucleo/servidor/rotas.ts": "s.revelar();" }, ".revelar( só pode"],
    ["console fora do registro", { "nucleo/banco/a.ts": "console.log(1);" }, "console. só pode"],
    ["imapflow fora do imap.ts", { "nucleo/conectores/email/casca.ts": 'import { ImapFlow } from "imapflow";' }, "imapflow só pode"],
    [
      "núcleo lendo código do vendedor",
      { "nucleo/servidor/rotas.ts": 'import x from "../../meu/painel/Visitas";', "meu/painel/Visitas.tsx": "" },
      "o núcleo não importa",
    ],
    [
      "vendedor importando o banco",
      { "meu/extensao.ts": 'import { abrirBanco } from "../nucleo/banco";', "nucleo/banco/index.ts": "" },
      "só importa nucleo/extensao",
    ],
  ];

  test.each(casos)("pega %s", (_nome, arquivos, trecho) => {
    const achadas = violacoes(new Map(Object.entries(arquivos)));
    expect(achadas.some((achada) => achada.includes(trecho))).toBe(true);
  });

  test("aceita os caminhos permitidos", () => {
    const arquivos = new Map(
      Object.entries({
        "nucleo/servidor/main.ts": 'import extensao from "../../meu/extensao"; import { abrirBanco } from "../banco";',
        "nucleo/banco/index.ts": 'export * from "./abrir";',
        "nucleo/banco/abrir.ts": 'import { Database } from "bun:sqlite"; import { CONECTORES } from "../dominio";',
        "nucleo/dominio/index.ts": 'import type { Segredo } from "../cofre";',
        "nucleo/cofre/index.ts": "",
        "nucleo/ambiente.ts": 'import { instante } from "./dominio";',
        "nucleo/dominio/a.test.ts": 'import { abrirBanco } from "../banco"; import { Database } from "bun:sqlite";',
        "meu/extensao.ts": 'import { definirExtensao } from "../nucleo/extensao"; import { Button } from "../nucleo/painel/components/ui/button";',
        "nucleo/extensao.ts": "",
        "nucleo/painel/components/ui/button.tsx": "",
      }),
    );
    expect(violacoes(arquivos)).toEqual([]);
  });
});
