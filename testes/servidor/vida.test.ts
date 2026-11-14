import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { caminhosDosDados } from "../../nucleo/ambiente";
import { instante, montarEstadoPainel, type EstadoPainel, type RetratoDosConectores } from "../../nucleo/dominio";
import { definirBackendDoCofre } from "../../nucleo/banco";
import { abrirCofre, type Cofre } from "../../nucleo/cofre";
import { acharServidor } from "../../nucleo/cli/cliente";
import { gravarArquivoDoServidor } from "../../nucleo/servidor/arquivo";
import {
  BancoEmUso,
  INTERVALO_MINIMO_MS,
  VERSAO_DO_NUCLEO,
  criarPublicador,
  iniciarServidor,
  lerArquivoDoServidor,
  lerPidDoServidor,
  type Relogio,
  type ServidorRodando,
} from "../../nucleo/servidor";
import { montarBancada, vivo } from "../falsos/bancada";
import { ESPELHAR, PAREAR, subirPalco, type Palco } from "./palco";

setDefaultTimeout(30_000);

let palco: Palco | null = null;

afterEach(async () => {
  await palco?.limpar();
  palco = null;
});

function relogioDeMentira(): Relogio & { andar(ms: number): void } {
  let agora = 1_000;
  const tarefas = new Set<{ quando: number; tarefa: () => void }>();
  return {
    agora: () => agora,
    depois(ms, tarefa) {
      const item = { quando: agora + ms, tarefa };
      tarefas.add(item);
      return () => tarefas.delete(item);
    },
    andar(ms) {
      agora += ms;
      for (const item of [...tarefas].sort((a, b) => a.quando - b.quando)) {
        if (item.quando > agora) continue;
        tarefas.delete(item);
        item.tarefa();
      }
    },
  };
}

describe("SSE", () => {
  test("rajada de mudanças vira no máximo um evento a cada 150 ms, com o estado mais novo", async () => {
    const relogio = relogioDeMentira();
    const estados: RetratoDosConectores = { whatsapp: { fase: "desconectado" }, crm: { fase: "desconectado" }, email: { pulado: false, contas: [] } };
    let mensagens = 0;
    const retrato = (): EstadoPainel =>
      montarEstadoPainel(
        { id: "i", versaoNucleo: "0", criadaEm: instante(new Date(0)) },
        {
          ...estados,
          whatsapp: { fase: "sincronizando", mensagens, desde: instante(new Date(0)), expiraEm: instante(new Date(1)) },
        },
      );
    const publicador = criarPublicador(retrato, relogio);
    const leitor = publicador.assinar("painel").getReader();
    const lidos: string[] = [];
    const lendo = (async () => {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) return;
        lidos.push(new TextDecoder().decode(value));
      }
    })();
    const eventos = async () => {
      await Bun.sleep(0);
      return lidos.filter((texto) => texto.startsWith("event: estado"));
    };

    expect(await eventos()).toHaveLength(1);
    relogio.andar(INTERVALO_MINIMO_MS);
    for (let i = 1; i <= 20; i += 1) {
      mensagens = i;
      publicador.mudou();
      relogio.andar(5);
    }
    // A primeira mudança sai na hora; as outras 19 esperam a janela e saem juntas, com o valor final.
    expect(await eventos()).toHaveLength(2);
    relogio.andar(INTERVALO_MINIMO_MS);
    const depois = await eventos();
    expect(depois).toHaveLength(3);
    expect(depois.at(-1)).toContain('"mensagens":20');

    publicador.fechar();
    await lendo;
  });
});

