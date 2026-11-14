import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarRegistro } from "../registro";
import { criarSupervisor, horaDeInicio, type Comando, type OpcoesDoSupervisor, type SinalDoProcesso, type Supervisor } from "./index";

const ESPELHO = "whatsapp.espelho";
const PAREAMENTO = "whatsapp.pareamento";
const RAPIDA = { esperaInicialMs: 5, esperaMaximaMs: 20, pararEmMs: 150 };

// Cada passo abre processos de verdade; num runner lento de CI os 5 s padrão não bastam.
setDefaultTimeout(30_000);

const supervisores: Supervisor[] = [];
const pastas: string[] = [];

function supervisor(opcoes: OpcoesDoSupervisor = {}): Supervisor {
  const novo = criarSupervisor(opcoes);
  supervisores.push(novo);
  return novo;
}

function pasta(): string {
  const nova = mkdtempSync(join(tmpdir(), "secretaria-processos-"));
  pastas.push(nova);
  return nova;
}

afterEach(async () => {
  await Promise.all(supervisores.splice(0).map((s) => s.encerrar()));
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function script(codigo: string, env: Record<string, string> = {}): Comando {
  return { argv: [process.execPath, "-e", codigo], env };
}

/** O resultado cru de `process.kill(pid, 0)`: é o que o log do CI precisa mostrar quando um assert de vida falha. */
function sondar(pid: number): { readonly pid: number; readonly vivo: boolean; readonly erro: string | null } {
  try {
    process.kill(pid, 0);
    return { pid, vivo: true, erro: null };
  } catch (erro) {
    return { pid, vivo: false, erro: (erro as NodeJS.ErrnoException).code ?? String(erro) };
  }
}

function vivo(pid: number): boolean {
  return sondar(pid).vivo;
}

/** Guarda os sinais e deixa o teste esperar por um deles sem relógio. */
function caixa() {
  const sinais: SinalDoProcesso[] = [];
  const esperas: { readonly quando: () => boolean; readonly resolver: () => void }[] = [];
  return {
    sinais,
    receber(sinal: SinalDoProcesso) {
      sinais.push(sinal);
      for (const espera of esperas.splice(0)) {
        if (espera.quando()) espera.resolver();
        else esperas.push(espera);
      }
    },
    ate(quando: () => boolean): Promise<void> {
      if (quando()) return Promise.resolve();
      return new Promise((resolver) => esperas.push({ quando, resolver }));
    },
    linhas: () => sinais.flatMap((sinal) => (sinal.tipo === "linha" ? [sinal.texto] : [])),
    tem: (tipo: SinalDoProcesso["tipo"]) => sinais.some((sinal) => sinal.tipo === tipo),
  };
}

const FICA_VIVO = `console.error("pronto"); setInterval(() => {}, 1000);`;
const IGNORA_SIGINT = `process.on("SIGINT", () => {}); console.error("pronto"); setInterval(() => {}, 1000);`;

describe("processo de um papel", () => {
  test("entrega as linhas de stderr em ordem e a saída com o código", async () => {
    const s = supervisor();
    const c = caixa();
    s.iniciar(PAREAMENTO, script(`console.error("um"); console.error("dois\\r"); process.stderr.write("três"); process.exit(3);`), c.receber);
    await c.ate(() => c.tem("saiu"));
    expect(c.linhas()).toEqual(["um", "dois", "três"]);
    expect(c.sinais.at(-1)).toEqual({ tipo: "saiu", codigo: 3 });
    expect(s.situacao(PAREAMENTO)).toEqual({ situacao: "parado" });
  });

  test("iniciar duas vezes não abre segundo processo", async () => {
    const s = supervisor();
    const c = caixa();
    const primeira = s.iniciar(ESPELHO, script(FICA_VIVO), c.receber);
    const segunda = s.iniciar(ESPELHO, script(FICA_VIVO), () => {
      throw new Error("o segundo dono não pode receber sinais");
    });
    await c.ate(() => c.linhas().includes("pronto"));
    expect(primeira.situacao).toBe("rodando");
    expect(segunda).toEqual(primeira);
    expect(s.pids()).toHaveLength(1);
  });

  test("o filho recebe só as variáveis do comando e as básicas do sistema", async () => {
    process.env.SECRETARIA_CANARIO_DE_AMBIENTE = "CANARIO-env-9d2";
    try {
      const s = supervisor();
      const c = caixa();
      const codigo = `console.error(JSON.stringify({ propria: process.env.PROPRIA, canario: process.env.SECRETARIA_CANARIO_DE_AMBIENTE ?? null, path: Boolean(process.env.PATH ?? process.env.Path) }));`;
      s.iniciar(PAREAMENTO, script(codigo, { PROPRIA: "sim" }), c.receber);
      await c.ate(() => c.tem("saiu"));
      expect(JSON.parse(c.linhas()[0] ?? "")).toEqual({ propria: "sim", canario: null, path: true });
    } finally {
      delete process.env.SECRETARIA_CANARIO_DE_AMBIENTE;
    }
  });

  test("executável ausente avisa `nao_iniciou` e deixa o papel parado", async () => {
    const s = supervisor();
    const c = caixa();
    const situacao = s.iniciar(ESPELHO, { argv: [join(pasta(), "nao-existe"), "sync"], env: {} }, c.receber);
    expect(situacao).toEqual({ situacao: "parado" });
    expect(c.sinais).toEqual([]);
    await c.ate(() => c.tem("nao_iniciou"));
    expect(c.sinais).toEqual([{ tipo: "nao_iniciou" }]);
  });
});

describe("parada", () => {
  test("para com SIGINT, espera a saída e não entrega mais sinais", async () => {
    const s = supervisor();
    const c = caixa();
    const codigo = `process.on("SIGINT", () => { console.error("tchau"); process.exit(0); }); ${FICA_VIVO}`;
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.linhas().includes("pronto"));
    const [pid] = s.pids();
    const antes = c.sinais.length;

    await Promise.all([s.parar(ESPELHO), s.parar(ESPELHO)]);
    expect(vivo(pid ?? 0)).toBe(false);
    expect(s.situacao(ESPELHO)).toEqual({ situacao: "parado" });
    expect(c.sinais).toHaveLength(antes);
    await s.parar(ESPELHO);
  });

  test.skipIf(process.platform === "win32")("processo que ignora SIGINT morre por SIGKILL depois da espera", async () => {
    const s = supervisor({ politica: { [ESPELHO]: RAPIDA } });
    const c = caixa();
    s.iniciar(ESPELHO, script(IGNORA_SIGINT), c.receber);
    await c.ate(() => c.linhas().includes("pronto"));
    const [pid] = s.pids();
    await s.parar(ESPELHO);
    expect(vivo(pid ?? 0)).toBe(false);
  });

  test("no Windows a parada é `kill()` direto, sem esperar o processo cooperar", async () => {
    const s = supervisor({ plataforma: "win32", politica: { [ESPELHO]: { pararEmMs: 600_000 } } });
    const c = caixa();
    s.iniciar(ESPELHO, script(IGNORA_SIGINT), c.receber);
    await c.ate(() => c.linhas().includes("pronto"));
    const [pid] = s.pids();
    await s.parar(ESPELHO);
    expect(vivo(pid ?? 0)).toBe(false);
  });

  test("encerrar derruba papéis e comandos avulsos, e nada novo abre depois", async () => {
    const s = supervisor();
    const c = caixa();
    s.iniciar(ESPELHO, script(FICA_VIVO), c.receber);
    s.iniciar(PAREAMENTO, script(FICA_VIVO), c.receber);
    const avulso = s.executar(script(`setInterval(() => {}, 1000);`), 600_000);
    await c.ate(() => c.linhas().length === 2);
    const pids = s.pids();
    expect(pids).toHaveLength(3);

    await s.encerrar();
    expect(pids.filter(vivo)).toEqual([]);
    expect((await avulso).iniciou).toBe(true);
    expect(s.pids()).toEqual([]);
    expect(s.iniciar(ESPELHO, script(FICA_VIVO), c.receber)).toEqual({ situacao: "parado" });
    expect((await s.executar(script(`console.log(1)`), 5_000)).iniciou).toBe(false);
  });
});

describe("reinício com espera", () => {
  test("reinicia o processo que cai e segue com o mesmo dono", async () => {
    const dir = pasta();
    const marca = join(dir, "ja-caiu");
    const codigo = `const fs = require("node:fs"); if (!fs.existsSync(${JSON.stringify(marca)})) { fs.writeFileSync(${JSON.stringify(marca)}, "1"); console.error("caindo"); process.exit(1); } ${FICA_VIVO}`;
    const s = supervisor({ politica: { [ESPELHO]: RAPIDA } });
    const c = caixa();
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.linhas().includes("pronto"));
    expect(c.linhas()).toEqual(["caindo", "pronto"]);
    expect(c.sinais.filter((sinal) => sinal.tipo === "saiu")).toEqual([{ tipo: "saiu", codigo: 1 }]);
    expect(s.situacao(ESPELHO)).toMatchObject({ situacao: "rodando", reinicios: 1 });
  });

  test("desiste depois de cair vezes demais e não deixa processo nem reinício armado", async () => {
    const dir = pasta();
    const contagem = join(dir, "subidas");
    writeFileSync(contagem, "");
    const codigo = `require("node:fs").appendFileSync(${JSON.stringify(contagem)}, "x"); process.exit(1);`;
    const s = supervisor({ politica: { [ESPELHO]: { ...RAPIDA, quedasParaDesistir: 3 } } });
    const c = caixa();
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.tem("desistiu"));
    expect(c.sinais.map((sinal) => sinal.tipo)).toEqual(["saiu", "saiu", "saiu", "desistiu"]);
    expect(readFileSync(contagem, "utf8")).toBe("xxx");
    expect(s.situacao(ESPELHO)).toEqual({ situacao: "parado" });
    expect(s.pids()).toEqual([]);
  });

  test("processo que ficou de pé o bastante zera a contagem de quedas", async () => {
    let relogio = 0;
    const dir = pasta();
    const contagem = join(dir, "subidas");
    writeFileSync(contagem, "");
    const codigo = `require("node:fs").appendFileSync(${JSON.stringify(contagem)}, "x"); process.exit(1);`;
    // Cada leitura do relógio avança um minuto: toda execução parece ter durado mais que `estavelMs`.
    const s = supervisor({
      agora: () => (relogio += 60_000),
      politica: { [ESPELHO]: { ...RAPIDA, quedasParaDesistir: 2, estavelMs: 30_000 } },
    });
    const c = caixa();
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.sinais.filter((sinal) => sinal.tipo === "saiu").length === 4);
    expect(c.tem("desistiu")).toBe(false);
  });

  test("parar durante a espera cancela o reinício", async () => {
    const dir = pasta();
    const contagem = join(dir, "subidas");
    writeFileSync(contagem, "");
    const codigo = `require("node:fs").appendFileSync(${JSON.stringify(contagem)}, "x"); process.exit(1);`;
    const s = supervisor({ politica: { [ESPELHO]: { ...RAPIDA, esperaInicialMs: 600_000, esperaMaximaMs: 600_000 } } });
    const c = caixa();
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.tem("saiu"));
    expect(s.situacao(ESPELHO).situacao).toBe("esperando_reinicio");
    await s.parar(ESPELHO);
    expect(s.situacao(ESPELHO)).toEqual({ situacao: "parado" });
    expect(readFileSync(contagem, "utf8")).toBe("x");
    // Depois de parado, o mesmo papel sobe de novo do zero.
    s.iniciar(ESPELHO, script(codigo), c.receber);
    await c.ate(() => c.sinais.filter((sinal) => sinal.tipo === "saiu").length === 2);
    expect(readFileSync(contagem, "utf8")).toBe("xx");
  });

  test("o pareamento nunca reinicia", async () => {
    const s = supervisor({ politica: { [PAREAMENTO]: RAPIDA } });
    const c = caixa();
    s.iniciar(PAREAMENTO, script(`process.exit(1);`), c.receber);
    await c.ate(() => c.tem("saiu"));
    expect(s.situacao(PAREAMENTO)).toEqual({ situacao: "parado" });
    expect(c.sinais).toEqual([{ tipo: "saiu", codigo: 1 }]);
  });
});

