/**
 * A atualização de ponta a ponta, contra a release falsa: o vendedor clica em Atualizar no servidor da
 * 0.1.0, que baixa e confere o pacote da 0.2.0, instala as dependências em `nova/`, sobe o atualizador
 * da própria 0.2.0 e para. O atualizador troca a pasta e sobe o servidor da 0.2.0, que é o servidor de
 * verdade deste repo dizendo a versão da instalação. A aba que clicou continua entrando; a outra, não.
 */
import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conferirPacote, escreverManifesto, extrairPacote, lerManifesto, type EstadoDaAtualizacao } from "../../nucleo/atualizacao";
import { caminhosDoAtualizador, lerAndamento } from "../../nucleo/atualizador";
import { encerrarPid, vivo } from "../../nucleo/processos";
import { lerArquivoDoServidor, type ArquivoDoServidor } from "../../nucleo/servidor";
import { rodar } from "../cli/rodar";
import { WACLI_FALSO } from "../falsos/bancada";
import { pacoteCom, subirReleaseFalsa, type ReleaseFalsa } from "../falsos/release";
import { cliDaInstalacao } from "../falsos/secretaria-de-verdade";
import { NAVEGACAO_DE_TOPO, conectarWhatsappNoPalco, subirPalco, type Palco } from "../servidor/palco";

const REPO = join(import.meta.dir, "..", "..");
const PRAZO_DO_TESTE_MS = 120_000;
const PRAZO_DA_TROCA_MS = 90_000;

let palco: Palco | null = null;
let release: ReleaseFalsa | null = null;
let raiz: string | null = null;
let pidDoNovo: number | null = null;

afterEach(async () => {
  if (pidDoNovo !== null && vivo(pidDoNovo)) await encerrarPid(pidDoNovo, { educado: false });
  await palco?.limpar();
  await release?.parar();
  if (raiz !== null) rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  palco = release = raiz = pidDoNovo = null;
});

function arquivosDaVersao(versao: string, cli: string): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name: "secretaria-profills", version: versao, scripts: { secretaria: "bun entrada.ts" } }),
    "entrada.ts": readFileSync(join(REPO, "entrada.ts"), "utf8"),
    // Sem `node_modules`, o Bun tentaria baixar o que faltasse: o teste não fala com a rede.
    "bunfig.toml": '[install]\nauto = "disable"\n',
    "nucleo/cli/main.ts": cli,
    "nucleo/atualizador/main.ts": readFileSync(join(REPO, "nucleo", "atualizador", "main.ts"), "utf8"),
    "nucleo/marca.txt": `${versao}\n`,
  };
}

/** A instalação nasce do pacote, como a de um vendedor: com a lista de arquivos da versão na raiz. */
function instalarDoPacote(pacote: Uint8Array, versao: string, destino: string): void {
  const sha256 = new Bun.CryptoHasher("sha256").update(pacote).digest("hex");
  const manifesto = lerManifesto(escreverManifesto({ versao, data: "2026-11-20", bunMinimo: "1.4.4", sha256, bytes: pacote.length, oQueMuda: ["Uma frase."] }));
  if (!manifesto.ok) throw new Error(manifesto.detalhe);
  const conferido = conferirPacote(pacote, manifesto.manifesto);
  if (!conferido.ok) throw new Error(conferido.detalhe);
  const extraido = extrairPacote(conferido.pacote, destino);
  if (!extraido.ok) throw new Error(extraido.detalhe);
}

