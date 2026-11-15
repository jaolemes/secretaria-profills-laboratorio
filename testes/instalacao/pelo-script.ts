/**
 * A prova da instalação pela versão, que o job `instalacao` do CI roda nos três sistemas: o
 * `instalar.sh` (ou o `instalar.ps1`, no Windows) de verdade instala a versão anterior, contra a
 * release falsa, por cima de uma pasta que era um clone antigo, e o botão do painel atualiza para
 * a candidata. As duas versões são este checkout, com o número trocado e a fonte das versões
 * apontada para a release falsa; as dependências vêm do npm e rodam de verdade.
 *
 *   bun testes/instalacao/pelo-script.ts
 *
 * Sai com 0 quando tudo confere. Fica fora do `bun test`, que já leva uns 15 minutos no Windows.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LISTA_DO_PACOTE, ORIGEM_DAS_VERSOES, montarPacote, type EstadoDaAtualizacao } from "../../nucleo/atualizacao";
import { ARQUIVO_DO_SCRIPT, scriptsComOInstalador } from "../../nucleo/atualizacao/script";
import { caminhosDoAtualizador, lerAndamento } from "../../nucleo/atualizador";
import { definirBackendDoCofre } from "../../nucleo/banco";
import { instante } from "../../nucleo/dominio";
import { encerrarPid, vivo } from "../../nucleo/processos";
import { VERSAO_DO_NUCLEO, lerArquivoDoServidor, type ArquivoDoServidor } from "../../nucleo/servidor";
import { WACLI_FALSO, abrirOBanco } from "../falsos/bancada";
import { subirReleaseFalsa, type ReleaseFalsa } from "../falsos/release";
import { NAVEGACAO_DE_TOPO } from "../servidor/palco";

const REPO = join(import.meta.dir, "..", "..");
const DE = VERSAO_DO_NUCLEO;
const PARA = `${Number(DE.split(".")[0]) + 1}.0.0`;
const PRAZO_DO_SCRIPT_MS = 10 * 60_000;
const PRAZO_DA_TROCA_MS = 10 * 60_000;
const NO_WINDOWS = process.platform === "win32";

function conferir(condicao: boolean, texto: string, contexto?: unknown): asserts condicao {
  if (!condicao) throw new Error(`não conferiu: ${texto}${contexto === undefined ? "" : `\n${JSON.stringify(contexto, null, 2)}`}`);
  console.log(`ok: ${texto}`);
}

function escrever(pasta: string, arquivos: Readonly<Record<string, string>>): void {
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const completo = join(pasta, ...caminho.split("/"));
    mkdirSync(dirname(completo), { recursive: true });
    writeFileSync(completo, conteudo);
  }
}

function trocarUmaVez(texto: string, de: string, para: string, arquivo: string): string {
  if (texto.split(de).length !== 2) throw new Error(`${arquivo} não tem, uma vez só, ${JSON.stringify(de)}: ajuste esta prova`);
  return texto.replace(de, para);
}

/**
 * O pacote deste checkout dizendo ser `versao`, pelo mesmo `montarPacote` do workflow de release.
 * A fonte das versões do código empacotado aponta para a release falsa e aceita a chave dela.
 */
