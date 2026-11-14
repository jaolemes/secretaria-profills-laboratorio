import type { Registro } from "../registro";
import { encerrarPid } from "./pid";

export { destacar, type Destacado } from "./destacar";
export { encerrarPid, horaDeInicio, vivo } from "./pid";

/**
 * Único módulo que abre processo: `Bun.spawn` aqui, `node:child_process` em `destacar.ts`.
 * O supervisor conhece papéis, não o wacli: recebe o argv pronto e devolve linhas de stderr e a saída.
 */
export const PAPEIS = ["whatsapp.pareamento", "whatsapp.espelho"] as const;
export type Papel = (typeof PAPEIS)[number];

export interface PoliticaDoPapel {
  readonly reinicio: "nunca" | "com_espera";
  /** Tempo entre o pedido educado de parada e a morte forçada. */
  readonly pararEmMs: number;
  readonly esperaInicialMs: number;
  readonly esperaMaximaMs: number;
  /** Quedas curtas dentro de `janelaMs` que fazem o supervisor desistir. */
  readonly quedasParaDesistir: number;
  readonly janelaMs: number;
  /** Processo que ficou de pé por este tempo zera a contagem de quedas e a espera. */
  readonly estavelMs: number;
}

const ESPERA = { esperaInicialMs: 2_000, esperaMaximaMs: 60_000, quedasParaDesistir: 5, janelaMs: 600_000, estavelMs: 60_000 };

/** Política por papel. Papel novo entra aqui. */
export const POLITICA: Readonly<Record<Papel, PoliticaDoPapel>> = {
  // O pareamento sai sozinho e quem decide o próximo passo é a máquina do conector.
  "whatsapp.pareamento": { ...ESPERA, reinicio: "nunca", pararEmMs: 5_000 },
  "whatsapp.espelho": { ...ESPERA, reinicio: "com_espera", pararEmMs: 10_000 },
};

export interface Comando {
  /** Lista de argumentos. Nunca string de shell. */
  readonly argv: readonly [string, ...string[]];
  /** Variáveis próprias do comando. O filho recebe estas e as de `HERDADAS`, nada mais. */
  readonly env: Readonly<Record<string, string>>;
  /** Só para `executar`: guarda o começo do stderr em `ResultadoDaExecucao.stderr`. Sem isso o stderr é descartado. */
  readonly capturarStderr?: true;
}

export type SinalDoProcesso =
  /** Uma linha de stderr, sem interpretar. */
  | { readonly tipo: "linha"; readonly texto: string }
  | { readonly tipo: "saiu"; readonly codigo: number | null }
  /** O executável não existe ou não pôde ser executado. */
  | { readonly tipo: "nao_iniciou" }
  /** Caiu vezes demais em pouco tempo. O supervisor não tenta mais. */
  | { readonly tipo: "desistiu" };

export type SituacaoDoPapel =
  | { readonly situacao: "parado" }
  | { readonly situacao: "rodando"; readonly pid: number; readonly desde: number; readonly reinicios: number }
  | { readonly situacao: "esperando_reinicio"; readonly proximaTentativaEm: number }
  | { readonly situacao: "parando" };

export interface ResultadoDaExecucao {
  /** `false` quando o executável não existe ou não pôde ser executado. */
  readonly iniciou: boolean;
  readonly codigo: number | null;
  readonly stdout: string;
  /** O começo do stderr, só quando o comando pediu `capturarStderr`. */
  readonly stderr?: string;
  readonly estourouOLimite: boolean;
}

