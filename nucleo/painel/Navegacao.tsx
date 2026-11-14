import { CalendarCheck, ListTodo, PanelLeftClose, PanelLeftOpen, PlugZap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hashDaRota, type Secao } from "./rota";

const ITENS: readonly { readonly secao: Secao; readonly nome: string; readonly Icone: LucideIcon }[] = [
  { secao: "meu-dia", nome: "Meu dia", Icone: CalendarCheck },
  { secao: "tarefas", nome: "Tarefas", Icone: ListTodo },
  { secao: "conexoes", nome: "Conexões", Icone: PlugZap },
];

export const NOMES_DAS_SECOES: { readonly [S in Secao]: string } = { "meu-dia": "Meu dia", tarefas: "Tarefas", conexoes: "Conexões" };

const CHAVE_RECOLHIDA = "secretaria.navegacao-recolhida";

function lerRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === "1";
  } catch {
    return false;
  }
}

function gravarRecolhida(recolhida: boolean): void {
  try {
    localStorage.setItem(CHAVE_RECOLHIDA, recolhida ? "1" : "0");
  } catch {
    // Sem armazenamento a escolha vale só nesta aba.
  }
}

/** Lateral no computador, com o botão de recolher no cabeçalho; barra de baixo no celular. Sem barra no topo. */
export function Navegacao({ atual }: { atual: Secao | null }) {
  const [recolhida, setRecolhida] = useState(lerRecolhida);
  const alternar = () => {
    setRecolhida(!recolhida);
    gravarRecolhida(!recolhida);
  };
  const rotuloDoBotao = recolhida ? "Abrir a lateral" : "Recolher a lateral";

  return (
    <>
      <nav aria-label="Telas" className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 py-2.5 pl-2.5 md:flex", recolhida ? "w-[4.25rem]" : "w-56")}>
        <div className={cn("mb-2 flex h-10 items-center", recolhida ? "justify-center" : "justify-between pl-3")}>
          {!recolhida && <span className="text-[15px] font-semibold tracking-tight">Secretária</span>}
          <Button variant="ghost" size="icon-sm" aria-label={rotuloDoBotao} title={rotuloDoBotao} onClick={alternar}>
            {recolhida ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        </div>
        {ITENS.map(({ secao, nome, Icone }) => (
          <a
            key={secao}
            href={hashDaRota({ tela: secao })}
            aria-current={atual === secao ? "page" : undefined}
            title={recolhida ? nome : undefined}
            className={cn(
              "flex h-9 items-center gap-3 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground",
              recolhida ? "justify-center" : "px-3",
              atual === secao && "bg-accent font-medium text-foreground",
            )}
          >
            <Icone aria-hidden className="size-4 shrink-0" />
            <span className={cn(recolhida && "sr-only")}>{nome}</span>
          </a>
        ))}
      </nav>

      <nav aria-label="Telas" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        {ITENS.map(({ secao, nome, Icone }) => (
          <a
            key={secao}
            href={hashDaRota({ tela: secao })}
            aria-current={atual === secao ? "page" : undefined}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-xs text-muted-foreground outline-none hover:text-foreground",
              atual === secao && "font-medium text-foreground",
            )}
          >
            <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", atual === secao && "bg-accent")}>
              <Icone aria-hidden className="size-5" />
            </span>
            {nome}
          </a>
        ))}
      </nav>
    </>
  );
}
