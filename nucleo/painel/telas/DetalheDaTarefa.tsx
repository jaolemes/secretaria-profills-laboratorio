import { ArrowLeft } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { diaEm, type Dia } from "../../dominio";
import type { Nota } from "../../tarefas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { hashDaRota } from "../rota";
import { lerNota } from "../tarefas";
import { momento } from "../tempo";
import { AcoesDaTarefa, BotaoDeReabrir } from "./AcoesDaTarefa";
import { AvisoFlutuante, CLASSE_DO_CAMPO_DE_TEXTO, ErroDeCarga, MetaDaTarefa, api, useCarga, useExecutor, type Executor } from "./comum";

const AUTORES = { vendedor: "Você", agente: "Agente" } as const;

/** As notas da mais antiga para a mais nova. O texto vai como texto, com as quebras de linha do autor. */
export function ListaDeNotas({ notas, agora }: { notas: readonly Nota[]; agora: Date }) {
  if (notas.length === 0) return <p className="px-5 py-5 text-sm text-muted-foreground">Nenhuma nota ainda.</p>;
  return (
    <ol className="divide-y">
      {notas.map((nota) => (
        <li key={nota.id} className="flex flex-col gap-1.5 px-5 py-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{AUTORES[nota.autor]}</span> · {momento(nota.criadaEm, agora)}
          </p>
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{nota.texto}</p>
          {nota.proximoPasso !== null && (
            <p className="text-sm leading-snug break-words whitespace-pre-wrap text-muted-foreground">
              <span className="font-medium text-foreground">Próximo passo: </span>
              {nota.proximoPasso}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function Anotar({ id, executor }: { id: string; executor: Executor }) {
  const base = useId();
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const lido = lerNota(texto);
    if (!lido.ok) {
      setErro(lido.mensagem);
      return;
    }
    setErro(null);
    const salvou = await executor.executar(
      () => api.agir(id, { acao: "anotar", corpo: { texto: lido.valor } }),
      () => ({ tom: "feito", texto: "Nota salva.", detalhe: null }),
    );
    if (salvou) setTexto("");
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2 border-t px-5 py-4">
      <Label htmlFor={`${base}-nota`}>Anotar</Label>
      <textarea
        id={`${base}-nota`}
        className={CLASSE_DO_CAMPO_DE_TEXTO}
        value={texto}
        placeholder="O que aconteceu, o que o cliente disse"
        aria-invalid={erro !== null}
        onChange={(e) => setTexto(e.target.value)}
      />
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div>
        <Button type="submit" disabled={executor.ocupado}>
          Salvar nota
        </Button>
      </div>
    </form>
  );
}

export function DetalheDaTarefa({ id, mudancas }: { id: string; mudancas: number }) {
  const carga = useCarga(`tarefa:${id}`, () => api.ver(id), mudancas);
  const executor = useExecutor(carga.recarregar);
  const hoje: Dia = diaEm(new Date());
  const dados = carga.dados;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="outline" size="sm" asChild>
          <a href={hashDaRota({ tela: "tarefas" })}>
            <ArrowLeft aria-hidden />
            Tarefas
          </a>
        </Button>
      </div>
      {carga.erro && <ErroDeCarga erro={carga.erro} tentar={carga.recarregar} />}
      {dados !== null && (
        <>
          <header className="flex flex-col gap-2.5">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words">{dados.tarefa.titulo}</h1>
            <MetaDaTarefa tarefa={dados.tarefa} hoje={hoje} comEstado />
          </header>
          <Card className="gap-0 py-0">
            <div className="px-5 py-4">
              {dados.tarefa.estado === "aberta" ? (
                <AcoesDaTarefa key={dados.tarefa.versao} tarefa={dados.tarefa} hoje={hoje} executor={executor} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {dados.tarefa.estado === "concluida" ? "Esta tarefa está concluída." : "Esta tarefa foi descartada."} Reabra para voltar a trabalhar nela.
                  </p>
                  <BotaoDeReabrir tarefa={dados.tarefa} hoje={hoje} executor={executor} />
                </div>
              )}
            </div>
          </Card>
          <Card role="region" aria-labelledby="titulo-das-notas" className="gap-0 py-0">
            <header className="flex items-center gap-2 border-b px-5 py-3.5">
              <h2 id="titulo-das-notas" className="text-base font-semibold">
                Notas
              </h2>
              <span className="text-sm text-muted-foreground tabular-nums">{dados.notas.length}</span>
            </header>
            <ListaDeNotas notas={dados.notas} agora={new Date()} />
            <Anotar id={id} executor={executor} />
          </Card>
        </>
      )}
      <AvisoFlutuante aviso={executor.aviso} fechar={executor.fecharAviso} />
    </div>
  );
}