async function outraAba(p: Palco): Promise<string> {
  const bilhete = (await (await p.agente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } };
  const entrada = await fetch(bilhete.dados.url, { redirect: "manual", headers: NAVEGACAO_DE_TOPO });
  return (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** O servidor que o atualizador subiu, quando ele responde a versão nova. */
async function esperarOServidorNovo(dirDados: string, versao: string): Promise<ArquivoDoServidor> {
  const fim = Date.now() + PRAZO_DA_TROCA_MS;
  for (;;) {
    const arquivo = lerArquivoDoServidor(join(dirDados, "servidor.json"));
    if (arquivo !== null) {
      try {
        const info = (await (await fetch(`${arquivo.origem}/api/info`, { signal: AbortSignal.timeout(2_000) })).json()) as { dados: { versaoNucleo: string } };
        if (info.dados.versaoNucleo === versao) return arquivo;
      } catch {
        // Ainda subindo.
      }
    }
    if (Date.now() >= fim) {
      const log = (nome: string) => {
        try {
          return readFileSync(join(dirDados, "logs", nome), "utf8").slice(-2_000);
        } catch {
          return "";
        }
      };
      throw new Error(`o servidor da ${versao} não respondeu.\natualizador: ${log("atualizador.log")}\nservidor: ${log("servidor-saida.log")}`);
    }
    await Bun.sleep(200);
  }
}

test(
  "a 0.1.0 vira a 0.2.0 pelo botão: a aba que clicou continua entrando e o WhatsApp segue conectado sem parear de novo",
  async () => {
    const r = (release = await subirReleaseFalsa());
    const cli = cliDaInstalacao({ origem: r.endereco.origin, chaves: r.chaves });
    const dirRepo = (raiz = mkdtempSync(join(tmpdir(), "secretaria-instalacao-")));
    instalarDoPacote(pacoteCom("0.1.0", arquivosDaVersao("0.1.0", cli)), "0.1.0", dirRepo);
    await r.publicar("0.2.0", { pacote: pacoteCom("0.2.0", arquivosDaVersao("0.2.0", cli)) });

    const p = (palco = await subirPalco({ dirRepo }, { versoes: r.fonte(2_000) }));
    const { dirDados } = p.bancada;
    writeFileSync(join(dirDados, "ambiente.json"), JSON.stringify({ porta: 0, wacli: [process.execPath, WACLI_FALSO, `--falso=${p.bancada.dirFalso}`], crmRecurso: "http://127.0.0.1:9/mcp" }));
    await conectarWhatsappNoPalco(p);
    const pareamentos = () => p.bancada.chamadas().filter((chamada) => chamada.args[0] === "auth" && chamada.args[1] === "--events").length;
    expect(pareamentos()).toBe(1);

    const cookieDaOutra = await outraAba(p);
    expect(((await (await p.painel("/api/atualizacao")).json()) as { dados: EstadoDaAtualizacao }).dados).toMatchObject({ fase: "versao_nova", nova: { versao: "0.2.0" }, bloqueio: null });

    const eventos = await p.eventosDoPainel();
    const clique = (await (await p.painel("/api/atualizacao/aplicar", { method: "POST" })).json()) as { dados: EstadoDaAtualizacao };
    expect(clique.dados).toMatchObject({ fase: "atualizando", instalada: "0.1.0", para: "0.2.0", passo: "baixando" });
    await p.servidor.parado;
    await eventos.fim;
    const texto = eventos.textos.join("");
    expect(['"passo":"instalando"', '"passo":"reiniciando"'].every((passo) => texto.includes(passo))).toBe(true);

    const novo = await esperarOServidorNovo(dirDados, "0.2.0");
    pidDoNovo = novo.pid;
    const doPainel = (cookie: string) => fetch(`${novo.origem}/api/atualizacao`, { headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } });
    const daAba = await doPainel(p.cookie);
    expect(daAba.status).toBe(200);
    expect(((await daAba.json()) as { dados: EstadoDaAtualizacao }).dados).toEqual({ fase: "atualizado", instalada: "0.2.0", de: "0.1.0", nucleoMudado: 0, em: expect.any(String) });
    expect((await doPainel(cookieDaOutra)).status).toBe(401);

    const lido = lerAndamento(caminhosDoAtualizador(dirRepo, dirDados).andamento);
    expect(lido.tipo === "lido" ? lido.andamento : null).toMatchObject({ de: "0.1.0", para: "0.2.0", fase: "concluido", falha: null });
    expect(readFileSync(join(dirRepo, "nucleo", "marca.txt"), "utf8")).toBe("0.2.0\n");

    const conectado = await rodar(dirDados, ["esperar", "whatsapp=conectado", "--ate", "20s", "--json"]);
    expect(conectado.codigo).toBe(0);
    expect(pareamentos()).toBe(1);

    const parada = await fetch(`${novo.origem}/api/servidor/parar`, { method: "POST", headers: { Authorization: `Bearer ${novo.token}` } });
    expect(parada.status).toBe(200);
  },
  PRAZO_DO_TESTE_MS,
);