function pacoteDoCheckout(versao: string, release: ReleaseFalsa, pasta: string): Uint8Array {
  const caminhos = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: REPO }).stdout.toString().split("\0").filter((caminho) => caminho !== "" && existsSync(join(REPO, caminho)));
  rmSync(pasta, { recursive: true, force: true });
  for (const caminho of caminhos) {
    mkdirSync(dirname(join(pasta, caminho)), { recursive: true });
    cpSync(join(REPO, caminho), join(pasta, caminho));
  }

  const pacoteNpm = JSON.parse(readFileSync(join(pasta, "package.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(pasta, "package.json"), `${JSON.stringify({ ...pacoteNpm, version: versao }, null, 2)}\n`);
  const fonte = join(pasta, "nucleo", "atualizacao", "fonte.ts");
  const origem = release.endereco.origin;
  let texto = readFileSync(fonte, "utf8");
  texto = trocarUmaVez(texto, "endereco: new URL(ENDERECO_DA_ULTIMA_VERSAO),", `endereco: new URL(${JSON.stringify(release.endereco.href)}),`, "fonte.ts");
  texto = trocarUmaVez(texto, "chaves: CHAVES_PUBLICAS,", `chaves: ${JSON.stringify(release.chaves)},`, "fonte.ts");
  texto = trocarUmaVez(texto, "pacote: (url) => new URL(url),", `pacote: (url) => new URL(url.replace(${JSON.stringify(ORIGEM_DAS_VERSOES)}, ${JSON.stringify(`${origem}/releases/`)})),`, "fonte.ts");
  writeFileSync(fonte, texto);
  return montarPacote({ raiz: pasta, caminhos, versao }).pacote;
}

async function rodarComPrazo(argv: readonly string[], opcoes: { cwd: string; env: Record<string, string | undefined> }): Promise<number> {
  console.log(`rodando: ${argv.join(" ")}`);
  const processo = Bun.spawn([...argv], { ...opcoes, stdio: ["ignore", "inherit", "inherit"] });
  const prazo = setTimeout(() => processo.kill(), PRAZO_DO_SCRIPT_MS);
  try {
    return await processo.exited;
  } finally {
    clearTimeout(prazo);
  }
}

async function versaoNoAr(arquivo: ArquivoDoServidor | null): Promise<string | null> {
  if (arquivo === null) return null;
  try {
    const resposta = await fetch(`${arquivo.origem}/api/info`, { signal: AbortSignal.timeout(2_000) });
    return ((await resposta.json()) as { dados: { versaoNucleo: string } }).dados.versaoNucleo;
  } catch {
    return null;
  }
}

/** O cookie de uma aba do painel, pelo bilhete do agente, como o navegador do vendedor entra. */
async function entrarNoPainel(arquivo: ArquivoDoServidor): Promise<string> {
  const bilhete = (await (await fetch(`${arquivo.origem}/api/sessoes/bilhete`, { method: "POST", headers: { Authorization: `Bearer ${arquivo.token}` } })).json()) as {
    dados: { url: string };
  };
  const entrada = await fetch(bilhete.dados.url, { redirect: "manual", headers: NAVEGACAO_DE_TOPO });
  return (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function logDaPastaDeDados(dados: string, nome: string): string {
  try {
    return readFileSync(join(dados, "logs", nome), "utf8").slice(-3_000);
  } catch {
    return "";
  }
}

async function principal(): Promise<void> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "secretaria-pelo-script-")));
  const release = await subirReleaseFalsa();
  const dados = join(base, "dados");
  let ultimoServidor: ArquivoDoServidor | null = null;
  try {
    await release.publicar(DE, { pacote: pacoteDoCheckout(DE, release, join(base, "fonte")) });
    const scripts = await scriptsComOInstalador(REPO, { origem: release.endereco.origin, chaves: release.chaves });
    const dirScripts = join(base, "script");
    mkdirSync(dirScripts);
    for (const tipo of ["sh", "ps1"] as const) writeFileSync(join(dirScripts, ARQUIVO_DO_SCRIPT[tipo]), scripts[tipo]);

    // O WhatsApp é o falso; o `instalar` só confere o binário que acha na pasta de dados.
    const dirFalso = join(base, "wacli-falso");
    escrever(dirFalso, { "roteiro.json": JSON.stringify({ auth: [], sync: [] }) });
    mkdirSync(join(dados, "bin"), { recursive: true });
    if (!NO_WINDOWS) {
      const versaoDoWacli = (JSON.parse(readFileSync(join(REPO, "ferramentas.lock.json"), "utf8")) as { wacli: { versao: string } }).wacli.versao;
      const wacli = join(dados, "bin", "wacli");
      writeFileSync(wacli, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "wacli ${versaoDoWacli}"; exit 0; fi\nexec "${process.execPath}" "${WACLI_FALSO}" "--falso=${dirFalso}" "$@"\n`);
      chmodSync(wacli, 0o755);
    }
    writeFileSync(join(dados, "ambiente.json"), JSON.stringify({ porta: 0, wacli: [process.execPath, WACLI_FALSO, `--falso=${dirFalso}`], navegador: [process.execPath, "-e", "0"] }));
    // O cofre em arquivo, para a prova não mexer no chaveiro de quem a roda.
    mkdirSync(join(base, "sem-migracoes"));
    const banco = abrirOBanco(dados, join(base, "sem-migracoes"), instante(new Date()));
    definirBackendDoCofre(banco, "arquivo");
    banco.fechar();

    const destino = join(base, "pasta com espaço", "secretaria-profills");
    const doVendedor = { "meu/AGENTS.md": "Regras do vendedor antigo.\n", ".claude/settings.local.json": '{"permissions":{"allow":["Bash(ls:*)"]}}' };
    escrever(destino, {
      ...doVendedor,
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ name: "secretaria-profills", version: "0.0.1", scripts: { secretaria: "bun parar.ts" } }),
      "parar.ts": "process.exit(4);\n",
      "LEIAME-DO-CLONE.md": "só o clone tinha\n",
    });

    const env = { ...process.env, SECRETARIA_DADOS: dados };
    const argv = NO_WINDOWS
      ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dirScripts, ARQUIVO_DO_SCRIPT.ps1), destino]
      : ["sh", join(dirScripts, ARQUIVO_DO_SCRIPT.sh), destino];
    const codigo = await rodarComPrazo(argv, { cwd: base, env });
    conferir(codigo === 0, `o script instalou e saiu com 0 (saiu com ${codigo})`, { servidor: logDaPastaDeDados(dados, "servidor-saida.log") });

    const lista = JSON.parse(readFileSync(join(destino, LISTA_DO_PACOTE), "utf8")) as { versao: string };
    conferir(lista.versao === DE, `a pasta tem a lista da ${DE}`);
    for (const [caminho, conteudo] of Object.entries(doVendedor)) conferir(readFileSync(join(destino, caminho), "utf8") === conteudo, `${caminho} ficou como era`);
    conferir(!existsSync(join(destino, ".git")) && !existsSync(join(destino, "LEIAME-DO-CLONE.md")), "a pasta não tem mais o .git nem o que só o clone tinha");
    const guardadas = readdirSync(dirname(destino)).filter((nome) => nome.startsWith("secretaria-profills-antes-"));
    conferir(guardadas.length === 1, "a pasta antiga ficou guardada ao lado", guardadas);
    const guardada = join(dirname(destino), guardadas[0] ?? "");
    conferir(readFileSync(join(guardada, ".git", "HEAD"), "utf8") === "ref: refs/heads/main\n", "o .git do clone está na pasta guardada");
    conferir(readFileSync(join(destino, "meu", "README.md"), "utf8") === readFileSync(join(REPO, "meu", "README.md"), "utf8"), "o esqueleto de meu/ completou o que faltava");

    const antigo = (ultimoServidor = lerArquivoDoServidor(join(dados, "servidor.json")));
    conferir(antigo !== null && (await versaoNoAr(antigo)) === DE, `o abrir do script deixou a ${DE} no ar`);

    await release.publicar(PARA, { pacote: pacoteDoCheckout(PARA, release, join(base, "fonte")) });
    const cookie = await entrarNoPainel(antigo);
    const doPainel = { Cookie: cookie, "Sec-Fetch-Site": "same-origin" };
    const estado = ((await (await fetch(`${antigo.origem}/api/atualizacao`, { headers: doPainel })).json()) as { dados: EstadoDaAtualizacao }).dados;
    conferir(estado.fase === "versao_nova" && estado.nova.versao === PARA && estado.bloqueio === null, `o painel da ${DE} mostra a ${PARA} com o botão livre`, estado);
    const clique = (await (await fetch(`${antigo.origem}/api/atualizacao/aplicar`, { method: "POST", headers: { ...doPainel, Origin: antigo.origem } })).json()) as { dados: EstadoDaAtualizacao };
    conferir(clique.dados.fase === "atualizando", "o clique em Atualizar começou a atualização", clique);

    const fim = Date.now() + PRAZO_DA_TROCA_MS;
    for (;;) {
      const andamento = lerAndamento(caminhosDoAtualizador(destino, dados).andamento);
      const fase = andamento.tipo === "lido" ? andamento.andamento.fase : null;
      ultimoServidor = lerArquivoDoServidor(join(dados, "servidor.json"));
      if (fase === "desfeito") throw new Error(`a atualização foi desfeita: ${JSON.stringify(andamento)}\n${logDaPastaDeDados(dados, "atualizador.log")}`);
      if (fase === "concluido" && (await versaoNoAr(ultimoServidor)) === PARA) break;
      if (Date.now() >= fim) throw new Error(`a ${PARA} não chegou ao ar.\natualizador: ${logDaPastaDeDados(dados, "atualizador.log")}\nservidor: ${logDaPastaDeDados(dados, "servidor-saida.log")}`);
      await Bun.sleep(500);
    }
    conferir(true, `o atualizador trocou a pasta e a ${PARA} está no ar`);
    const novaLista = JSON.parse(readFileSync(join(destino, LISTA_DO_PACOTE), "utf8")) as { versao: string };
    conferir(novaLista.versao === PARA, `a pasta tem a lista da ${PARA}`);
    for (const [caminho, conteudo] of Object.entries(doVendedor)) conferir(readFileSync(join(destino, caminho), "utf8") === conteudo, `${caminho} passou pela atualização como era`);
  } finally {
    const pid = ultimoServidor?.pid;
    if (ultimoServidor !== null) await fetch(`${ultimoServidor.origem}/api/servidor/parar`, { method: "POST", headers: { Authorization: `Bearer ${ultimoServidor.token}` } }).catch(() => null);
    if (pid !== undefined && vivo(pid)) await encerrarPid(pid, { educado: false });
    await release.parar();
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await principal();