export interface Supervisor {
  /**
   * Idempotente: com o papel rodando ou esperando reinício, não abre segundo processo e devolve
   * a situação. Os sinais chegam a `aoSinal` depois de `iniciar` retornar, nunca dentro dele.
   */
  iniciar(papel: Papel, comando: Comando, aoSinal: (sinal: SinalDoProcesso) => void): SituacaoDoPapel;
  /**
   * Idempotente. Unix: SIGINT, espera `pararEmMs`, depois SIGKILL. Windows: `kill()` direto.
   * Resolve só quando o processo saiu. Depois da chamada, nenhum sinal daquele processo é entregue.
   */
  parar(papel: Papel): Promise<void>;
  situacao(papel: Papel): SituacaoDoPapel;
  /**
   * Comando curto que termina (sondagem, leitura, logout), com limite de tempo e stdout capturado.
   * `sinal` abortado derruba o processo como o limite derruba, com `estourouOLimite`.
   */
  executar(comando: Comando, limiteMs: number, sinal?: AbortSignal): Promise<ResultadoDaExecucao>;
  /** Encerra um processo que não é filho deste supervisor. Devolve `true` quando ele não existe mais. */
  encerrarPid(pid: number): Promise<boolean>;
  /** Processos vivos que este supervisor abriu. */
  pids(): readonly number[];
  /** Para tudo. Depois disso nenhum processo aberto por este supervisor está vivo e nenhum novo abre. */
  encerrar(): Promise<void>;
}

/**
 * O filho não herda o ambiente inteiro do servidor: só o que um executável precisa para rodar.
 * Assim uma variável com segredo no ambiente do vendedor não chega a um processo externo.
 */
const HERDADAS = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
];

function ambienteDoFilho(proprias: Readonly<Record<string, string>>): Record<string, string> {
  const ambiente: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(process.env)) {
    if (valor !== undefined && HERDADAS.includes(nome.toUpperCase())) ambiente[nome] = valor;
  }
  return { ...ambiente, ...proprias };
}

const LIMITE_DA_LINHA = 1_048_576;
const LIMITE_DO_STDOUT = 16 * 1_048_576;
const LIMITE_DO_STDERR = 16 * 1_024;

async function lerLinhas(fluxo: ReadableStream<Uint8Array>, aoLinha: (texto: string) => void): Promise<void> {
  const decodificador = new TextDecoder();
  let resto = "";
  for await (const bloco of fluxo) {
    resto += decodificador.decode(bloco, { stream: true });
    let fim: number;
    while ((fim = resto.indexOf("\n")) !== -1) {
      const linha = resto.slice(0, fim).replace(/\r$/, "");
      resto = resto.slice(fim + 1);
      if (linha !== "") aoLinha(linha);
    }
    if (resto.length > LIMITE_DA_LINHA) resto = "";
  }
  if (resto.trim() !== "") aoLinha(resto);
}

type Filho = Bun.Subprocess<"ignore", "ignore" | "pipe", "ignore" | "pipe">;

interface Vaga {
  readonly papel: Papel;
  readonly comando: Comando;
  readonly aoSinal: (sinal: SinalDoProcesso) => void;
  readonly politica: PoliticaDoPapel;
  filho: Filho | null;
  /** Resolve quando o processo atual saiu e a saída dele foi tratada. */
  fim: Promise<void>;
  temporizador: ReturnType<typeof setTimeout> | null;
  proximaTentativaEm: number;
  quedas: number[];
  espera: number;
  reinicios: number;
  desde: number;
  calada: boolean;
  parando: Promise<void> | null;
}

export interface OpcoesDoSupervisor {
  readonly agora?: () => number;
  readonly plataforma?: NodeJS.Platform;
  /** Troca tempos da política. Os testes usam esperas curtas; o servidor usa `POLITICA`. */
  readonly politica?: { readonly [P in Papel]?: Partial<PoliticaDoPapel> };
  readonly registro?: Registro;
}

