import type { AndamentoDaSincronizacao } from "../conectores";
import { verComoAgente, type EstadoPainel } from "../dominio";

export const INTERVALO_MINIMO_MS = 150;
const KEEPALIVE_MS = 20_000;

type Visao = "painel" | "agente";

export interface Relogio {
  agora(): number;
  depois(ms: number, tarefa: () => void): () => void;
}

export const relogioReal: Relogio = {
  agora: () => performance.now(),
  depois(ms, tarefa) {
    const id = setTimeout(tarefa, ms);
    return () => clearTimeout(id);
  },
};

export interface Publicador {
  /** Avisa que o estado mudou. Rajadas se fundem: no máximo um envio a cada 150 ms, sempre com o mais novo. */
  mudou(): void;
  /** Avisa que alguma tarefa mudou. O evento `tarefas` não leva a lista: o painel recarrega pela API. */
  tarefasMudaram(): void;
  /** Um passo da sincronização, igual para o painel e o agente. Não leva dado do CRM: quem quer o dado recarrega o Meu dia. */
  sincronizacao(andamento: AndamentoDaSincronizacao): void;
  /** Corpo do SSE. O primeiro evento é o retrato atual. */
  assinar(visao: Visao): ReadableStream<Uint8Array>;
  /** Fecha todos os fluxos abertos. Assinatura depois disso já nasce fechada. */
  fechar(): void;
}

function evento(estado: unknown): string {
  return `event: estado\ndata: ${JSON.stringify(estado)}\n\n`;
}

/**
 * O SSE manda sempre o retrato inteiro. O agente recebe a visão sem QR nem código de pareamento,
 * calculada aqui, então nenhum fluxo do agente chega a carregar o retrato do painel.
 */
export function criarPublicador(retrato: () => EstadoPainel, relogio: Relogio = relogioReal): Publicador {
  const codificador = new TextEncoder();
  const fluxos = new Set<{ readonly visao: Visao; readonly controle: ReadableStreamDefaultController<Uint8Array> }>();
  let ultimoEnvio = Number.NEGATIVE_INFINITY;
  let agendado: (() => void) | null = null;
  let fechado = false;
  let cancelarKeepalive: (() => void) | null = null;

  function escrever(controle: ReadableStreamDefaultController<Uint8Array>, texto: string): boolean {
    try {
      controle.enqueue(codificador.encode(texto));
      return true;
    } catch {
      return false;
    }
  }

  function textoDe(visao: Visao, painel: EstadoPainel): string {
    return evento(visao === "painel" ? painel : verComoAgente(painel));
  }

  function enviar(): void {
    agendado = null;
    ultimoEnvio = relogio.agora();
    const painel = retrato();
    const textos = { painel: textoDe("painel", painel), agente: textoDe("agente", painel) };
    for (const fluxo of fluxos) if (!escrever(fluxo.controle, textos[fluxo.visao])) fluxos.delete(fluxo);
  }

  function manterVivo(): void {
    cancelarKeepalive = relogio.depois(KEEPALIVE_MS, () => {
      for (const fluxo of fluxos) if (!escrever(fluxo.controle, ": vivo\n\n")) fluxos.delete(fluxo);
      manterVivo();
    });
  }

  return {
    mudou() {
      if (fechado || agendado !== null) return;
      const espera = ultimoEnvio + INTERVALO_MINIMO_MS - relogio.agora();
      if (espera <= 0) enviar();
      else agendado = relogio.depois(espera, enviar);
    },
    tarefasMudaram() {
      if (fechado) return;
      for (const fluxo of fluxos) if (!escrever(fluxo.controle, "event: tarefas\ndata: {}\n\n")) fluxos.delete(fluxo);
    },
    sincronizacao(andamento) {
      if (fechado) return;
      const texto = `event: sincronizacao\ndata: ${JSON.stringify(andamento)}\n\n`;
      for (const fluxo of fluxos) if (!escrever(fluxo.controle, texto)) fluxos.delete(fluxo);
    },
    assinar(visao) {
      let meu: { readonly visao: Visao; readonly controle: ReadableStreamDefaultController<Uint8Array> } | null = null;
      return new ReadableStream<Uint8Array>({
        start(controle) {
          if (fechado) {
            controle.close();
            return;
          }
          meu = { visao, controle };
          fluxos.add(meu);
          if (cancelarKeepalive === null) manterVivo();
          escrever(controle, textoDe(visao, retrato()));
        },
        cancel() {
          if (meu !== null) fluxos.delete(meu);
        },
      });
    },
    fechar() {
      fechado = true;
      agendado?.();
      agendado = null;
      cancelarKeepalive?.();
      cancelarKeepalive = null;
      for (const fluxo of fluxos) {
        try {
          fluxo.controle.close();
        } catch {
          // O cliente já tinha ido embora.
        }
      }
      fluxos.clear();
    },
  };
}
