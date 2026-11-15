/**
 * Servidor de produção contra a release falsa, parado num estado da atualização, para ver o cartão do pé no navegador.
 *
 *   bun testes/manual/subir-atualizacao.ts <porta> <estado>
 *
 * Estados: em_dia, versao_nova, bloqueado (o WhatsApp no meio da conexão), desenvolvimento (a pasta com `.git`),
 * bun_antigo, atualizando (o download segura no passo Baixando), atualizado (com 2 arquivos do núcleo mudados),
 * falhou (o pacote adulterado) e sem_internet.
 *
 * A pasta da Secretária e a de dados são temporárias, e a release falsa assina com uma chave gerada na hora.
 * Imprime a URL de entrada, que vale uma vez e por um minuto. Ctrl+C para tudo e apaga as pastas.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definirBackendDoCofre } from "../../nucleo/banco";
import { VERSAO_DO_NUCLEO, iniciarServidor, lerArquivoDoServidor } from "../../nucleo/servidor";
import { caminhosDosDados } from "../../nucleo/ambiente";
import { montarBancada } from "../falsos/bancada";
import { pacoteCom, subirReleaseFalsa } from "../falsos/release";
import { PAREAR } from "../servidor/palco";

const ESTADOS = ["em_dia", "versao_nova", "bloqueado", "desenvolvimento", "bun_antigo", "atualizando", "atualizado", "falhou", "sem_internet"] as const;
type Estado = (typeof ESTADOS)[number];

const [portaDada, estadoDado] = process.argv.slice(2);
const porta = Number(portaDada);
if (!Number.isInteger(porta) || porta <= 0 || !ESTADOS.includes(estadoDado as Estado)) {
  console.error(`Uso: bun testes/manual/subir-atualizacao.ts <porta> <${ESTADOS.join("|")}>`);
  process.exit(2);
}
const estado = estadoDado as Estado;

const [MAIOR] = VERSAO_DO_NUCLEO.split(".").map(Number) as [number];
const MAIS_NOVA = `${MAIOR + 1}.0.0`;
const PACOTE = pacoteCom(MAIS_NOVA, { "package.json": JSON.stringify({ name: "secretaria-profills", version: MAIS_NOVA }) });

const release = await subirReleaseFalsa();
const dirRepo = mkdtempSync(join(tmpdir(), "secretaria-repo-"));
if (estado === "desenvolvimento") mkdirSync(join(dirRepo, ".git"));
// O servidor que sobe depois de uma atualização: diz a versão nova e acha o fim que o atualizador gravou.
if (estado === "atualizado") {
  mkdirSync(join(dirRepo, ".atualizacao"));
  const agora = new Date().toISOString();
  const andamento = { v: 1, fase: "concluido", de: VERSAO_DO_NUCLEO, para: MAIS_NOVA, iniciadoEm: agora, atualizadoEm: agora, trocas: [], restaurarDados: true, mudados: { quantos: 2, caminhos: [] }, falha: null };
  writeFileSync(join(dirRepo, ".atualizacao", "andamento.json"), JSON.stringify(andamento));
}

const bancada = montarBancada({ dirRepo, porta });
definirBackendDoCofre(bancada.banco, "arquivo");
bancada.banco.fechar();
const servidor = await iniciarServidor(bancada.ambiente, {
  sincronizacaoAutomatica: false,
  versoes: release.fonte(2_000),
  ...(estado === "atualizado" ? { versaoDoNucleo: MAIS_NOVA } : {}),
});
const arquivo = lerArquivoDoServidor(caminhosDosDados(bancada.ambiente).servidor);
if (arquivo === null) throw new Error("o servidor não gravou o servidor.json");

const doAgente = (caminho: string, init: RequestInit = {}) => fetch(`${servidor.origem}${caminho}`, { ...init, headers: { Authorization: `Bearer ${arquivo.token}`, ...Object.fromEntries(new Headers(init.headers)) } });
const NAVEGACAO = { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };

async function bilhete(): Promise<string> {
  return ((await (await doAgente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } }).dados.url;
}

/** O clique do vendedor, de uma aba que este script abre: a do navegador entra depois e vê o mesmo estado. */
async function clicarEmAtualizar(): Promise<void> {
  const entrada = await fetch(await bilhete(), { redirect: "manual", headers: NAVEGACAO });
  const cookie = (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const painel = (caminho: string, init: RequestInit = {}) => fetch(`${servidor.origem}${caminho}`, { ...init, headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin", Origin: servidor.origem } });
  await painel("/api/atualizacao");
  await painel("/api/atualizacao/aplicar", { method: "POST" });
}

switch (estado) {
  case "em_dia":
  case "atualizado":
    break;
  case "sem_internet":
    release.responder(503);
    break;
  case "bun_antigo":
    await release.publicar(MAIS_NOVA, { pacote: PACOTE, bunMinimo: "99.0.0" });
    break;
  case "atualizando":
    await release.publicar(MAIS_NOVA, { pacote: PACOTE, segurarPacote: new Promise<void>(() => {}) });
    await clicarEmAtualizar();
    break;
  case "falhou":
    await release.publicar(MAIS_NOVA, { pacote: PACOTE, pacoteAdulterado: new Uint8Array(PACOTE.length) });
    await clicarEmAtualizar();
    break;
  case "bloqueado":
    await release.publicar(MAIS_NOVA, { pacote: PACOTE });
    bancada.roteiro({ auth: PAREAR, sync: [] });
    await servidor.pronto;
    await doAgente("/api/conectores/whatsapp/conectar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meio: "qr" }) });
    break;
  case "versao_nova":
  case "desenvolvimento":
    await release.publicar(MAIS_NOVA, { pacote: PACOTE });
    break;
}

console.log(`Estado ${estado}, na ${estado === "atualizado" ? MAIS_NOVA : VERSAO_DO_NUCLEO}, publicada a ${MAIS_NOVA}.`);
console.log(`Entrada (vale uma vez, por um minuto): ${await bilhete()}`);

async function parar(): Promise<void> {
  await servidor.parar();
  await release.parar();
  await bancada.limpar();
  rmSync(dirRepo, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", () => void parar());
process.on("SIGTERM", () => void parar());