export function criarSupervisor(opcoes: OpcoesDoSupervisor = {}): Supervisor {
  const agora = opcoes.agora ?? Date.now;
  const plataforma = opcoes.plataforma ?? process.platform;
  const registro = opcoes.registro;
  const vagas = new Map<Papel, Vaga>();
  /** Comando avulso vivo e como largar o stdout dele sem esperar o fim do pipe. */
  const avulsos = new Map<Filho, () => void>();
  let encerrado = false;

  function esperarSaida(filho: Filho, limiteMs: number): Promise<boolean> {
    return new Promise((resolver) => {
      const temporizador = setTimeout(() => resolver(false), limiteMs);
      void filho.exited.then(() => {
        clearTimeout(temporizador);
        resolver(true);
      });
    });
  }

  async function matar(filho: Filho, pararEmMs: number): Promise<void> {
    if (plataforma === "win32") {
      // Processo sem console não recebe sinal educado no Windows; `kill()` é TerminateProcess.
      filho.kill();
      await filho.exited;
      return;
    }
    filho.kill("SIGINT");
    if (await esperarSaida(filho, pararEmMs)) return;
    filho.kill("SIGKILL");
    await filho.exited;
  }

  function emitir(vaga: Vaga, sinal: SinalDoProcesso): void {
    if (!vaga.calada) vaga.aoSinal(sinal);
  }

  function liberar(vaga: Vaga): void {
    if (vagas.get(vaga.papel) === vaga) vagas.delete(vaga.papel);
  }

  function subir(vaga: Vaga): void {
    let filho: Filho;
    try {
      filho = Bun.spawn([...vaga.comando.argv], {
        env: ambienteDoFilho(vaga.comando.env),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        windowsHide: true,
      });
    } catch {
      liberar(vaga);
      registro?.erro("processo.nao_iniciou", { papel: vaga.papel });
      queueMicrotask(() => emitir(vaga, { tipo: "nao_iniciou" }));
      return;
    }
    vaga.filho = filho;
    vaga.desde = agora();
    registro?.info("processo.iniciou", { papel: vaga.papel, pid: filho.pid, reinicios: vaga.reinicios });
    vaga.fim = acompanhar(vaga, filho);
  }

  async function acompanhar(vaga: Vaga, filho: Filho): Promise<void> {
    const leitura =
      filho.stderr === undefined
        ? Promise.resolve()
        : lerLinhas(filho.stderr, (texto) => emitir(vaga, { tipo: "linha", texto })).catch(() => {});
    const [codigo] = await Promise.all([filho.exited, leitura]);
    vaga.filho = null;
    if (vaga.calada) return;
    registro?.info("processo.saiu", { papel: vaga.papel, codigo: codigo ?? -1 });

    if (vaga.politica.reinicio === "nunca") {
      liberar(vaga);
      emitir(vaga, { tipo: "saiu", codigo });
      return;
    }

    const momento = agora();
    if (momento - vaga.desde >= vaga.politica.estavelMs) {
      vaga.quedas = [];
      vaga.espera = vaga.politica.esperaInicialMs;
    } else {
      vaga.quedas = [...vaga.quedas, momento].filter((queda) => momento - queda <= vaga.politica.janelaMs);
    }
    const desistiu = vaga.quedas.length >= vaga.politica.quedasParaDesistir;
    if (desistiu) liberar(vaga);
    emitir(vaga, { tipo: "saiu", codigo });
    if (desistiu) {
      registro?.erro("processo.desistiu", { papel: vaga.papel });
      emitir(vaga, { tipo: "desistiu" });
      return;
    }
    // Quem recebeu `saiu` pode ter pedido `parar` dentro do próprio aviso.
    if (vaga.calada) return;

    vaga.proximaTentativaEm = momento + vaga.espera;
    vaga.temporizador = setTimeout(() => {
      vaga.temporizador = null;
      vaga.reinicios += 1;
      subir(vaga);
    }, vaga.espera);
    vaga.espera = Math.min(vaga.espera * 2, vaga.politica.esperaMaximaMs);
  }

  function situacao(papel: Papel): SituacaoDoPapel {
    const vaga = vagas.get(papel);
    if (vaga === undefined) return { situacao: "parado" };
    if (vaga.parando !== null) return { situacao: "parando" };
    if (vaga.filho !== null) {
      return { situacao: "rodando", pid: vaga.filho.pid, desde: vaga.desde, reinicios: vaga.reinicios };
    }
    return { situacao: "esperando_reinicio", proximaTentativaEm: vaga.proximaTentativaEm };
  }

  function parar(papel: Papel): Promise<void> {
    const vaga = vagas.get(papel);
    if (vaga === undefined) return Promise.resolve();
    if (vaga.parando !== null) return vaga.parando;
    vaga.calada = true;
    if (vaga.temporizador !== null) clearTimeout(vaga.temporizador);
    vaga.temporizador = null;
    vaga.parando = (async () => {
      if (vaga.filho !== null) await matar(vaga.filho, vaga.politica.pararEmMs);
      await vaga.fim;
      liberar(vaga);
    })();
    return vaga.parando;
  }

  return {
    iniciar(papel, comando, aoSinal) {
      const existente = vagas.get(papel);
      if (existente !== undefined || encerrado) return situacao(papel);
      const politica = { ...POLITICA[papel], ...opcoes.politica?.[papel] };
      const vaga: Vaga = {
        papel,
        comando,
        aoSinal,
        politica,
        filho: null,
        fim: Promise.resolve(),
        temporizador: null,
        proximaTentativaEm: 0,
        quedas: [],
        espera: politica.esperaInicialMs,
        reinicios: 0,
        desde: 0,
        calada: false,
        parando: null,
      };
      vagas.set(papel, vaga);
      subir(vaga);
      return situacao(papel);
    },

    parar,
    situacao,

    async executar(comando, limiteMs, sinal) {
      const naoIniciou: ResultadoDaExecucao = { iniciou: false, codigo: null, stdout: "", estourouOLimite: false };
      if (encerrado) return naoIniciou;
      let filho: Filho;
      try {
        filho = Bun.spawn([...comando.argv], {
          env: ambienteDoFilho(comando.env),
          stdin: "ignore",
          stdout: "pipe",
          stderr: comando.capturarStderr === true ? "pipe" : "ignore",
          windowsHide: true,
        });
      } catch {
        return naoIniciou;
      }
      const leitor = filho.stdout === undefined ? null : filho.stdout.getReader();
      const leitorDoErro = comando.capturarStderr === true && filho.stderr !== undefined ? filho.stderr.getReader() : null;
      const largarStdout = () => {
        void leitor?.cancel().catch(() => {});
        void leitorDoErro?.cancel().catch(() => {});
      };
      avulsos.set(filho, largarStdout);
      let saiu = false;
      let estourouOLimite = false;
      const derrubar = () => {
        estourouOLimite = true;
        if (plataforma === "win32") filho.kill();
        else filho.kill("SIGKILL");
      };
      // Um neto que herdou o stdout segura o pipe aberto depois de o comando sair ou morrer.
      // No limite a leitura é cancelada, então a espera nunca passa dele.
      const cortar = () => {
        if (!saiu) derrubar();
        largarStdout();
      };
      const temporizador = setTimeout(cortar, limiteMs);
      sinal?.addEventListener("abort", cortar, { once: true });
      if (sinal?.aborted === true) cortar();
      try {
        const decodificador = new TextDecoder();
        let stdout = "";
        const leitura = (async () => {
          for (;;) {
            const lido = await leitor?.read();
            if (lido === undefined || lido.done) return;
            stdout += decodificador.decode(lido.value, { stream: true });
            if (stdout.length > LIMITE_DO_STDOUT) derrubar();
          }
        })().catch(() => {});
        let stderr = "";
        const leituraDoErro = (async () => {
          const decodificadorDoErro = new TextDecoder();
          for (;;) {
            const lido = await leitorDoErro?.read();
            if (lido === undefined || lido.done) return;
            if (stderr.length < LIMITE_DO_STDERR) stderr += decodificadorDoErro.decode(lido.value, { stream: true });
          }
        })().catch(() => {});
        const codigo = await filho.exited;
        saiu = true;
        await Promise.all([leitura, leituraDoErro]);
        return { iniciou: true, codigo, stdout, ...(leitorDoErro === null ? {} : { stderr: stderr.slice(0, LIMITE_DO_STDERR) }), estourouOLimite };
      } finally {
        clearTimeout(temporizador);
        sinal?.removeEventListener("abort", cortar);
        avulsos.delete(filho);
      }
    },

    encerrarPid: (pid) => encerrarPid(pid, { educado: true, plataforma, registro }),

    pids() {
      const dasVagas = [...vagas.values()].flatMap((vaga) => (vaga.filho === null ? [] : [vaga.filho.pid]));
      return [...dasVagas, ...[...avulsos.keys()].map((filho) => filho.pid)];
    },

    async encerrar() {
      encerrado = true;
      const pendentes = [...vagas.keys()].map((papel) => parar(papel));
      for (const [filho, largarStdout] of avulsos) {
        if (plataforma === "win32") filho.kill();
        else filho.kill("SIGKILL");
        pendentes.push(filho.exited.then(largarStdout));
      }
      await Promise.all(pendentes);
    },
  };
}
