import type { Bloqueio, EstadoDaAtualizacao, MotivoDoBloqueio, PassoDaAplicacao } from "../atualizacao";

export type IconeDaAtualizacao = "versao_nova" | "girando" | "feito" | "alerta" | "sem_rede";

export interface BotaoDaAtualizacao {
  readonly rotulo: string;
  readonly acao: "aplicar" | "conferir";
  readonly principal: boolean;
}

/** O bloco do cartão do pé, entre a lista das conexões e quem usa. */
export interface AvisoDaAtualizacao {
  readonly icone: IconeDaAtualizacao;
  readonly titulo: string;
  readonly textos: readonly string[];
  /** A barra, de 0 a 100, só em `atualizando`. */
  readonly progresso: number | null;
  readonly botao: BotaoDaAtualizacao | null;
  /** Por que o botão está apagado agora. O botão continua lá. */
  readonly trava: string | null;
}

/** O que o painel mostra da atualização, em toda tela. */
export interface VistaDaAtualizacao {
  /** A linha da versão, na lista aberta das conexões. */
  readonly versao: string;
  /** Texto puro, que veio da rede no manifesto assinado. */
  readonly oQueMuda: readonly string[];
  readonly aviso: AvisoDaAtualizacao | null;
  /** O botão acima de quem usa, com a lateral recolhida. */
  readonly recolhida: { readonly girando: boolean; readonly ponto: boolean; readonly rotulo: string } | null;
  readonly pontoNoMenu: boolean;
}

const PASSOS: { readonly [P in PassoDaAplicacao]: { readonly texto: string; readonly progresso: number } } = {
  baixando: { texto: "Baixando a versão nova", progresso: 20 },
  instalando: { texto: "Instalando a versão nova", progresso: 55 },
  reiniciando: { texto: "Reiniciando a Secretária", progresso: 85 },
};

/** O que é da máquina não passa com o tempo: no lugar do botão, a frase. */
const IMPEDIMENTOS: readonly MotivoDoBloqueio[] = ["instalacao_de_desenvolvimento", "bun_antigo"];

function comBotao(botao: BotaoDaAtualizacao, bloqueio: Bloqueio | null): Pick<AvisoDaAtualizacao, "textos" | "botao" | "trava"> {
  if (bloqueio === null) return { textos: [], botao, trava: null };
  if (IMPEDIMENTOS.includes(bloqueio.motivo)) return { textos: [bloqueio.explicacao], botao: null, trava: null };
  return { textos: [], botao, trava: bloqueio.explicacao };
}

function arquivosMudados(n: number | null): string[] {
  if (n === null || n === 0) return [];
  return n === 1
    ? ["1 arquivo da Secretária tinha sido mudado neste computador. A versão nova o trocou e guardou uma cópia."]
    : [`${n} arquivos da Secretária tinham sido mudados neste computador. A versão nova os trocou e guardou uma cópia.`];
}

type Fase = EstadoDaAtualizacao["fase"];
type Parte = Pick<VistaDaAtualizacao, "oQueMuda" | "aviso"> & { readonly situacao: string | null; readonly rotulo: string };
type Montar<F extends Fase> = (estado: Extract<EstadoDaAtualizacao, { fase: F }>, conferindo: boolean) => Parte;

const SEM_AVISO = { oQueMuda: [], aviso: null, rotulo: "" } as const;

const POR_FASE: { readonly [F in Fase]: Montar<F> } = {
  nao_conferida: () => ({ ...SEM_AVISO, situacao: null }),
  em_dia: () => ({ ...SEM_AVISO, situacao: "em dia" }),
  versao_nova: ({ nova, bloqueio }) => ({
    situacao: `tem a ${nova.versao}`,
    rotulo: "Tem versão nova da Secretária",
    oQueMuda: nova.oQueMuda,
    aviso: { icone: "versao_nova", titulo: "Tem versão nova", progresso: null, ...comBotao({ rotulo: "Atualizar", acao: "aplicar", principal: true }, bloqueio) },
  }),
  atualizando: ({ para, passo }) => ({
    situacao: "atualizando",
    rotulo: "Atualizando a Secretária",
    oQueMuda: [],
    aviso: {
      icone: "girando",
      titulo: `Atualizando para a ${para}`,
      textos: [`${PASSOS[passo].texto}. Vai reiniciar; nada do que você aprovou se perde.`],
      progresso: PASSOS[passo].progresso,
      botao: null,
      trava: null,
    },
  }),
  atualizado: ({ instalada, nucleoMudado }) => ({
    situacao: "atualizada",
    rotulo: "A Secretária foi atualizada",
    oQueMuda: [],
    aviso: {
      icone: "feito",
      titulo: `Atualizada para a ${instalada}`,
      textos: ["O agente que já estava aberto segue com as regras antigas até você abrir uma conversa nova.", ...arquivosMudados(nucleoMudado)],
      progresso: null,
      botao: null,
      trava: null,
    },
  }),
  falhou: ({ instalada, explicacao, nova, bloqueio }) => {
    const partes = comBotao({ rotulo: "Tentar de novo", acao: "aplicar", principal: true }, bloqueio);
    return {
      situacao: "não deu para atualizar",
      rotulo: "Não deu para atualizar a Secretária",
      oQueMuda: nova.oQueMuda,
      aviso: { icone: "alerta", titulo: "Não deu para atualizar", progresso: null, ...partes, textos: [`${explicacao} A Secretária continua na ${instalada} e funciona normalmente.`, ...partes.textos] },
    };
  },
  sem_internet: (_estado, conferindo) => ({
    situacao: "sem internet para conferir",
    rotulo: "Não deu para ver se tem versão nova",
    oQueMuda: [],
    aviso: {
      icone: "sem_rede",
      titulo: "Não deu para ver se tem versão nova",
      textos: ["Sem internet agora. A Secretária confere de novo quando você abrir o painel."],
      progresso: null,
      botao: { rotulo: conferindo ? "Conferindo" : "Tentar agora", acao: "conferir", principal: false },
      trava: null,
    },
  }),
};

const COM_PONTO_NO_MENU: readonly Fase[] = ["versao_nova", "falhou", "atualizado"];

/** `null` antes da primeira leitura: nada aparece, para não piscar um estado que não é o de agora. */
export function vistaDaAtualizacao(estado: EstadoDaAtualizacao | null, conferindo: boolean): VistaDaAtualizacao | null {
  if (estado === null) return null;
  const { situacao, rotulo, oQueMuda, aviso } = (POR_FASE[estado.fase] as Montar<Fase>)(estado, conferindo);
  const girando = estado.fase === "atualizando";
  return {
    versao: situacao === null ? `Secretária ${estado.instalada}` : `Secretária ${estado.instalada} · ${situacao}`,
    oQueMuda,
    aviso,
    recolhida: aviso === null ? null : { girando, ponto: !girando, rotulo },
    pontoNoMenu: COM_PONTO_NO_MENU.includes(estado.fase),
  };
}

/**
 * Um estado que chega depois de o servidor sumir no meio da atualização. A página só sabe mostrar a
 * versão em que carregou: outra versão recarrega, para o navegador pegar o painel novo, mas só depois
 * de ela dizer `atualizado`, para a página nova abrir com o aviso.
 */
export function lerNaVolta(versaoDaPagina: string, atual: EstadoDaAtualizacao | null, lido: EstadoDaAtualizacao): "mostrar" | "esperar" | "recarregar" {
  if (lido.instalada === versaoDaPagina) return "mostrar";
  return atual?.fase === "atualizando" && lido.fase !== "atualizado" ? "esperar" : "recarregar";
}
