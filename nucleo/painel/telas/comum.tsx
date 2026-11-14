import { Bot, CircleCheck, ExternalLink, PlugZap, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ErroOperacao } from "../../dominio";
import type { RespostaDaTarefa } from "../../servidor";
import type { EstadoDaTarefa, Tarefa } from "../../tarefas";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { criarApiDeTarefas, type Resposta } from "../api";
import { linkDoCrm, type AcaoDoMotivo } from "../meu-dia";
import { hashDaRota } from "../rota";
import { avisoDoErro, rotuloDoPrazo, type Aviso, type TomDoPrazo } from "../tarefas";
import type { Dia } from "../../dominio";

export const api = criarApiDeTarefas();

export interface Carga<T> {
  readonly dados: T | null;
  readonly erro: ErroOperacao | null;
  readonly carregando: boolean;
  recarregar(): void;
}

/**
 * Carrega pela API e recarrega quando `gatilho` muda (o `event: tarefas` do SSE) ou por `recarregar`.
 * Resposta que chega depois de outra mais nova é descartada. Os dados de outra `chave` não aparecem.
 */
export function useCarga<T>(chave: string, carregar: () => Promise<Resposta<T>>, gatilho: string | number): Carga<T> {
  const [carga, setCarga] = useState<{ chave: string; dados: T | null; erro: ErroOperacao | null; carregando: boolean }>({
    chave,
    dados: null,
    erro: null,
    carregando: true,
  });
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    let valendo = true;
    setCarga((atual) => ({ ...atual, carregando: true }));
    void carregar().then((resposta) => {
      if (!valendo) return;
      setCarga((atual) => ({
        chave,
        dados: resposta.ok ? resposta.dados : atual.chave === chave ? atual.dados : null,
        erro: resposta.ok ? null : resposta.erro,
        carregando: false,
      }));
    });
    return () => {
      valendo = false;
    };
    // `carregar` muda a cada render; o que importa para ele está em `chave`.
  }, [chave, gatilho, rodada]);

  const recarregar = useCallback(() => setRodada((n) => n + 1), []);
  const daChave = carga.chave === chave;
  return { dados: daChave ? carga.dados : null, erro: daChave ? carga.erro : null, carregando: carga.carregando || !daChave, recarregar };
}

export interface Executor {
  readonly ocupado: boolean;
  readonly aviso: Aviso | null;
  /** Roda a ação, mostra o aviso e recarrega a tela, deu certo ou não. Devolve se deu certo. */
  executar(fazer: () => Promise<Resposta<RespostaDaTarefa>>, feito: (resposta: RespostaDaTarefa) => Aviso): Promise<boolean>;
  /** Mostra um aviso que não veio de uma ação de tarefa. */
  avisar(aviso: Aviso): void;
  fecharAviso(): void;
}

/** O aviso com "Desfazer" ou com "Abrir no CRM" fica um pouco mais, para dar tempo de clicar. */
const AVISO_SOME_MS = 6000;
const AVISO_COM_DESFAZER_SOME_MS = 10_000;

export function useExecutor(recarregar: () => void): Executor {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const executar = useCallback<Executor["executar"]>(
    async (fazer, feito) => {
      setOcupado(true);
      setAviso(null);
      try {
        const resposta = await fazer();
        setAviso(resposta.ok ? feito(resposta.dados) : avisoDoErro(resposta.erro));
        return resposta.ok;
      } finally {
        setOcupado(false);
        recarregar();
      }
    },
    [recarregar],
  );

  useEffect(() => {
    if (aviso?.tom !== "feito") return;
    const relogio = setTimeout(() => setAviso(null), aviso.desfazer === undefined && aviso.link === undefined ? AVISO_SOME_MS : AVISO_COM_DESFAZER_SOME_MS);
    return () => clearTimeout(relogio);
  }, [aviso]);

  return { ocupado, aviso, executar, avisar: setAviso, fecharAviso: useCallback(() => setAviso(null), []) };
}

const ESTILO_DO_AVISO: { readonly [T in Aviso["tom"]]: string } = {
  feito: "border-primary/40",
  mudou: "border-destaque/50",
  erro: "border-destructive/50",
};

