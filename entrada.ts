/**
 * Por onde o `bun secretaria` começa. Fica fora de `nucleo/` e só importa do Bun e do `node:`: uma
 * atualização que morreu no meio da troca pode deixar `nucleo/` ou `node_modules/` fora do lugar, e
 * aí o CLI nem carrega. Antes dele, a cópia do atualizador guardada em `.atualizacao/` põe as pastas
 * de volta.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const atualizacao = path.join(import.meta.dir, ".atualizacao");
const guardado = path.join(atualizacao, "atualizador.ts");
if (existsSync(path.join(atualizacao, "andamento.json")) && existsSync(guardado)) {
  const { recomporArvore } = (await import(pathToFileURL(guardado).href)) as { recomporArvore(raizDoRepo: string): Promise<{ readonly tipo: string }> };
  if ((await recomporArvore(import.meta.dir)).tipo === "recomposta") {
    // O Bun guarda o que viu da pasta ao começar: um `node_modules/` que voltou agora só é achado por um processo novo.
    const cli = spawnSync(process.execPath, [path.join(import.meta.dir, "nucleo", "cli", "main.ts"), ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
    process.exit(cli.status ?? 1);
  }
}
const { principal } = await import("./nucleo/cli/main.ts");
process.exit(await principal(process.argv.slice(2)));
