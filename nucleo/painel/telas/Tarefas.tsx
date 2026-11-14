import { ChevronRight, Plus } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { diaEm, type Dia } from "../../dominio";
import type { EstadoDaTarefa, Tarefa } from "../../tarefas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { hashDaRota } from "../rota";
import { lerNovaTarefa } from "../tarefas";
import { AvisoFlutuante, CabecalhoDaTela, ErroDeCarga, MetaDaTarefa, api, useCarga, useExecutor, type Executor } from "./comum";

const FILTROS: readonly { readonly estado: EstadoDaTarefa; readonly rotulo: string; readonly vazio: string }[] = [
  { estado: "aberta", rotulo: "Abertas", vazio: "Nenhuma tarefa aberta. Crie uma ou peça ao seu agente." },
  { estado: "concluida", rotulo: "Concluídas", vazio: "Nenhuma tarefa concluída ainda." },
  { estado: "descartada", rotulo: "Descartadas", vazio: "Nenhuma tarefa descartada." },
];

function Filtro({ atual, escolher }: { atual: EstadoDaTarefa; escolher: (estado: EstadoDaTarefa) => void }) {
  return (
    <div role="group" aria-label="Mostrar tarefas" className="inline-flex w-full rounded-lg border bg-sidebar p-1 sm:w-auto sm:self-start">
      {FILTROS.map(({ estado, rotulo }) => (
        <button
          key={estado}
          type="button"
          aria-pressed={atual === estado}
          onClick={() => escolher(estado)}
          className={cn(
            "h-11 flex-1 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground sm:flex-none md:h-8",
            atual === estado && "bg-accent text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

function NovaTarefa({ hoje, executor, fechar }: { hoje: Dia; executor: Executor; fechar: () => void }) {
  const base = useId();
  const [campos, setCampos] = useState({ titulo: "", vence: "", cliente: "" });
  const [erro, setErro] = useState<string | null>(null);
  const idDoRascunho = useRef(crypto.randomUUID());

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const lido = lerNovaTarefa(campos, hoje, idDoRascunho.current);
    if (!lido.ok) {
      setErro(lido.mensagem);
      return;
    }
    setErro(null);
    const criou = await executor.executar(
      () => api.criar(lido.valor),
      () => ({ tom: "feito", texto: "Tarefa criada.", detalhe: null }),
    );
    if (criou) {
      idDoRascunho.current = crypto.randomUUID();
      setCampos({ titulo: "", vence: "", cliente: "" });
      fechar();
    }
  };

  const mudar = (campo: keyof typeof campos) => (e: { target: { value: string } }) => setCampos((atuais) => ({ ...atuais, [campo]: e.target.value }));

  return (
    <Card role="region" aria-label="Nova tarefa" className="gap-0 py-0">
      <form onSubmit={enviar} className="flex flex-col gap-4 px-5 py-5">
        <h2 className="text-base font-semibold">Nova tarefa</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-titulo`}>Título</Label>
          <Input id={`${base}-titulo`} autoFocus value={campos.titulo} onChange={mudar("titulo")} placeholder="Ex.: mandar a proposta revisada" aria-invalid={erro !== null && campos.titulo.trim() === ""} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-vence`}>Prazo (opcional)</Label>
            <Input id={`${base}-vence`} type="date" min={hoje} value={campos.vence} onChange={mudar("vence")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-cliente`}>Cliente (opcional)</Label>
            <Input id={`${base}-cliente`} value={campos.cliente} onChange={mudar("cliente")} placeholder="Nome do cliente" />
          </div>
        </div>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={executor.ocupado}>
            Criar tarefa
          </Button>
          <Button type="button" variant="outline" onClick={fechar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LinhaDaLista({ tarefa, hoje }: { tarefa: Tarefa; hoje: Dia }) {
  return (
    <li>
      <a
        href={hashDaRota({ tela: "tarefa", id: tarefa.id })}
        className="flex items-center gap-3 px-5 py-3.5 transition-colors outline-none hover:bg-accent/60"
        aria-label={`Abrir a tarefa: ${tarefa.titulo}`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="line-clamp-2 text-[15px] leading-snug font-medium break-words">{tarefa.titulo}</p>
          <MetaDaTarefa tarefa={tarefa} hoje={hoje} />
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </a>
    </li>
  );
}

export function Tarefas({ mudancas, nova }: { mudancas: number; nova: boolean }) {
  const [estado, setEstado] = useState<EstadoDaTarefa>("aberta");
  const carga = useCarga(estado, () => api.listar(estado), mudancas);
  const executor = useExecutor(carga.recarregar);
  const hoje = diaEm(new Date());
  const filtro = FILTROS.find((f) => f.estado === estado)!;
  const fecharNova = () => window.location.replace(hashDaRota({ tela: "tarefas" }));

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoDaTela
        titulo="Tarefas"
        descricao="Todas as suas tarefas, as que você criou e as que o seu agente sugeriu."
        acao={
          !nova && (
            <Button asChild>
              <a href={hashDaRota({ tela: "nova" })}>
                <Plus aria-hidden />
                Nova tarefa
              </a>
            </Button>
          )
        }
      />
      {nova && <NovaTarefa hoje={hoje} executor={executor} fechar={fecharNova} />}
      <Filtro atual={estado} escolher={setEstado} />
      {carga.erro && <ErroDeCarga erro={carga.erro} tentar={carga.recarregar} />}
      {carga.dados !== null && (
        <Card className="gap-0 py-0">
          {carga.dados.tarefas.length === 0 ? (
            <p className="px-5 py-6 text-[15px] text-muted-foreground">{filtro.vazio}</p>
          ) : (
            <ul aria-label={`Tarefas ${filtro.rotulo.toLowerCase()}`} className="divide-y md:max-h-[calc(100dvh-20rem)] md:overflow-y-auto">
              {carga.dados.tarefas.map((tarefa) => (
                <LinhaDaLista key={tarefa.id} tarefa={tarefa} hoje={hoje} />
              ))}
            </ul>
          )}
        </Card>
      )}
      <AvisoFlutuante aviso={executor.aviso} fechar={executor.fecharAviso} />
    </div>
  );
}
