import { CircleCheck, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ROTULOS_DAS_ACOES, type Acao, type ErroOperacao, type Instante } from "../../dominio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SELO_DO_TOM, type Descricao, type Tom } from "../descrever";
import { restante } from "../tempo";

const ESTILO_DO_SELO: { readonly [T in Tom]: string } = {
  neutro: "bg-muted text-muted-foreground",
  andamento: "bg-accent text-foreground",
  ok: "bg-primary/15 text-primary",
  atencao: "bg-destaque/15 text-destaque",
};

const ICONE_DO_SELO: { readonly [T in Tom]: LucideIcon | null } = {
  neutro: null,
  andamento: LoaderCircle,
  ok: CircleCheck,
  atencao: TriangleAlert,
};

export function Selo({ tom, texto = SELO_DO_TOM[tom] }: { tom: Tom; texto?: string }) {
  const Icone = ICONE_DO_SELO[tom];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap", ESTILO_DO_SELO[tom])}>
      {Icone && <Icone aria-hidden className={cn("size-3.5", tom === "andamento" && "animate-spin")} />}
      {texto}
    </span>
  );
}

/** O rótulo da conta de e-mail, como etiqueta. */
export function Etiqueta({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 max-w-40 shrink-0 items-center truncate rounded-full bg-accent px-2.5 text-xs font-semibold">{children}</span>;
}

export function Prazo({ expiraEm, agora, rotulo }: { expiraEm: Instante; agora: Date; rotulo: string }) {
  const falta = restante(expiraEm, agora);
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      {falta === null ? (
        "O tempo acabou. A Secretária vai atualizar este cartão."
      ) : (
        <>
          {rotulo} <span className="whitespace-nowrap text-foreground">{falta}</span>.
        </>
      )}
    </p>
  );
}

export interface PropsDoCartao {
  readonly nome: string;
  readonly Icone: LucideIcon;
  readonly descricao: Descricao;
  /** Erro da última ação, mostrado enquanto a fase não muda. */
  readonly erro: ErroOperacao | null;
  readonly children?: ReactNode;
  readonly rodape?: ReactNode;
}

/** Cabeçalho, corpo e rodapé de todo cartão de Conexões. Os botões do rodapé ficam à direita. */
export function MolduraDoCartao(props: { nome: string; Icone: LucideIcon; selos: ReactNode; children: ReactNode; rodape?: ReactNode }) {
  const idDoTitulo = `cartao-${props.nome}`;
  const { Icone } = props;
  return (
    <Card aria-labelledby={idDoTitulo} className="h-full min-w-0 gap-0 py-0" role="region">
      <header className="flex items-center gap-3 border-b px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          <Icone aria-hidden className="size-5" />
        </span>
        <h2 id={idDoTitulo} className="min-w-0 flex-1 truncate text-base font-semibold">
          {props.nome}
        </h2>
        {props.selos}
      </header>
      <div className="flex flex-1 flex-col gap-4 px-5 py-5">{props.children}</div>
      {props.rodape && <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4">{props.rodape}</footer>}
    </Card>
  );
}

export function Cartao({ nome, Icone, descricao, erro, children, rodape }: PropsDoCartao) {
  return (
    <MolduraDoCartao nome={nome} Icone={Icone} selos={<Selo tom={descricao.tom} />} rodape={rodape}>
        <div className="space-y-1.5">
          <p role="status" className="text-[15px] leading-snug font-medium text-pretty">
            {descricao.frase}
          </p>
          {descricao.identidade && <p className="truncate text-sm text-foreground">{descricao.identidade}</p>}
          {descricao.detalhes.map((detalhe) => (
            <p key={detalhe} className="text-sm text-muted-foreground tabular-nums">
              {detalhe}
            </p>
          ))}
        </div>

        {descricao.proximoPasso && (
          <p className="rounded-lg bg-destaque/10 px-3 py-2.5 text-sm leading-snug text-foreground">
            <span className="font-medium text-destaque">O que fazer: </span>
            {descricao.proximoPasso}
          </p>
        )}

        {children}

        {erro && <AlertaDeErro erro={erro} />}
    </MolduraDoCartao>
  );
}

export function AlertaDeErro({ erro }: { erro: ErroOperacao }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2.5 text-sm leading-snug">
      <p className="font-medium text-destructive">{erro.mensagem}</p>
      <p className="text-muted-foreground">{erro.acao}</p>
    </div>
  );
}

/** Só o passo que avança leva a cor da ação. Cancelar, testar e desconectar ficam em contorno. */
const ACOES_PRINCIPAIS: readonly Acao[] = ["conectar", "confirmar"];

export function BotaoDeAcao(props: { acao: Acao; desabilitado: boolean; aoClicar: () => void }) {
  return (
    <Button variant={ACOES_PRINCIPAIS.includes(props.acao) ? "default" : "outline"} disabled={props.desabilitado} onClick={props.aoClicar}>
      {ROTULOS_DAS_ACOES[props.acao]}
    </Button>
  );
}
