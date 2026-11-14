import { caminhosDosDados, type Ambiente } from "../ambiente";
import { falha, ok, type EstadoAgente, type Resultado } from "../dominio";
import { lerArquivoDoServidor, type ArquivoDoServidor, type Info } from "../servidor";

const LIMITE_DO_PEDIDO_MS = 30_000;
const LIMITE_DA_SONDA_MS = 3_000;

export interface ClienteDoServidor {
  readonly arquivo: ArquivoDoServidor;
  /** `prazoMs` troca os 30 s padrão, para o pedido que espera o CRM. */
  pedir<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown, prazoMs?: number): Promise<Resultado<T>>;
  /** Retratos do SSE do agente até `sinal` abortar ou o servidor fechar o fluxo. */
  eventos(sinal: AbortSignal): AsyncGenerator<EstadoAgente, void>;
}

function foraDoAr(): Resultado<never> {
  return falha("servidor_fora_do_ar");
}

function ehSaida(valor: unknown): valor is Resultado<unknown> & { v: 1 } {
  if (typeof valor !== "object" || valor === null) return false;
  const { v, ok: certo } = valor as { v?: unknown; ok?: unknown };
  return v === 1 && typeof certo === "boolean";
}

/**
 * Acha o servidor pelo `servidor.json` e confere em `/api/info` que quem responde naquela porta
 * é a Secretária desta instalação. Arquivo velho de um servidor que caiu dá `servidor_fora_do_ar`.
 */
export async function acharServidor(ambiente: Pick<Ambiente, "dirDados" | "plataforma">): Promise<Resultado<ClienteDoServidor>> {
  const arquivo = lerArquivoDoServidor(caminhosDosDados(ambiente).servidor);
  if (arquivo === null) return foraDoAr();
  try {
    const resposta = await fetch(`${arquivo.origem}/api/info`, { signal: AbortSignal.timeout(LIMITE_DA_SONDA_MS) });
    const corpo: unknown = await resposta.json();
    if (!ehSaida(corpo) || !corpo.ok) return foraDoAr();
    const info = corpo.dados as Partial<Info>;
    if (info.app !== "secretaria-profills" || info.idInstalacao !== arquivo.idInstalacao) return foraDoAr();
  } catch {
    return foraDoAr();
  }
  return ok(criarCliente(arquivo));
}

function criarCliente(arquivo: ArquivoDoServidor): ClienteDoServidor {
  const autorizacao = { Authorization: `Bearer ${arquivo.token}` };
  return {
    arquivo,
    async pedir<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown, prazoMs = LIMITE_DO_PEDIDO_MS): Promise<Resultado<T>> {
      let resposta: Response;
      try {
        resposta = await fetch(`${arquivo.origem}${caminho}`, {
          method: metodo,
          headers: corpo === undefined ? autorizacao : { ...autorizacao, "Content-Type": "application/json" },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: AbortSignal.timeout(prazoMs),
        });
      } catch {
        return foraDoAr();
      }
      const lido: unknown = await resposta.json().catch(() => null);
      if (!ehSaida(lido)) return falha("interno", `O servidor respondeu HTTP ${resposta.status} fora do envelope.`);
      const { v: _versao, ...resultado } = lido;
      return resultado as Resultado<T>;
    },
    async *eventos(sinal) {
      let resposta: Response;
      try {
        resposta = await fetch(`${arquivo.origem}/api/eventos`, { headers: autorizacao, signal: sinal });
      } catch {
        return;
      }
      if (!resposta.ok || resposta.body === null) return;
      const decodificador = new TextDecoder();
      let resto = "";
      try {
        for await (const bloco of resposta.body) {
          resto += decodificador.decode(bloco, { stream: true });
          let corte: number;
          while ((corte = resto.indexOf("\n\n")) !== -1) {
            const evento = resto.slice(0, corte);
            resto = resto.slice(corte + 2);
            const dados = evento.split("\n").find((linha) => linha.startsWith("data: "));
            if (evento.startsWith("event: estado") && dados !== undefined) yield JSON.parse(dados.slice(6)) as EstadoAgente;
          }
        }
      } catch {
        // Abortado pelo prazo ou pelo fim do servidor: quem chama decide pelo motivo.
      }
    },
  };
}
