import { falha, ok, type Resultado } from "./erros";
import type { QuemIgnorou } from "./crm-leitura";

/** O que o agente precisa ouvir quando manda `ignorar` sem `--motivo`. */
export const MOTIVO_DO_AGENTE =
  "O agente só ignora com `motivo`: as palavras do vendedor nesta conversa, de por que tirar o item da lista. Pergunte a ele e não invente.";
export const FORMA_DO_MOTIVO = "O motivo é uma linha de 5 a 300 caracteres, sem quebra de linha nem caractere de controle.";
export const MARCA_DO_VENDEDOR = "O vendedor tirou este item do Meu dia no painel. Só ele desfaz ou muda essa marca, no painel.";

export interface PedidoDeIgnorar {
  readonly quem: QuemIgnorou;
  /** O motivo já lido por `lerMotivo`. `null` quando o pedido não trouxe um, ou trouxe fora da forma. */
  readonly motivo: string | null;
  /** O pedido trouxe `motivo`, mesmo que fora da forma. */
  readonly trouxeMotivo: boolean;
  /** Por que o item não está no Meu dia, ou `null` quando está. */
  readonly semItem: string | null;
  /** O item já tem uma marca que o vendedor pôs no painel. */
  readonly marcaDoVendedor: boolean;
  /** O texto do aviso quando a proposta está perto do bloqueio do CRM. Só proposta e cliente do CRM têm; conversa passa `null`. */
  readonly pertoDoBloqueio: string | null;
}

/**
 * As regras de ignorar por 7 dias, as mesmas para proposta, cliente e conversa. A ordem das recusas
 * importa: motivo fora da forma, agente sem motivo, item que não está no Meu dia, marca do vendedor
 * e, por último, proposta perto do bloqueio.
 */
export function decidirIgnorar(pedido: PedidoDeIgnorar): Resultado<{ readonly quem: QuemIgnorou; readonly motivo: string | null }> {
  if (pedido.trouxeMotivo && pedido.motivo === null) return falha("entrada_invalida", FORMA_DO_MOTIVO);
  if (pedido.quem === "agente" && pedido.motivo === null) return falha("entrada_invalida", MOTIVO_DO_AGENTE);
  if (pedido.semItem !== null) return falha("nao_encontrado", pedido.semItem);
  if (pedido.quem === "agente" && pedido.marcaDoVendedor) return falha("so_no_painel", MARCA_DO_VENDEDOR);
  if (pedido.quem === "agente" && pedido.pertoDoBloqueio !== null) return falha("perto_do_bloqueio", pedido.pertoDoBloqueio);
  return ok({ quem: pedido.quem, motivo: pedido.motivo });
}