/** Fica no rodapé da janela, acima da navegação do celular e da gaveta, para ser visto de qualquer ponto da lista. `noTopo` o põe no alto, no meio. */
export function AvisoFlutuante({ aviso, fechar }: { aviso: Aviso | null; fechar: () => void }) {
  if (aviso === null) return null;
  const linkSeguro = aviso.link === undefined ? null : linkDoCrm(aviso.link);
  const Icone = aviso.tom === "feito" ? CircleCheck : aviso.tom === "mudou" ? RefreshCw : TriangleAlert;
  return (
    <div
      role={aviso.tom === "feito" ? "status" : "alert"}
      className={cn(
        "fixed z-[60] flex items-start gap-3 rounded-xl border bg-popover px-4 py-3 shadow-[var(--sombra-do-painel)]",
        aviso.noTopo ? "inset-x-4 top-4 md:inset-x-auto md:left-1/2 md:w-[26rem] md:-translate-x-1/2" : "inset-x-4 bottom-20 md:inset-x-auto md:right-6 md:bottom-6 md:w-[26rem]",
        ESTILO_DO_AVISO[aviso.tom],
      )}
    >
      <Icone aria-hidden className={cn("mt-0.5 size-5 shrink-0", aviso.tom === "feito" ? "text-primary" : aviso.tom === "mudou" ? "text-destaque" : "text-destructive")} />
      <div className="min-w-0 flex-1 text-sm leading-snug">
        <p className="font-medium">{aviso.texto}</p>
        {aviso.detalhe && <p className="mt-0.5 break-words text-muted-foreground">{aviso.detalhe}</p>}
        {aviso.linhas && (
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {aviso.linhas.map((linha) => (
              <li key={linha} className="break-words">
                {linha}
              </li>
            ))}
          </ul>
        )}
      </div>
      {linkSeguro !== null && (
        <Button variant="outline" size="sm" className="-my-0.5" asChild>
          <a href={linkSeguro} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Abrir no CRM
          </a>
        </Button>
      )}
      {aviso.desfazer && (
        <Button
          variant="outline"
          size="sm"
          className="-my-0.5"
          onClick={() => {
            fechar();
            aviso.desfazer?.();
          }}
        >
          Desfazer
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" className="-my-1 -mr-2" aria-label="Fechar o aviso" title="Fechar o aviso" onClick={fechar}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

export function ErroDeCarga({ erro, tentar }: { erro: ErroOperacao; tentar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/40 px-4 py-3.5 text-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">{erro.mensagem}</p>
        <p className="text-muted-foreground">{erro.acao}</p>
      </div>
      <Button variant="outline" onClick={tentar}>
        <RefreshCw aria-hidden />
        Tentar de novo
      </Button>
    </div>
  );
}

export function CabecalhoDaTela({ titulo, descricao, acao }: { titulo: string; descricao: string; acao?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        <p className="max-w-prose text-[15px] leading-snug text-muted-foreground">{descricao}</p>
      </div>
      {acao}
    </header>
  );
}

const ESTILO_DO_PRAZO: { readonly [T in TomDoPrazo]: string } = {
  atrasada: "bg-destaque/15 text-destaque",
  hoje: "bg-primary/15 text-primary",
  futura: "bg-muted text-muted-foreground",
  sem_data: "bg-muted text-muted-foreground",
};

const SELO = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap";

export function SeloDoPrazo({ venceEm, hoje }: { venceEm: Dia | null; hoje: Dia }) {
  const { texto, tom } = rotuloDoPrazo(venceEm, hoje);
  return <span className={cn(SELO, "tabular-nums", ESTILO_DO_PRAZO[tom])}>{texto}</span>;
}

export function SeloDoAgente() {
  return (
    <span className={cn(SELO, "bg-accent text-foreground")}>
      <Bot aria-hidden className="size-3.5" />
      sugerida pelo agente
    </span>
  );
}

const NOMES_DOS_ESTADOS: { readonly [E in EstadoDaTarefa]: string } = { aberta: "Aberta", concluida: "Concluída", descartada: "Descartada" };

export function SeloDoEstado({ estado }: { estado: EstadoDaTarefa }) {
  return <span className={cn(SELO, estado === "concluida" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{NOMES_DOS_ESTADOS[estado]}</span>;
}

/** Prazo, cliente e origem, numa linha que quebra. Tudo é texto: nada vira link nem HTML. */
export function MetaDaTarefa({ tarefa, hoje, comEstado = false, comSemData = true }: { tarefa: Tarefa; hoje: Dia; comEstado?: boolean; comSemData?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
      {comEstado && <SeloDoEstado estado={tarefa.estado} />}
      {tarefa.estado === "aberta" && (tarefa.venceEm !== null || comSemData) && <SeloDoPrazo venceEm={tarefa.venceEm} hoje={hoje} />}
      {tarefa.origem === "agente" && <SeloDoAgente />}
      {tarefa.clienteNome !== null && <span className="min-w-0 truncate">{tarefa.clienteNome}</span>}
      {tarefa.propostaCodigo !== null && <span className="whitespace-nowrap">Proposta {tarefa.propostaCodigo}</span>}
    </div>
  );
}

export const CLASSE_DO_CAMPO_DE_TEXTO =
  "min-h-20 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base leading-snug transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive disabled:opacity-50 md:text-sm";

/** O botão que o motivo pede: sincronizar aqui, ou ir a Conexões. */
export function BotaoDoMotivo({ botao, sincronizar, sincronizando }: { botao: AcaoDoMotivo; sincronizar: () => void; sincronizando: boolean }) {
  if (botao === "sincronizar") {
    return (
      <Button size="sm" disabled={sincronizando} onClick={sincronizar}>
        <RefreshCw aria-hidden />
        Sincronizar
      </Button>
    );
  }
  if (botao === "conexoes") {
    return (
      <Button size="sm" asChild>
        <a href={hashDaRota({ tela: "conexoes" })}>
          <PlugZap aria-hidden />
          Abrir Conexões
        </a>
      </Button>
    );
  }
  return null;
}
