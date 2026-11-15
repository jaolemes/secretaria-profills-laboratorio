/**
 * O CLI de uma instalação mínima (`instalacao-minima.ts`): só `instalar --json` e `servidor --json`.
 * O `nucleo/cli/main.ts` da instalação importa este arquivo, e a raiz dela é a pasta desse `main.ts`,
 * duas acima. O servidor abre o banco como único dono, aplica as migrações do código que está na
 * raiz, anuncia o `servidor.json` e responde a versão do `package.json` em `/api/info`.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { migrarInstalacao } from "./instalacao-minima";

const RAIZ = path.resolve(path.dirname(process.argv[1] ?? ""), "..", "..");
const argumentos = process.argv.slice(2);
const indiceDosDados = argumentos.indexOf("--dados");
const dirDados = indiceDosDados === -1 ? (process.env.SECRETARIA_DADOS ?? "") : (argumentos[indiceDosDados + 1] ?? "");
const versao = (JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { version: string }).version;

/** Um servidor esquecido por um teste que falhou no meio não fica vivo no CI. */
const VIDA_MAXIMA_MS = 120_000;

function sairComErro(codigo: string, mensagem: string): never {
  process.stdout.write(`${JSON.stringify({ v: 1, ok: false, erro: { codigo, mensagem, acao: "" } })}\n`);
  process.exit(1);
}

function abrirBanco() {
  try {
    return migrarInstalacao(RAIZ, dirDados);
  } catch (erro) {
    return sairComErro("interno", erro instanceof Error ? erro.message : String(erro));
  }
}

if (argumentos[0] === "instalar") {
  if (existsSync(path.join(RAIZ, "instalar-falha"))) {
    // A migração já rodou quando o passo seguinte falha: é o pior caso para a volta.
    abrirBanco().close(true);
    sairComErro("instalacao_incompleta", "Passos pendentes: saude.");
  }
  abrirBanco().close(true);
  process.stdout.write(`${JSON.stringify({ v: 1, ok: true, dados: { pronto: true, passos: [] } })}\n`);
  process.exit(0);
}

if (argumentos[0] === "servidor") {
  const banco = abrirBanco();
  setInterval(() => banco.filename, 60_000);
  setTimeout(() => process.exit(0), VIDA_MAXIMA_MS);
  if (!existsSync(path.join(RAIZ, "servidor-mudo"))) {
    const idInstalacao = "instalacao-minima";
    const servidor = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (pedido) =>
        new URL(pedido.url).pathname === "/api/info"
          ? Response.json({ v: 1, ok: true, dados: { app: "secretaria-profills", versaoNucleo: versao, idInstalacao } })
          : new Response("não existe", { status: 404 }),
    });
    const arquivo = path.join(dirDados, "servidor.json");
    writeFileSync(`${arquivo}.tmp`, JSON.stringify({ v: 1, origem: `http://127.0.0.1:${servidor.port}`, pid: process.pid, idInstalacao, token: "x".repeat(32) }));
    renameSync(`${arquivo}.tmp`, arquivo);
    process.stdout.write(`${JSON.stringify({ v: 1, ok: true, dados: { origem: `http://127.0.0.1:${servidor.port}`, pid: process.pid } })}\n`);
  }
}
