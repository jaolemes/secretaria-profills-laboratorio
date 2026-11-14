import type { CodigoErro, Instante, Sinal, TextoExterno } from "../dominio";

export const TOOLS_DE_ESCRITA = ["registrar_atendimento", "criar_compromisso", "criar_contato"] as const;
export type ToolDeEscrita = (typeof TOOLS_DE_ESCRITA)[number];

export const STATUS_DO_ATENDIMENTO = ["Em Andamento", "Concluído", "Pendente", "Cancelado"] as const;
export type StatusDoAtendimento = (typeof STATUS_DO_ATENDIMENTO)[number];

export const TIPOS_DE_COMPROMISSO = ["client", "internal", "operational"] as const;
export type TipoDeCompromisso = (typeof TIPOS_DE_COMPROMISSO)[number];

/** Os campos são os do CRM, sem tradução: o que o vendedor aprova é o que a tool recebe. */
export type DadosDeRegistrarAtendimento = {
  readonly cliente_id: number;
  readonly assunto: string;
  readonly status: StatusDoAtendimento;
  readonly descricao?: string;
  readonly contato_id?: number;
};

export type DadosDeCriarCompromisso = {
  readonly titulo: string;
  /** `AAAA-MM-DD HH:MM`, horário de Brasília. */
  readonly inicio: string;
  readonly fim?: string;
  readonly descricao?: string;
  readonly cliente_id?: number;
  readonly tipo?: TipoDeCompromisso;
};

export type DadosDeCriarContato = {
  readonly cliente_id: number;
  readonly nome: string;
  readonly telefone: string;
  readonly email?: string;
  readonly cargo?: string;
  readonly departamento?: string;
  readonly observacoes?: string;
};

export type Escrita =
  | { readonly tool: "registrar_atendimento"; readonly dados: DadosDeRegistrarAtendimento }
  | { readonly tool: "criar_compromisso"; readonly dados: DadosDeCriarCompromisso }
  | { readonly tool: "criar_contato"; readonly dados: DadosDeCriarContato };

/** Os campos que o vendedor edita e de onde saem os sinais de injeção. */
export const CAMPOS_DE_TEXTO = {
  registrar_atendimento: ["assunto", "descricao"],
  criar_compromisso: ["titulo", "descricao"],
  criar_contato: ["nome", "cargo", "departamento", "observacoes"],
} as const satisfies { readonly [T in ToolDeEscrita]: readonly string[] };

/** O campo de texto sem o qual o CRM recusa a escrita. Esvaziá-lo numa edição é erro. */
export const CAMPOS_OBRIGATORIOS = {
  registrar_atendimento: ["assunto"],
  criar_compromisso: ["titulo"],
  criar_contato: ["nome"],
} as const satisfies { readonly [T in ToolDeEscrita]: readonly (typeof CAMPOS_DE_TEXTO)[T][number][] };

export type CampoDeTexto = (typeof CAMPOS_DE_TEXTO)[ToolDeEscrita][number];

export const ESTADOS_DA_ESCRITA = ["rascunho", "aprovado", "gravando", "gravado", "falhou", "falhou_incerto", "descartado"] as const;
export type EstadoDaEscrita = (typeof ESTADOS_DA_ESCRITA)[number];

export const ACOES_DA_DECISAO = ["aprovou", "editou", "descartou", "retirou", "ja_esta_no_crm", "tentou_de_novo"] as const;
export type AcaoDaDecisao = (typeof ACOES_DA_DECISAO)[number];

/** Quem pede a transição. O servidor é o que grava no CRM. */
export type QuemDaEscrita = "painel" | "agente" | "servidor";

export type ClienteDoCartao =
  | null
  | { readonly id: number; readonly conferido: false }
  | { readonly id: number; readonly conferido: true; readonly nome: TextoExterno; readonly cidade: TextoExterno | null };

export interface ReciboDoCrm {
  readonly id: number | null;
  readonly link: string | null;
}

/** Os códigos que moram em `erro.codigo` do cartão. Cada um tem texto fixo em `ERROS`, para o painel e para o agente. */
export const CODIGOS_DE_ERRO_DA_ESCRITA = [
  "crm_recusou_a_escrita",
  "crm_sem_permissao",
  "crm_nao_executou",
  "crm_escrita_incerta",
  "escrita_interrompida",
  "crm_nao_encontrado",
  "crm_ferramenta_recusada",
] as const satisfies readonly CodigoErro[];
export type CodigoDeErroDaEscrita = (typeof CODIGOS_DE_ERRO_DA_ESCRITA)[number];

export function ehCodigoDeErroDaEscrita(codigo: string): codigo is CodigoDeErroDaEscrita {
  return (CODIGOS_DE_ERRO_DA_ESCRITA as readonly string[]).includes(codigo);
}

export interface ErroDaEscrita {
  readonly codigo: CodigoDeErroDaEscrita;
  /** Texto do CRM já saneado. Só o agente o recebe, citado. */
  readonly detalhe: TextoExterno | null;
}

/** Campo de texto que acendeu sinal, e quais. Vazio é "nada suspeito". */
export type SinaisDaEscrita = { readonly [campo: string]: readonly Sinal[] };

interface CorpoDoCartao {
  readonly id: string;
  readonly escrita: Escrita;
  /** sha256 da forma canônica de `escrita`, 64 hexadecimais. */
  readonly hash: string;
  readonly cliente: ClienteDoCartao;
  readonly sinais: SinaisDaEscrita;
  /** Calculada ao propor: o vínculo do cliente é só automático e o vendedor ainda não aprovou escrita dele. */
  readonly confiraOCliente: boolean;
  /** Sobe a cada mudança. Quem decide com versão velha recebe `conflito_da_escrita`. */
  readonly versao: number;
  readonly criadaEm: Instante;
  readonly atualizadaEm: Instante;
}

/** Recibo só em `gravado` e erro só em `falhou` e `falhou_incerto`: o tipo não deixa o estado ilegal existir. */
export type CartaoDaEscrita = CorpoDoCartao &
  (
    | { readonly estado: "rascunho" | "aprovado" | "gravando" | "descartado"; readonly recibo: null; readonly erro: null }
    | { readonly estado: "gravado"; readonly recibo: ReciboDoCrm; readonly erro: null }
    | { readonly estado: "falhou" | "falhou_incerto"; readonly recibo: null; readonly erro: ErroDaEscrita }
  );

/**
 * O que o CRM fez com a gravação, um a um com os comandos do servidor: `gravou`, `recusou` (nada foi gravado)
 * e `incerto` (pode ter sido gravado, só o vendedor confere).
 */
export type DesfechoDaGravacao =
  | { readonly tipo: "gravou"; readonly recibo: ReciboDoCrm }
  | { readonly tipo: "recusou"; readonly erro: ErroDaEscrita }
  | { readonly tipo: "incerto"; readonly erro: ErroDaEscrita };

/** Uma linha do registro de decisões do vendedor. `hash` é o do cartão quando a decisão foi tomada. */
export interface DecisaoRegistrada {
  readonly acao: AcaoDaDecisao;
  readonly hash: string;
  readonly em: Instante;
}