describe("comando avulso", () => {
  test("devolve stdout e código de saída", async () => {
    const s = supervisor();
    const saida = await s.executar(script(`console.log(JSON.stringify({ ok: true, v: process.env.V })); process.exit(4);`, { V: "x" }), 10_000);
    expect(saida).toEqual({ iniciou: true, codigo: 4, stdout: '{"ok":true,"v":"x"}\n', estourouOLimite: false });
  });

  test("o stderr só é guardado quando o comando pede, e só o começo", async () => {
    const s = supervisor();
    const escreve = `console.log("saida"); console.error("erro 1"); process.stderr.write("x".repeat(100_000)); process.exit(1);`;
    expect(await s.executar(script(escreve), 10_000)).toEqual({ iniciou: true, codigo: 1, stdout: "saida\n", estourouOLimite: false });
    const pedido = await s.executar({ ...script(escreve), capturarStderr: true }, 10_000);
    expect(pedido).toMatchObject({ iniciou: true, codigo: 1, stdout: "saida\n", estourouOLimite: false });
    expect(pedido.stderr?.startsWith("erro 1\n")).toBe(true);
    expect(pedido.stderr?.length).toBeLessThanOrEqual(16_384);
    expect((await s.executar({ ...script(`console.log("sem erro")`), capturarStderr: true }, 10_000)).stderr).toBe("");
  });

  test("derruba o comando que passa do limite", async () => {
    const s = supervisor();
    const saida = await s.executar(script(`console.log("começo"); setInterval(() => {}, 1000);`), 300);
    expect(saida.estourouOLimite).toBe(true);
    expect(saida.stdout).toBe("começo\n");
    expect(s.pids()).toEqual([]);
  });

  test("derruba o comando quando o sinal de quem pediu aborta, antes do limite", async () => {
    const s = supervisor();
    const inicio = Date.now();
    const saida = await s.executar(script(`console.log("começo"); setInterval(() => {}, 1000);`), 60_000, AbortSignal.timeout(300));
    expect(saida.estourouOLimite).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(s.pids()).toEqual([]);
  });

  test("sinal já abortado derruba o comando logo que ele abre", async () => {
    const s = supervisor();
    const parado = new AbortController();
    parado.abort();
    const saida = await s.executar(script(`setInterval(() => {}, 1000);`), 60_000, parado.signal);
    expect(saida.estourouOLimite).toBe(true);
    expect(s.pids()).toEqual([]);
  });

  // O neto herda o stdout do comando e segue vivo: o pipe só fecha quando ele sair.
  const NETO_COM_O_PIPE = `const neto = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 20000)"], { stdin: "ignore", stdout: "inherit", stderr: "ignore" }); neto.unref(); console.log(neto.pid);`;

  function matarNeto(stdout: string): void {
    try {
      process.kill(Number(stdout.trim()), "SIGKILL");
    } catch {
      // No Windows o neto já saiu junto com o comando.
    }
  }

  test.each([
    ["que passou do limite", `${NETO_COM_O_PIPE} setInterval(() => {}, 1000);`, { codigo: null, estourouOLimite: true }],
    ["que já saiu", NETO_COM_O_PIPE, { codigo: 0, estourouOLimite: false }],
  ])(
    "não espera além do limite pelo neto de um comando %s",
    async (_nome, codigo, esperado) => {
      const s = supervisor();
      const inicio = Date.now();
      const saida = await s.executar(script(codigo), 500);
      const levou = Date.now() - inicio;
      matarNeto(saida.stdout);
      expect({ ...saida, codigo: esperado.codigo === null ? null : saida.codigo }).toMatchObject({ iniciou: true, ...esperado });
      expect(saida.stdout).toMatch(/^\d+\n$/);
      expect(levou).toBeLessThan(3_000);
      expect(s.pids()).toEqual([]);
    },
    8_000,
  );

  test("executável ausente não lança", async () => {
    const s = supervisor();
    const saida = await s.executar({ argv: [join(pasta(), "nao-existe")], env: {} }, 1_000);
    expect(saida).toEqual({ iniciou: false, codigo: null, stdout: "", estourouOLimite: false });
  });
});