describe("vida do servidor", () => {
  test("segunda instância na mesma pasta de dados falha com BancoEmUso e a primeira segue no ar", async () => {
    const p = (palco = await subirPalco());
    const arquivoAntes = p.arquivo;
    let erro: unknown = null;
    try {
      await iniciarServidor(p.bancada.ambiente);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(BancoEmUso);
    expect((erro as Error).message).toContain("já está aberto por outro processo");
    const info = (await (await p.cru("/api/info")).json()) as { ok: boolean };
    expect(info.ok).toBe(true);
    expect((await p.agente("/api/estado")).status).toBe(200);
    expect(p.arquivo).toEqual(arquivoAntes);
  });

  test("outra Secretária na porta preferida: este servidor pega outra porta e o Bearer dele nunca vai à outra", async () => {
    const autorizacoesNaOutra: string[] = [];
    // A outra sobe com as opções com que a Secretária antiga subia, sem `reusePort`.
    const outra = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      development: false,
      fetch(pedido) {
        const autorizacao = pedido.headers.get("authorization");
        if (autorizacao !== null) autorizacoesNaOutra.push(autorizacao);
        return Response.json({ v: 1, ok: true, dados: { app: "secretaria-profills", versaoNucleo: VERSAO_DO_NUCLEO, idInstalacao: "outra-pasta" } });
      },
    });
    const bancada = montarBancada({ porta: outra.port });
    definirBackendDoCofre(bancada.banco, "arquivo");
    bancada.banco.fechar();
    let servidor: ServidorRodando | null = null;
    try {
      servidor = await iniciarServidor(bancada.ambiente);
      expect(servidor.porta).not.toBe(outra.port);
      expect(lerArquivoDoServidor(caminhosDosDados(bancada.ambiente).servidor)?.origem).toBe(`http://127.0.0.1:${servidor.porta}`);
      const respostas: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        const achado = await acharServidor(bancada.ambiente);
        respostas.push(achado.ok && (await achado.dados.pedir("GET", "/api/estado")).ok);
      }
      expect(respostas).toEqual(Array.from({ length: 20 }, () => true));
      expect(autorizacoesNaOutra).toEqual([]);
    } finally {
      await servidor?.parar();
      await outra.stop(true);
      await bancada.limpar();
    }
  });

  test("o servidor.json de um servidor que morreu some antes de este servidor abrir a porta", async () => {
    const bancada = montarBancada({ porta: 0 });
    definirBackendDoCofre(bancada.banco, "arquivo");
    bancada.banco.fechar();
    const caminhos = caminhosDosDados(bancada.ambiente);
    gravarArquivoDoServidor(caminhos.servidor, { v: 1, origem: "http://127.0.0.1:1", pid: 999_999, idInstalacao: "do-morto", token: "t".repeat(32) });
    expect(lerArquivoDoServidor(caminhos.servidor)?.pid).toBe(999_999);
    let noBoot: unknown = "não leu";
    let servidor: ServidorRodando | null = null;
    try {
      servidor = await iniciarServidor(bancada.ambiente, {
        abrirCofre: (opcoes) => {
          noBoot = lerArquivoDoServidor(caminhos.servidor);
          return abrirCofre(opcoes);
        },
      });
      expect(noBoot).toBeNull();
      expect(lerArquivoDoServidor(caminhos.servidor)?.pid).toBe(process.pid);
    } finally {
      await servidor?.parar();
      await bancada.limpar();
    }
  });

  test("parar() encerra o wacli, fecha o SSE, solta a porta e apaga o servidor.json", async () => {
    const p = (palco = await subirPalco());
    p.bancada.roteiro({ auth: PAREAR, sync: ESPELHAR });
    await p.servidor.pronto;
    const eventos = await p.eventosDoPainel();
    await p.painel("/api/conectores/whatsapp/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"meio":"qr"}',
    });
    await eventos.ate((e) => e.conectores.whatsapp.estado.fase === "pareando" && e.conectores.whatsapp.estado.meio.tipo === "qr", "QR");
    const pareando = p.bancada.chamadas().filter((chamada) => chamada.args[0] === "auth" && chamada.args[1] === "--events");
    expect(pareando.map((chamada) => vivo(chamada.pid))).toEqual([true]);

    await p.servidor.parar();
    await eventos.fim;
    expect(p.bancada.chamadas().filter((chamada) => vivo(chamada.pid))).toEqual([]);
    expect(existsSync(caminhosDosDados(p.bancada.ambiente).servidor)).toBe(false);
    const porta = p.servidor.porta;
    const ocupante = Bun.serve({ hostname: "127.0.0.1", port: porta, fetch: () => new Response("livre") });
    expect(ocupante.port).toBe(porta);
    await ocupante.stop(true);
    await p.servidor.parar();
  });

  test("o agente pede a parada pela API e o servidor para depois de responder", async () => {
    const p = (palco = await subirPalco());
    const resposta = (await (await p.agente("/api/servidor/parar", { method: "POST" })).json()) as { ok: boolean };
    expect(resposta.ok).toBe(true);
    await p.servidor.parado;
    expect(existsSync(caminhosDosDados(p.bancada.ambiente).servidor)).toBe(false);
  });

  // O Windows não tem modo de arquivo: lá a pasta de dados herda a ACL do perfil do usuário.
  test.skipIf(process.platform === "win32")("subir sem ter rodado `instalar` deixa a pasta de dados e os bancos só para o dono", async () => {
    const p = (palco = await subirPalco());
    const caminhos = caminhosDosDados(p.bancada.ambiente);
    const modo = (caminho: string) => (statSync(caminho).mode & 0o777).toString(8);
    expect({ dados: modo(p.bancada.dirDados), logs: modo(caminhos.logs), banco: modo(caminhos.banco), servidor: modo(caminhos.servidor) }).toEqual({
      dados: "700",
      logs: "700",
      banco: "600",
      servidor: "600",
    });
    for (const nome of readdirSync(p.bancada.dirDados)) {
      const caminho = join(p.bancada.dirDados, nome);
      expect({ nome, aberto: (statSync(caminho).mode & 0o077).toString(8) }).toEqual({ nome, aberto: "0" });
    }
  });

  test("o pid e a hora de início ficam anotados enquanto o servidor vive e somem quando ele para", async () => {
    const p = (palco = await subirPalco());
    const arquivo = caminhosDosDados(p.bancada.ambiente).pid;
    expect(lerPidDoServidor(arquivo)).toEqual({ tipo: "servidor", pid: process.pid });
    await p.servidor.parar();
    expect(existsSync(arquivo)).toBe(false);
  });

  test("cofre que não responde no boot vira CofreIndisponivel no prazo, e o banco fica livre", async () => {
    const bancada = montarBancada({ porta: 0 });
    definirBackendDoCofre(bancada.banco, "arquivo");
    bancada.banco.fechar();
    const caminhos = caminhosDosDados(bancada.ambiente);
    const mudo: Cofre = { backend: "sistema", ler: () => new Promise(() => {}), gravar: () => new Promise(() => {}), apagar: () => new Promise(() => {}) };
    let subiu: ServidorRodando | null = null;
    let erro: unknown = null;
    try {
      try {
        subiu = await iniciarServidor(bancada.ambiente, { abrirCofre: () => mudo, prazoDoCofreMs: 200 });
      } catch (e) {
        erro = e;
      }
      expect({ subiu: subiu !== null, erro: (erro as Error | null)?.name }).toEqual({ subiu: false, erro: "CofreIndisponivel" });
      expect(existsSync(caminhos.pid)).toBe(false);
      expect(existsSync(caminhos.servidor)).toBe(false);
      // O banco ficou livre: o próximo boot, com o cofre de volta, sobe.
      subiu = await iniciarServidor(bancada.ambiente);
      expect(subiu.origem).toMatch(/^http:/);
    } finally {
      await subiu?.parar();
      await bancada.limpar();
    }
  }, 10_000);

  test("a sessão do painel sobrevive a um restart do servidor", async () => {
    const p = (palco = await subirPalco());
    expect((await p.painel("/api/estado")).status).toBe(200);
    await p.reiniciar();
    expect((await p.painel("/api/estado")).status).toBe(200);
  });
});
