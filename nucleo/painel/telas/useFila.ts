import { useCallback, useRef, useState } from "react";
import type { CartaoVisto } from "../../escritas";
import type { EstadoCrm } from "../../dominio";
import {
  avisoFlutuanteDaDecisao,
  criarTrava,
  decidirNoServidor,
  editarNoServidor,
  portaoDoCrm,
  type AcaoDeDecisao,
  type AlvoDaDecisao,
  type DesfechoDaDecisao,
  type DesfechoDaEdicao,
  type PedidoEmCurso,
  type PortaoDoCrm,
  type TextosAbertos,
} from "../aprovar";
import { api, type Executor } from "./comum";

/** O que a linha e a gaveta de um cartão compartilham: o pedido em curso, o portão do CRM e o texto já aberto. */
export interface FilaDeAprovacao {
  readonly pedido: PedidoEmCurso | null;
  readonly portao: PortaoDoCrm | null;
  readonly abertos: TextosAbertos;
  /** Abre a gaveta do cartão. */
  ver(id: string): void;
  /** A gaveta mostrou este cartão: a linha dele passa a poder aprovar essa versão. */
  marcarAberto(id: string, versao: number, hash: string): void;
  /** `daGaveta`: a gaveta mostra o cartão e o erro que o desfecho traz; o aviso flutuante só sai quando ela fecha. */
  decidir(alvo: AlvoDaDecisao, acao: AcaoDeDecisao, daGaveta?: boolean): Promise<DesfechoDaDecisao | null>;
  editar(cartao: CartaoVisto, valores: Readonly<Record<string, string>>): Promise<DesfechoDaEdicao | null>;
}

/**
 * Aprovar, descartar, tentar de novo, marcar que já está no CRM e editar, de um cartão da fila. Um pedido por
 * vez na tela inteira. Depois de qualquer pedido o Meu dia recarrega.
 */
export function useFila(entrada: { readonly executor: Executor; readonly recarregar: () => void; readonly crm: EstadoCrm | null; readonly abrir: (id: string) => void; readonly fecharGaveta: (id: string) => void }): FilaDeAprovacao {
  const { executor, recarregar, crm, abrir, fecharGaveta } = entrada;
  const [pedido, setPedido] = useState<PedidoEmCurso | null>(null);
  const [abertos, setAbertos] = useState<TextosAbertos>(new Map());
  const trava = useRef(criarTrava());

  const travar = async <T,>(pedidoNovo: PedidoEmCurso, fazer: () => Promise<T>): Promise<T | null> => {
    return trava.current.rodar(async () => {
      setPedido(pedidoNovo);
      try {
        return await fazer();
      } finally {
        setPedido(null);
        recarregar();
      }
    });
  };

  const marcarAberto = useCallback((id: string, versao: number, hash: string) => {
    setAbertos((atuais) => {
      const antes = atuais.get(id);
      return antes?.versao === versao && antes.hash === hash ? atuais : new Map(atuais).set(id, { versao, hash });
    });
  }, []);

  const decidir: FilaDeAprovacao["decidir"] = (alvo, acao, daGaveta = false) =>
    travar({ id: alvo.id, acao }, async () => {
      const desfecho = await decidirNoServidor(api, alvo, acao);
      const aviso = avisoFlutuanteDaDecisao(desfecho, daGaveta);
      if (aviso !== null) executor.avisar(aviso);
      if (desfecho.fechaGaveta) fecharGaveta(alvo.id);
      return desfecho;
    });

  // O aviso de texto salvo fica no alto, no meio: embaixo ele cobriria os botões da gaveta.
  const editar: FilaDeAprovacao["editar"] = (cartao, valores) =>
    travar({ id: cartao.id, acao: "editar" }, async () => {
      const desfecho = await editarNoServidor(api, cartao, valores);
      if (desfecho.aviso !== null) executor.avisar({ ...desfecho.aviso, noTopo: true });
      return desfecho;
    });

  return { pedido, portao: portaoDoCrm(crm), abertos, ver: abrir, marcarAberto, decidir, editar };
}