describe("processo órfão", () => {
  test("encerra um processo que não é filho do supervisor", async () => {
    const linhas: string[] = [];
    const s = supervisor({ registro: criarRegistro({ escrever: (linha) => linhas.push(linha), agora: () => "agora" }) });
    // O intermediário abre o neto e sai: o neto fica sem pai neste teste, como um wacli de um servidor morto.
    // `detached` tira o neto do job do pai no Windows: sem ele, o sistema pode encerrá-lo junto com o
    // pai, e o teste ficaria sem órfão.
    const neto = `setInterval(() => {}, 1000);`;
    const intermediario = `const f = Bun.spawn([process.execPath, "-e", ${JSON.stringify(neto)}], { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }); f.unref(); console.log(f.pid);`;
    const saida = await s.executar(script(intermediario), 10_000);
    const pid = Number(saida.stdout.trim());
    // `esteProcesso` é o controle: separa "o neto morreu" de "a sonda não funciona nesta plataforma".
    expect({ saida, neto: sondar(pid), esteProcesso: sondar(process.pid) }).toMatchObject({
      saida: { iniciou: true, codigo: 0, estourouOLimite: false },
      neto: { vivo: true },
      esteProcesso: { vivo: true },
    });

    const encerrou = await s.encerrarPid(pid);
    expect({ encerrou, neto: sondar(pid), registro: linhas }).toMatchObject({ encerrou: true, neto: { vivo: false } });
    expect(await s.encerrarPid(pid)).toBe(true);
  });

  test("recusa pid inválido e o próprio processo", async () => {
    const s = supervisor();
    expect(await s.encerrarPid(0)).toBe(false);
    expect(await s.encerrarPid(-1)).toBe(false);
    expect(await s.encerrarPid(process.pid)).toBe(false);
  });
});

// No Windows não há `ps`; fora dele, o caminho do macOS roda com o `ps` da máquina.
const PLATAFORMAS_DA_HORA: readonly NodeJS.Platform[] = process.platform === "win32" ? ["win32"] : [process.platform, "darwin"];

describe.each(PLATAFORMAS_DA_HORA)("hora de início lida como em %s", (plataforma) => {
  test("repete para o mesmo processo, muda para outro processo e some com o processo", async () => {
    const primeiro = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const hora = horaDeInicio(primeiro.pid, plataforma);
    expect(hora).not.toBeNull();
    expect(horaDeInicio(primeiro.pid, plataforma)).toBe(hora);
    expect(horaDeInicio(process.pid, plataforma)).not.toBe(hora);
    primeiro.kill();
    await primeiro.exited;
    expect(horaDeInicio(primeiro.pid, plataforma)).toBeNull();
  });
});
