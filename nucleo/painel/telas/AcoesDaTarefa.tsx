import { CalendarClock, Check, RotateCcw, Trash2 } from "lucide-react";
import { useId, useReducer, useState, type FormEvent, type ReactNode } from "react";
import type { Dia } from "../../dominio";
import type { Tarefa } from "../../tarefas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PedidoDaTarefa } from "../api";
import { PASSO_FECHADO, avisoDoFeito, pedidoDoPasso, reduzirPasso, somarDias } from "../tarefas";
import { api, type Executor } from "./comum";

export interface PropsDasAcoes {
  readonly tarefa: Tarefa;
  readonly hoje: Dia;
  readonly executor: Executor;
}

/** Envia o pedido pela API e devolve se deu certo. Conflito e erro viram aviso no `executor`. */
function enviar(executor: Executor, tarefa: Tarefa, pedido: PedidoDaTarefa, hoje: Dia): Promise<boolean> {
  return executor.executar(
    () => api.agir(tarefa.id, pedido),
    (resposta) => avisoDoFeito(pedido, resposta, hoje),
  );
}

/** Descartar mostra o aviso com "Desfazer", que reabre a tarefa com a versão que o descarte devolveu. */
function descartar(executor: Executor, tarefa: Tarefa, hoje: Dia): Promise<boolean> {
  const pedido: PedidoDaTarefa = { acao: "descartar", corpo: { versao: tarefa.versao } };
  return executor.executar(
    () => api.agir(tarefa.id, pedido),
    (resposta) => ({
      ...avisoDoFeito(pedido, resposta, hoje),
      desfazer: () => void enviar(executor, resposta.tarefa, { acao: "reabrir", corpo: { versao: resposta.tarefa.versao } }, hoje),
    }),
  );
}

/**
 * Os botões e o passo aberto de uma tarefa, separados para quem chama pôr cada um no seu lugar.
 * Na `linha` do Meu dia, a ação principal vai por último e em destaque.
 */
export function useAcoesDaTarefa({ tarefa, hoje, executor, arranjo }: PropsDasAcoes & { readonly arranjo: "detalhe" | "linha" }): {
  readonly botoes: ReactNode;
  readonly passo: ReactNode;
} {
  const [passo, despachar] = useReducer(reduzirPasso, PASSO_FECHADO);
  const [erro, setErro] = useState<string | null>(null);
  const base = useId();
  const ocupado = executor.ocupado;

  const confirmar = async (semProximo = false) => {
    const lido = pedidoDoPasso(passo, tarefa, hoje, semProximo);
    if (!lido.ok) {
      setErro(lido.mensagem);
      return;
    }
    setErro(null);
    if (await enviar(executor, tarefa, lido.valor, hoje)) despachar({ tipo: "fechar" });
  };

  const aoEnviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    void confirmar();
  };

  const abrir = (tipo: "abrir_concluir" | "abrir_adiar") => {
    setErro(null);
    despachar(tipo === "abrir_concluir" ? { tipo } : { tipo, sugestao: somarDias(hoje, 1) });
  };

  const naLinha = arranjo === "linha";
  const botaoConcluir = (
    <Button key="concluir" variant={naLinha ? "default" : "outline"} size="sm" disabled={ocupado} aria-expanded={passo.tipo === "concluir"} onClick={() => abrir("abrir_concluir")}>
      <Check aria-hidden />
      Concluir
    </Button>
  );
  const botaoAdiar = (
    <Button key="adiar" variant="outline" size="sm" disabled={ocupado} aria-expanded={passo.tipo === "adiar"} onClick={() => abrir("abrir_adiar")}>
      <CalendarClock aria-hidden />
      Adiar
    </Button>
  );
  const botaoDescartar = (
    <Button key="descartar" variant="outline" size="sm" disabled={ocupado} onClick={() => void descartar(executor, tarefa, hoje)}>
      <Trash2 aria-hidden />
      Descartar
    </Button>
  );
  const botoes = naLinha ? [botaoDescartar, botaoAdiar, botaoConcluir] : [botaoConcluir, botaoAdiar, botaoDescartar];

  const aberto = (
    <>
      {passo.tipo === "concluir" && (
        <form onSubmit={aoEnviar} className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5" aria-label="Concluir a tarefa">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-proximo`}>Qual é o próximo passo?</Label>
            <Input
              id={`${base}-proximo`}
              autoFocus
              value={passo.proximo}
              placeholder="Ex.: ligar para confirmar a visita"
              aria-invalid={erro !== null}
              onChange={(e) => despachar({ tipo: "proximo", texto: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-56">
            <Label htmlFor={`${base}-vence`}>Para quando (opcional)</Label>
            <Input id={`${base}-vence`} type="date" min={hoje} value={passo.vence} onChange={(e) => despachar({ tipo: "vence", texto: e.target.value })} />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className={naLinha ? "flex flex-wrap justify-end gap-2" : "flex flex-wrap gap-2"}>
            {naLinha ? (
              <>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => despachar({ tipo: "fechar" })}>
                  Cancelar
                </Button>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => void confirmar(true)}>
                  Concluir sem próximo passo
                </Button>
                <Button type="submit" disabled={ocupado}>
                  Concluir e criar o próximo
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={ocupado}>
                  Concluir e criar o próximo
                </Button>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => void confirmar(true)}>
                  Concluir sem próximo passo
                </Button>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => despachar({ tipo: "fechar" })}>
                  Cancelar
                </Button>
              </>
            )}
          </div>
        </form>
      )}

      {passo.tipo === "adiar" && (
        <form onSubmit={aoEnviar} className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5" aria-label="Adiar a tarefa">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-para`}>Para quando?</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`${base}-para`}
                type="date"
                min={hoje}
                className="sm:w-48"
                value={passo.para}
                aria-invalid={erro !== null}
                onChange={(e) => despachar({ tipo: "para", texto: e.target.value })}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => despachar({ tipo: "para", texto: somarDias(hoje, 1) })}>
                Amanhã
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => despachar({ tipo: "para", texto: somarDias(hoje, 7) })}>
                Em 7 dias
              </Button>
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className={naLinha ? "flex flex-wrap justify-end gap-2" : "flex flex-wrap gap-2"}>
            {naLinha ? (
              <>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => despachar({ tipo: "fechar" })}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={ocupado}>
                  Adiar
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={ocupado}>
                  Adiar
                </Button>
                <Button type="button" variant="outline" disabled={ocupado} onClick={() => despachar({ tipo: "fechar" })}>
                  Cancelar
                </Button>
              </>
            )}
          </div>
        </form>
      )}
    </>
  );

  return { botoes, passo: passo.tipo === "fechado" ? null : aberto };
}

/** Concluir, adiar e descartar de uma tarefa aberta. Concluir e adiar abrem um passo curto embaixo dos botões. */
export function AcoesDaTarefa(props: PropsDasAcoes) {
  const { botoes, passo } = useAcoesDaTarefa({ ...props, arranjo: "detalhe" });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{botoes}</div>
      {passo}
    </div>
  );
}

/** Concluída e descartada só voltam pelo vendedor, aqui. */
export function BotaoDeReabrir({ tarefa, hoje, executor }: PropsDasAcoes) {
  return (
    <Button
      variant="outline"
      disabled={executor.ocupado}
      onClick={() => void enviar(executor, tarefa, { acao: "reabrir", corpo: { versao: tarefa.versao } }, hoje)}
    >
      <RotateCcw aria-hidden />
      Reabrir
    </Button>
  );
}
