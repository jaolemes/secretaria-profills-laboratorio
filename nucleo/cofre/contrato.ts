import type { Segredo } from "./segredo";

/**
 * Lista única de chaves fixas. Não existe chave livre: segredo novo entra aqui primeiro.
 * `email.senha` é a chave da conta única de antes das várias contas: só a migração a lê e apaga.
 */
export const CHAVES_DO_COFRE = ["crm.refresh_token", "email.senha", "servidor.chave_de_sessao"] as const;
export type ChaveFixaDoCofre = (typeof CHAVES_DO_COFRE)[number];

/** Senha de uma conta de e-mail. O meio é o UUID da conta. */
export type ChaveDaSenhaDoEmail = `email.conta.${string}.senha`;
export type ChaveDoCofre = ChaveFixaDoCofre | ChaveDaSenhaDoEmail;

const CHAVE_DA_CONTA = /^email\.conta\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.senha$/;

export function chaveDaSenhaDoEmail(idDaConta: string): ChaveDaSenhaDoEmail {
  const chave: ChaveDaSenhaDoEmail = `email.conta.${idDaConta}.senha`;
  if (!CHAVE_DA_CONTA.test(chave)) throw new Error("id de conta de e-mail fora do formato");
  return chave;
}

export function ehChaveDoCofre(texto: string): texto is ChaveDoCofre {
  return (CHAVES_DO_COFRE as readonly string[]).includes(texto) || CHAVE_DA_CONTA.test(texto);
}

export type BackendDoCofre = "sistema" | "arquivo";

export interface Cofre {
  ler(chave: ChaveDoCofre): Promise<Segredo | null>;
  /** Idempotente: gravar o mesmo valor duas vezes termina no mesmo estado. */
  gravar(chave: ChaveDoCofre, valor: Segredo): Promise<void>;
  /** Idempotente: apagar chave ausente não é erro. */
  apagar(chave: ChaveDoCofre): Promise<void>;
  /** Para o diagnóstico dizer onde o segredo mora. Nunca devolve valor. */
  readonly backend: BackendDoCofre;
}

/** O cofre não respondeu no prazo ou falhou. A mensagem do backend não vai junto: pode carregar dado de fora. */
export class CofreIndisponivel extends Error {
  constructor(readonly motivo: "prazo" | "erro") {
    super(motivo === "prazo" ? "O cofre não respondeu no prazo." : "O cofre respondeu com erro.");
    this.name = "CofreIndisponivel";
  }
}
