import { useEffect, useReducer } from "react";
import { ROTA_DOS_EVENTOS } from "./api";
import { CONEXAO_INICIAL, esperaParaReconectar, lerAndamento, lerEstadoDaAtualizacao, lerEstadoPainel, reduzirConexao, type Conexao } from "./conexao";

export function useEstado(): Conexao {
  const [conexao, despachar] = useReducer(reduzirConexao, CONEXAO_INICIAL);

  useEffect(() => {
    let fonte: EventSource | null = null;
    let espera: ReturnType<typeof setTimeout> | undefined;
    let tentativa = 0;

    const abrir = () => {
      fonte = new EventSource(ROTA_DOS_EVENTOS);
      fonte.addEventListener("open", () => {
        tentativa = 0;
        despachar({ tipo: "aberto" });
      });
      fonte.addEventListener("estado", (evento) => {
        const estado = lerEstadoPainel((evento as MessageEvent<string>).data);
        if (estado !== null) despachar({ tipo: "estado", estado });
      });
      fonte.addEventListener("tarefas", () => despachar({ tipo: "tarefas" }));
      fonte.addEventListener("sincronizacao", (evento) => {
        const andamento = lerAndamento((evento as MessageEvent<string>).data);
        if (andamento !== null) despachar({ tipo: "sincronizacao", andamento });
      });
      fonte.addEventListener("atualizacao", (evento) => {
        const estado = lerEstadoDaAtualizacao((evento as MessageEvent<string>).data);
        if (estado !== null) despachar({ tipo: "atualizacao", estado });
      });
      fonte.addEventListener("error", () => {
        despachar({ tipo: "caiu" });
        // Depois de uma resposta que não é SSE (servidor reiniciando, 5xx) o navegador fecha e não tenta mais.
        if (fonte?.readyState === EventSource.CLOSED) {
          fonte.close();
          espera = setTimeout(abrir, esperaParaReconectar(tentativa++));
        }
      });
    };

    abrir();
    return () => {
      clearTimeout(espera);
      fonte?.close();
    };
  }, []);

  return conexao;
}
