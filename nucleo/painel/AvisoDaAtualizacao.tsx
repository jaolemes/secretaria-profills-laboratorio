import { CircleArrowUp, CircleCheck, LockKeyhole, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { EstadoDaAtualizacao } from "../atualizacao";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import {
  SEM_VOLTA,
  acompanharAVolta,
  lerNaVolta,
  sondarAVolta,
  vistaDaAtualizacao,
  type AvisoDaAtualizacao,
  type BotaoDaAtualizacao,
  type IconeDaAtualizacao,
  type VistaDaAtualizacao,
} from "./atualizacao";
import { chaveDosConectores, ehEstadoDaAtualizacao, type Conexao } from "./conexao";
import { api } from "./telas/comum";

export interface ControleDaAtualizacao {
  readonly vista: VistaDaAtualizacao | null;
  /** Um pedido em curso, ou o canal caído: o botão fica apagado. */
  readonly ocupado: boolean;
  /** O servidor parou no meio da atualização e o painel espera a volta dele: o aviso de sem conexão não aparece. */
  readonly esperandoAVolta: boolean;
  agir(acao: BotaoDaAtualizacao["acao"]): void;
}

/**
 * O estado da atualização para o painel inteiro. A página abre lendo com busca; depois relê sem busca
 * quando um conector, uma rodada ou um cartão muda, porque o bloqueio depende deles. Cada passo chega
 * pelo SSE. Quando o servidor some no meio, ela pergunta pela volta e recarrega na versão nova.
 */
export function useAtualizacao(conexao: Conexao): ControleDaAtualizacao {
  const [estado, setEstado] = useState<EstadoDaAtualizacao | null>(null);
  const [pedido, setPedido] = useState<BotaoDaAtualizacao["acao"] | null>(null);
  const [volta, setVolta] = useState(SEM_VOLTA);
  const versaoDaPagina = useRef<string | null>(null);
  const atual = useRef(estado);
  atual.current = estado;

  const receber = useCallback((lido: EstadoDaAtualizacao) => {
    versaoDaPagina.current ??= lido.instalada;
    const decisao = lerNaVolta(versaoDaPagina.current, atual.current, lido);
    if (decisao === "recarregar") window.location.reload();
    if (decisao === "mostrar") setEstado(lido);
  }, []);

  const ler = useCallback(
    async (releitura: boolean) => {
      const lido = await api.atualizacao(releitura);
      if (lido.ok && ehEstadoDaAtualizacao(lido.dados)) receber(lido.dados);
    },
    [receber],
  );

  const abriu = useRef(false);
  const mudou = `${conexao.canal}:${chaveDosConectores(conexao.estado)}:${conexao.sincronizacao.tipo}:${conexao.rodadasTerminadas}:${conexao.mudancasDeTarefas}`;
  useEffect(() => {
    if (!abriu.current) {
      abriu.current = true;
      void ler(false);
    } else if (conexao.canal === "aberto") void ler(true);
  }, [mudou, ler]);

  useEffect(() => {
    if (conexao.atualizacao !== null) receber(conexao.atualizacao);
  }, [conexao.atualizacao, receber]);

  const atualizando = estado?.fase === "atualizando";
  const proxima = acompanharAVolta(volta, estado?.fase ?? null, conexao.canal);
  if (proxima !== volta) setVolta(proxima);
  const sondando = atualizando && proxima.perdeu && !proxima.desistiu;

  useEffect(() => {
    if (!sondando) return;
    let valendo = true;
    void sondarAVolta(versaoDaPagina.current, {
      agora: () => Date.now(),
      esperar: (ms) => new Promise<void>((resolver) => setTimeout(resolver, ms)),
      versaoNoAr: async () => {
        const info = await api.info();
        return info.ok ? info.dados.versaoNucleo : null;
      },
      lerAtualizacao: async () => {
        const lido = await api.atualizacao(true);
        return lido.ok && ehEstadoDaAtualizacao(lido.dados) ? lido.dados : null;
      },
      valendo: () => valendo,
      receber,
      recarregar: () => window.location.reload(),
    }).then((fim) => {
      if (fim === "desistiu") setVolta((atual) => ({ ...atual, desistiu: true }));
    });
    return () => {
      valendo = false;
    };
  }, [sondando, receber]);

  const agir = useCallback(
    (acao: BotaoDaAtualizacao["acao"]) => {
      setPedido(acao);
      void (async () => {
        const feito = acao === "aplicar" ? await api.aplicarAtualizacao() : await api.conferirAtualizacao();
        setPedido(null);
        if (feito.ok) return receber(feito.dados);
        // A recusa traz o estado que vale agora, com o bloqueio: o cartão mostra a explicação.
        const valendo = (feito.erro as { readonly atual?: unknown }).atual;
        if (ehEstadoDaAtualizacao(valendo)) receber(valendo);
        else void ler(true);
      })();
    },
    [receber, ler],
  );

  return {
    vista: vistaDaAtualizacao(estado, pedido === "conferir"),
    ocupado: pedido !== null || conexao.canal !== "aberto",
    esperandoAVolta: atualizando && proxima.perdeu && !proxima.desistiu,
    agir,
  };
}

const ICONES: { readonly [I in IconeDaAtualizacao]: LucideIcon } = {
  versao_nova: CircleArrowUp,
  girando: RefreshCw,
  feito: CircleCheck,
  alerta: TriangleAlert,
  sem_rede: WifiOff,
};

/** O ponto de novidade: a cor do texto, para não parecer o laranja de atenção das conexões. */
export function PontoDeNovidade({ className }: { className?: string }) {
  return <span aria-hidden data-ponto="novidade" className={cn("absolute top-[5px] right-[5px] size-[7px] rounded-full bg-foreground", className)} />;
}

export function SimboloDaAtualizacao({ icone, className }: { icone: IconeDaAtualizacao; className?: string }) {
  const Icone = ICONES[icone];
  return <Icone aria-hidden className={cn("size-4 shrink-0", icone === "girando" && "animate-spin", className)} />;
}

/** O bloco do cartão do pé: título, frase, barra ou trava, e o botão à direita. */
export function AvisoNoCartao({ aviso, ocupado, agir }: { aviso: AvisoDaAtualizacao; ocupado: boolean; agir: ControleDaAtualizacao["agir"] }) {
  const id = useId();
  const { botao, trava, progresso } = aviso;
  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-3 pt-2.5 pb-[11px]">
      <div className="flex min-w-0 flex-[1_1_130px] flex-col gap-0.5">
        <p className="flex items-center gap-[7px] text-[13px] font-semibold text-foreground">
          <SimboloDaAtualizacao icone={aviso.icone} />
          {aviso.titulo}
        </p>
        {aviso.textos.map((texto) => (
          <p key={texto} className="text-[12.5px] text-muted-foreground">
            {texto}
          </p>
        ))}
      </div>
      {progresso !== null && (
        <div role="progressbar" aria-label="Progresso da atualização" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso} className="h-1 basis-full overflow-hidden rounded-sm bg-accent">
          <i className="block h-full bg-foreground transition-[width] duration-500 ease-out" style={{ width: `${progresso}%` }} />
        </div>
      )}
      {trava !== null && (
        <p id={`${id}-trava`} className="flex basis-full items-start gap-1.5 text-[12.5px] text-muted-foreground">
          <LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{trava}</span>
        </p>
      )}
      {botao !== null && (
        <div className="ml-auto flex">
          <Button
            size="sm"
            variant={botao.principal ? "default" : "outline"}
            disabled={trava !== null || ocupado}
            aria-describedby={trava === null ? undefined : `${id}-trava`}
            onClick={() => agir(botao.acao)}
          >
            {botao.rotulo}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A versão, dentro da lista aberta das conexões. Com versão nova, o O que muda embaixo, como texto. */
export function LinhaDaVersao({ vista }: { vista: VistaDaAtualizacao }) {
  return (
    <div className="border-b px-3 py-2 text-[12.5px] text-muted-foreground">
      <p className="flex min-w-0 items-center gap-2">
        <CircleArrowUp aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">{vista.versao}</span>
      </p>
      {vista.oQueMuda.length > 0 && (
        <ul aria-label="O que muda" className="mt-1.5 flex list-disc flex-col gap-[3px] pl-[18px]">
          {vista.oQueMuda.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
