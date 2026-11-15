/** Por que uma versão publicada ou um pacote não serve. Quem chama decide pelo motivo, nunca pelo texto. */
export type MotivoDaRecusa =
  | "envelope_invalido"
  | "chave_desconhecida"
  | "assinatura_invalida"
  | "manifesto_invalido"
  | "endereco_fora_do_canonico"
  | "versao_nao_e_maior"
  | "pacote_nao_confere"
  | "pacote_invalido"
  | "caminho_recusado"
  | "lista_nao_confere";

export interface Recusa {
  readonly ok: false;
  readonly motivo: MotivoDaRecusa;
  readonly detalhe: string;
}

export function recusar(motivo: MotivoDaRecusa, detalhe: string): Recusa {
  return { ok: false, motivo, detalhe };
}
