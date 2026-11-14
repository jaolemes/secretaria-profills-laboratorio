import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Skills têm uma fonte e duas cópias geradas, sem symlink, porque o Windows não os cria sem permissão.
 *
 * | Fonte                    | Vai para                                     |
 * |--------------------------|----------------------------------------------|
 * | `.agents/skills/<nome>`  | `.claude/skills/<nome>`                      |
 * | `meu/skills/meu-<nome>`  | `.claude/skills/meu-<nome>` e `.agents/skills/meu-<nome>` |
 *
 * O Codex lê `.agents/skills` e o Claude Code lê `.claude/skills`. As cópias `meu-*` ficam fora do
 * Git (`.gitignore`): a fonte versionada do vendedor é `meu/skills`.
 */
export const PREFIXO_DO_VENDEDOR = "meu-";

type Arvore = Map<string, Buffer>;

function lerArvore(raiz: string): Arvore {
  const arvore: Arvore = new Map();
  const visitar = (relativo: string) => {
    for (const nome of readdirSync(path.join(raiz, relativo))) {
      const filho = relativo === "" ? nome : `${relativo}/${nome}`;
      if (statSync(path.join(raiz, filho)).isDirectory()) visitar(filho);
      else arvore.set(filho, readFileSync(path.join(raiz, filho)));
    }
  };
  if (existsSync(raiz)) visitar("");
  return arvore;
}

function pastas(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((nome) => statSync(path.join(dir, nome)).isDirectory()) : [];
}

interface Espelho {
  /** Pasta de destino, relativa ao repo, e o conteúdo inteiro que ela deve ter por skill. */
  readonly destino: string;
  readonly skills: ReadonlyMap<string, Arvore>;
  /** Pastas do destino que este espelho controla. */
  readonly controla: (nome: string) => boolean;
}

function espelhos(raizDoRepo: string): Espelho[] {
  const fonte = path.join(raizDoRepo, ".agents", "skills");
  const doVendedor = path.join(raizDoRepo, "meu", "skills");
  const daProfills = new Map<string, Arvore>();
  for (const nome of pastas(fonte)) {
    if (!nome.startsWith(PREFIXO_DO_VENDEDOR)) daProfills.set(nome, lerArvore(path.join(fonte, nome)));
  }
  const dele = new Map<string, Arvore>();
  for (const nome of pastas(doVendedor)) {
    if (!nome.startsWith(PREFIXO_DO_VENDEDOR)) {
      throw new Error(`a skill meu/skills/${nome} precisa se chamar ${PREFIXO_DO_VENDEDOR}${nome}, na pasta e no name`);
    }
    dele.set(nome, lerArvore(path.join(doVendedor, nome)));
  }
  return [
    { destino: path.join(".claude", "skills"), skills: new Map([...daProfills, ...dele]), controla: () => true },
    { destino: path.join(".agents", "skills"), skills: dele, controla: (nome) => nome.startsWith(PREFIXO_DO_VENDEDOR) },
  ];
}

/** Caminhos, relativos ao repo, em que as cópias diferem das fontes. Vazio quando está tudo igual. */
export function diferencasDoEspelho(raizDoRepo: string): string[] {
  const diferencas: string[] = [];
  for (const espelho of espelhos(raizDoRepo)) {
    const destino = path.join(raizDoRepo, espelho.destino);
    for (const nome of pastas(destino).filter(espelho.controla)) {
      if (!espelho.skills.has(nome)) diferencas.push(path.join(espelho.destino, nome));
    }
    for (const [nome, esperada] of espelho.skills) {
      const atual = lerArvore(path.join(destino, nome));
      for (const arquivo of new Set([...esperada.keys(), ...atual.keys()])) {
        const a = esperada.get(arquivo);
        const b = atual.get(arquivo);
        if (a === undefined || b === undefined || !a.equals(b)) diferencas.push(path.join(espelho.destino, nome, arquivo));
      }
    }
  }
  return diferencas;
}

/** Reescreve as cópias a partir das fontes. Rodar de novo não muda nada. */
export function espelharSkills(raizDoRepo: string): void {
  for (const espelho of espelhos(raizDoRepo)) {
    const destino = path.join(raizDoRepo, espelho.destino);
    for (const nome of pastas(destino).filter(espelho.controla)) rmSync(path.join(destino, nome), { recursive: true, force: true });
    for (const [nome, arvore] of espelho.skills) {
      for (const [arquivo, conteudo] of arvore) {
        const alvo = path.join(destino, nome, arquivo);
        mkdirSync(path.dirname(alvo), { recursive: true });
        writeFileSync(alvo, conteudo);
      }
    }
  }
}
