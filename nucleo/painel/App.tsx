import { LoaderCircle, WifiOff } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { NOMES_DAS_SECOES, Navegacao } from "./Navegacao";
import { chaveDosConectores } from "./conexao";
import { hashDaRota, lerRota, rotaInicial, secaoDaRota, type Rota } from "./rota";
import { Conexoes } from "./telas/Conexoes";
import { DetalheDaTarefa } from "./telas/DetalheDaTarefa";
import { MeuDia } from "./telas/MeuDia";
import { Tarefas } from "./telas/Tarefas";
import { useEstado } from "./useEstado";

function AvisoDeConexao({ canal, temEstado }: { canal: "conectando" | "aberto" | "sem_conexao"; temEstado: boolean }) {
  if (canal === "sem_conexao") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-destaque/40 bg-destaque/10 px-4 py-3.5">
        <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0 text-destaque" />
        <div>
          <p className="font-semibold">Sem conexão com a Secretária.</p>
          <p className="text-sm text-muted-foreground">Tentando de novo sozinho. Se continuar assim, peça ao seu agente para iniciar a Secretária.</p>
        </div>
      </div>
    );
  }
  if (canal === "conectando" && !temEstado) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Conectando à Secretária.
      </p>
    );
  }
  return null;
}

function assinarHash(avisar: () => void): () => void {
  window.addEventListener("hashchange", avisar);
  return () => window.removeEventListener("hashchange", avisar);
}

function useHash(): string {
  return useSyncExternalStore(assinarHash, () => window.location.hash);
}

function Tela({ rota, conexao }: { rota: Rota; conexao: ReturnType<typeof useEstado> }) {
  const mudancas = conexao.mudancasDeTarefas;
  switch (rota.tela) {
    case "meu-dia":
      return <MeuDia mudancas={mudancas} lista={rota.lista} sincronizacao={conexao.sincronizacao} rodadasTerminadas={conexao.rodadasTerminadas} conectores={chaveDosConectores(conexao.estado)} crm={conexao.estado?.conectores.crm.estado ?? null} />;
    case "tarefas":
    case "nova":
      return <Tarefas mudancas={mudancas} nova={rota.tela === "nova"} />;
    case "tarefa":
      return <DetalheDaTarefa key={rota.id} id={rota.id} mudancas={mudancas} />;
    case "conexoes":
      return <Conexoes conexao={conexao} gaveta={rota.gaveta} />;
  }
}

export function App() {
  const conexao = useEstado();
  const hash = useHash();
  const lida = lerRota(hash);
  // Sem hash, a tela inicial depende do onboarding, que só se sabe com o primeiro estado do SSE.
  const rota = lida ?? (conexao.estado === null ? null : rotaInicial(conexao.estado));
  const secao = rota === null ? null : secaoDaRota(rota);

  useEffect(() => {
    if (lida === null && rota !== null) window.location.replace(hashDaRota(rota));
  }, [lida, rota]);

  useEffect(() => {
    document.title = secao === null ? "Secretária" : `Secretária · ${NOMES_DAS_SECOES[secao]}`;
  }, [secao]);

  return (
    <div className="min-h-dvh md:flex">
      <Navegacao atual={secao} />
      <div className="min-w-0 flex-1 md:p-2.5">
        <main className="min-h-dvh bg-background pb-20 md:min-h-[calc(100dvh-20px)] md:rounded-2xl md:border md:pb-0 md:shadow-[var(--sombra-do-painel)]">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
            <AvisoDeConexao canal={conexao.canal} temEstado={conexao.estado !== null} />
            {rota !== null && <Tela rota={rota} conexao={conexao} />}
          </div>
        </main>
      </div>
    </div>
  );
}
