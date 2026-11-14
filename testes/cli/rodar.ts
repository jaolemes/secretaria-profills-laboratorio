/**
 * O CLI como o agente o usa: `bun secretaria <comando>` num processo próprio, com a pasta de
 * dados em `SECRETARIA_DADOS` e os alvos externos no `ambiente.json` dela.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { caminhosDosDados, resolverAmbiente, type Ambiente, type ArquivoDeAmbiente } from "../../nucleo/ambiente";
import { definirBackendDoCofre } from "../../nucleo/banco";
import { lerArquivoDoServidor } from "../../nucleo/servidor";
import { montarBancada, type Alvos, type Bancada } from "../falsos/bancada";
import { NAVEGACAO_DE_TOPO } from "../servidor/palco";

export const REPO = join(import.meta.dir, "..", "..");

export interface Saida {
  readonly codigo: number;
  readonly stdout: string;
  readonly stderr: string;
  /** O envelope, quando o stdout é exatamente uma linha JSON. */
  readonly envelope: { v: number; ok: boolean; dados?: unknown; erro?: { codigo: string; mensagem: string; acao: string } } | null;
}

export async function rodar(dirDados: string, args: readonly string[]): Promise<Saida> {
  const processo = Bun.spawn([process.execPath, "secretaria", ...args], {
    cwd: REPO,
    env: { ...process.env, SECRETARIA_DADOS: dirDados },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, codigo] = await Promise.all([new Response(processo.stdout).text(), new Response(processo.stderr).text(), processo.exited]);
  const linhas = stdout.split("\n").filter((linha) => linha !== "");
  let envelope: Saida["envelope"] = null;
  if (linhas.length === 1) {
    try {
      envelope = JSON.parse(linhas[0] ?? "") as Saida["envelope"];
    } catch {
      envelope = null;
    }
  }
  return { codigo, stdout, stderr, envelope };
}

/**
 * Pasta de dados pronta para um servidor em outro processo: cofre em arquivo (nunca o chaveiro
 * de quem roda o teste), porta livre e os falsos no `ambiente.json`.
 */
export function prepararPasta(alvos: Alvos = {}): { readonly bancada: Bancada; ambiente(): Ambiente } {
  const bancada = montarBancada({ ...alvos, porta: 0 });
  definirBackendDoCofre(bancada.banco, "arquivo");
  bancada.banco.fechar();
  const arquivo: ArquivoDeAmbiente = { porta: 0, wacli: [...bancada.ambiente.wacli] };
  // Com o `client_id` real no padrão, a pasta de teste nunca aponta o CRM real: sem falso, o recurso é uma porta morta.
  arquivo.crmRecurso = (alvos.crmRecurso ?? new URL("http://127.0.0.1:9/mcp")).href;
  if (alvos.crmClientId) arquivo.crmClientId = alvos.crmClientId.href;
  if (alvos.caExtra) {
    const pem = join(bancada.dirFalso, "ca.pem");
    writeFileSync(pem, alvos.caExtra);
    arquivo.caExtra = pem;
  }
  writeFileSync(caminhosDosDados(bancada.ambiente).ambiente, JSON.stringify(arquivo));
  return {
    bancada,
    ambiente: () => resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: bancada.dirDados }, home: bancada.dirDados }, REPO),
  };
}

export interface ServidorEmProcesso {
  readonly origem: string;
  readonly pid: number;
  readonly saiu: Promise<number>;
  /** Queda sem aviso: nenhum `parar()` roda. */
  matar(): Promise<void>;
}

/**
 * `secretaria servidor --json` em primeiro plano. Roda o `main.ts` direto, e não pelo script do
 * `package.json`, porque o `bun run` fica no meio e matá-lo não derruba o servidor.
 */
export async function subirEmProcesso(dirDados: string): Promise<ServidorEmProcesso> {
  const processo = Bun.spawn([process.execPath, join(REPO, "nucleo", "cli", "main.ts"), "servidor", "--json"], {
    cwd: REPO,
    env: { ...process.env, SECRETARIA_DADOS: dirDados },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const leitor = processo.stdout.getReader();
  let texto = "";
  while (!texto.includes("\n")) {
    const { value, done } = await leitor.read();
    if (done) throw new Error(`o servidor saiu antes de ficar pronto: ${await new Response(processo.stderr).text()}`);
    texto += new TextDecoder().decode(value);
  }
  leitor.releaseLock();
  const envelope = JSON.parse(texto.split("\n")[0] ?? "") as { ok: boolean; dados: { origem: string; pid: number } };
  if (!envelope.ok) throw new Error(`o servidor não subiu: ${texto}`);
  return {
    origem: envelope.dados.origem,
    pid: envelope.dados.pid,
    saiu: processo.exited,
    async matar() {
      if (process.platform === "win32") processo.kill();
      else processo.kill("SIGKILL");
      await processo.exited;
    },
  };
}

/**
 * Cookie do painel num servidor de outro processo. `abrir --sem-navegador` sobe o servidor sem
 * devolver bilhete, então o teste pede o bilhete com o Bearer do `servidor.json` e entra como o
 * navegador entraria: o limite que `docs/arquitetura.md` registra em "O que é fronteira e o que não é".
 */
export async function entrarComoPainel(dirDados: string): Promise<{ readonly origem: string; readonly cookie: string }> {
  const aberto = await rodar(dirDados, ["abrir", "--sem-navegador", "--json"]);
  if (aberto.envelope?.ok !== true) throw new Error(`abrir falhou: ${aberto.stdout}${aberto.stderr}`);
  const arquivo = lerArquivoDoServidor(join(dirDados, "servidor.json"));
  if (arquivo === null) throw new Error("abrir não deixou o servidor.json");
  const bilhete = await fetch(`${arquivo.origem}/api/sessoes/bilhete`, { method: "POST", headers: { Authorization: `Bearer ${arquivo.token}` } });
  const { dados } = (await bilhete.json()) as { dados: { url: string } };
  const entrada = await fetch(dados.url, { redirect: "manual", headers: NAVEGACAO_DE_TOPO });
  return { origem: arquivo.origem, cookie: (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "" };
}
