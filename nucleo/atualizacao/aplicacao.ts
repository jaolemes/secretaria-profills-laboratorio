import type { EstadoDaDescoberta, Impedimento, VersaoPublicada } from "./descoberta";

type Instante = string;

/** O que o servidor faz antes de parar: baixa e confere, instala as dependências em `nova/`, sobe o atualizador. */
export type PassoDaAplicacao = "baixando" | "instalando" | "reiniciando";

/**
 * Por que a atualização não foi feita. Os sete primeiros são do servidor, antes de parar; os outros
 * são os do atualizador, lidos do `andamento.json` pelo servidor que sobe depois.
 */
export const MOTIVOS_DA_FALHA = [
  "versao_mudou",
  "sem_internet",
  "pacote_recusado",
  "dependencias_falharam",
  "ficou_ocupada",
  "atualizador_nao_comecou",
  "falha_interna",
  "banco_em_uso",
  "versao_nova_invalida",
  "copia_falhou",
  "troca_falhou",
  "instalar_falhou",
  "servidor_nao_subiu",
  "interrompida",
] as const;
export type MotivoDaFalha = (typeof MOTIVOS_DA_FALHA)[number];

/** O que está em andamento agora e se perderia num restart. */
export type Ocupacao = "gravando_no_crm" | "sincronizando" | "whatsapp_conectando" | "crm_conectando" | "email_testando";

export type MotivoDoBloqueio = Impedimento | Ocupacao;

export interface Bloqueio {
  readonly motivo: MotivoDoBloqueio;
  readonly explicacao: string;
}

const EXPLICACAO_DO_BLOQUEIO: { readonly [M in MotivoDoBloqueio]: string } = {
  instalacao_de_desenvolvimento: "Esta pasta é de desenvolvimento e não se atualiza pelo painel. Peça ao seu agente para instalar a Secretária de novo pelo instalador.",
  bun_antigo: "Esta versão pede uma atualização do instalador. Peça ao seu agente.",
  gravando_no_crm: "A Secretária está gravando um cartão no CRM. Atualize depois que a gravação terminar.",
  sincronizando: "A Secretária está lendo o CRM, o WhatsApp e o e-mail. Atualize depois que a leitura terminar.",
  whatsapp_conectando: "O WhatsApp está no meio da conexão. Termine ou cancele a conexão e depois atualize.",
  crm_conectando: "O login do CRM está aberto. Termine ou cancele o login e depois atualize.",
  email_testando: "Uma conta de e-mail está em teste. Espere o teste terminar e depois atualize.",
};

/** A frase que vem depois de "Não deu para atualizar". A versão que segue no ar o painel já mostra. */
export const EXPLICACAO_DA_FALHA: { readonly [M in MotivoDaFalha]: string } = {
  versao_mudou: "A versão publicada mudou enquanto isso. Confira de novo e tente outra vez.",
  sem_internet: "Não deu para baixar a versão nova. Confira a internet e tente de novo.",
  pacote_recusado: "O arquivo baixado não é o que a Profills publicou, e a Secretária o descartou.",
  dependencias_falharam: "Não deu para preparar a versão nova. Confira a internet e tente de novo.",
  ficou_ocupada: "Algo começou na Secretária durante o download. Tente de novo quando terminar.",
  atualizador_nao_comecou: "A troca de versão não começou. Tente de novo.",
  falha_interna: "Algo falhou dentro da Secretária. Tente de novo e, se continuar, peça ajuda ao seu agente.",
  banco_em_uso: "Outro programa estava usando os dados da Secretária. Feche o que estiver aberto e tente de novo.",
  versao_nova_invalida: "A versão nova veio incompleta.",
  copia_falhou: "Não deu para guardar a cópia dos seus dados antes da troca. Confira se o disco tem espaço livre.",
  troca_falhou: "Um arquivo da Secretária estava em uso na hora da troca. Feche o que estiver aberto na pasta dela e tente de novo.",
  instalar_falhou: "A preparação da versão nova falhou.",
  servidor_nao_subiu: "A versão nova não abriu.",
  interrompida: "A atualização parou no meio, e a Secretária voltou para a versão de antes.",
};

/**
 * O que o servidor sabe da atualização: a que ele está fazendo, a que falhou antes de ele parar,
 * ou o resultado que o atualizador gravou antes de subir este servidor.
 */
export type Aplicacao =
  | { readonly tipo: "nenhuma" }
  | { readonly tipo: "em_curso"; readonly para: string; readonly passo: PassoDaAplicacao }
  | { readonly tipo: "falhou"; readonly para: string | null; readonly motivo: MotivoDaFalha; readonly em: Instante }
  | { readonly tipo: "concluida"; readonly de: string | null; readonly nucleoMudado: number | null; readonly em: Instante };

type VersaoNovaDescoberta = Extract<EstadoDaDescoberta, { fase: "versao_nova" }>;

export type EstadoDaAtualizacao =
  | Exclude<EstadoDaDescoberta, { fase: "versao_nova" }>
  | (VersaoNovaDescoberta & { readonly bloqueio: Bloqueio | null })
  | { readonly fase: "atualizando"; readonly instalada: string; readonly para: string; readonly passo: PassoDaAplicacao }
  /** `nucleoMudado`: arquivos do núcleo que o agente do vendedor tinha mudado e saíram do ar. `null` sem lista para comparar. */
  | { readonly fase: "atualizado"; readonly instalada: string; readonly de: string | null; readonly nucleoMudado: number | null; readonly em: Instante }
  | {
      readonly fase: "falhou";
      readonly instalada: string;
      readonly para: string | null;
      readonly motivo: MotivoDaFalha;
      readonly explicacao: string;
      readonly em: Instante;
      /** A versão que ainda dá para aplicar, para o Tentar de novo. Sem ela, o estado é o da descoberta. */
      readonly nova: VersaoPublicada;
      readonly bloqueio: Bloqueio | null;
    };

export function bloqueioDe(impedimento: Impedimento | null, ocupacoes: readonly Ocupacao[]): Bloqueio | null {
  const motivo = impedimento ?? ocupacoes[0] ?? null;
  return motivo === null ? null : { motivo, explicacao: EXPLICACAO_DO_BLOQUEIO[motivo] };
}

export function juntarEstado(descoberta: EstadoDaDescoberta, aplicacao: Aplicacao, ocupacoes: readonly Ocupacao[]): EstadoDaAtualizacao {
  const { instalada } = descoberta;
  const versaoNova = descoberta.fase === "versao_nova" ? descoberta : null;
  const bloqueio = versaoNova === null ? null : bloqueioDe(versaoNova.impedimento, ocupacoes);
  switch (aplicacao.tipo) {
    case "em_curso":
      return { fase: "atualizando", instalada, para: aplicacao.para, passo: aplicacao.passo };
    case "falhou": {
      // Uma conferência que deixa de trazer a versão nova apaga o aviso: não há o que tentar de novo.
      if (versaoNova === null) break;
      const { para, motivo, em } = aplicacao;
      return { fase: "falhou", instalada, para, motivo, explicacao: EXPLICACAO_DA_FALHA[motivo], em, nova: versaoNova.nova, bloqueio };
    }
    case "concluida":
      if (versaoNova === null) return { fase: "atualizado", instalada, de: aplicacao.de, nucleoMudado: aplicacao.nucleoMudado, em: aplicacao.em };
      break;
    case "nenhuma":
      break;
  }
  return descoberta.fase === "versao_nova" ? { ...descoberta, bloqueio } : descoberta;
}
