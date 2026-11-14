import { LIMITES_DA_TAREFA as LIMITES, lerDia, type Dia, type ErroOperacao, type IdConector } from "../dominio";
import type { RespostaDaTarefa } from "../servidor";
import type { PedidoDaTarefa } from "./api";
import type { CorpoDeCriar, IdadeDaFonte, Tarefa } from "../tarefas";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function emUtc(dia: Dia): Date {
  return new Date(`${dia}T00:00:00Z`);
}

export function somarDias(dia: Dia, dias: number): Dia {
  const data = emUtc(dia);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10) as Dia;
}

/** "hoje", "amanhã", "ontem", "9 de novembro" ou, em outro ano, "9 de novembro de 2027". */
export function formatarDia(dia: Dia, hoje: Dia): string {
  if (dia === hoje) return "hoje";
  if (dia === somarDias(hoje, 1)) return "amanhã";
  if (dia === somarDias(hoje, -1)) return "ontem";
  const [ano, mes, numero] = dia.split("-").map(Number) as [number, number, number];
  const base = `${numero} de ${MESES[mes - 1]}`;
  return dia.slice(0, 4) === hoje.slice(0, 4) ? base : `${base} de ${ano}`;
}

const DIA_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

/** "Quarta-feira, 11 de novembro", para o cabeçalho do Meu dia. */
export function diaPorExtenso(dia: Dia): string {
  const texto = DIA_POR_EXTENSO.format(emUtc(dia));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export type TomDoPrazo = "atrasada" | "hoje" | "futura" | "sem_data";

/** O prazo à vista na linha da tarefa. Atrasada diz desde quando, para o vendedor não precisar abrir. */
export function rotuloDoPrazo(venceEm: Dia | null, hoje: Dia): { readonly texto: string; readonly tom: TomDoPrazo } {
  if (venceEm === null) return { texto: "Sem data", tom: "sem_data" };
  const quando = formatarDia(venceEm, hoje);
  if (venceEm < hoje) return { texto: venceEm === somarDias(hoje, -1) ? "Venceu ontem" : `Venceu em ${quando}`, tom: "atrasada" };
  if (venceEm === hoje) return { texto: "Vence hoje", tom: "hoje" };
  return { texto: venceEm === somarDias(hoje, 1) ? "Vence amanhã" : `Vence em ${quando}`, tom: "futura" };
}

const NOMES_DAS_FONTES: { readonly [F in IdadeDaFonte["fonte"]]: string } = {
  tarefas: "Tarefas",
  whatsapp: "WhatsApp",
  crm: "CRM",
  email: "E-mail",
} satisfies Record<"tarefas" | IdConector, string>;

/** "agora", "há 5 min", "há 2 h", "há 3 dias"; `null` é a fonte desconectada. */
export function idadeEmTexto(minutos: number | null): string {
  if (minutos === null) return "não conectado";
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Com várias contas de e-mail, a idade diz quantas estão conectadas: "1 de 2 contas, há 5 min". */
function idadeDaFonte(fonte: IdadeDaFonte): string {
  const idade = idadeEmTexto(fonte.idadeMin);
  if (fonte.fonte !== "email" || fonte.total === 1 || fonte.conectadas === 0) return idade;
  const contas = fonte.conectadas === fonte.total ? `${fonte.total} contas` : `${fonte.conectadas} de ${fonte.total} contas`;
  return `${contas}, ${idade}`;
}

export function rodapeDasFontes(fontes: readonly IdadeDaFonte[]): { readonly fonte: string; readonly nome: string; readonly idade: string }[] {
  return fontes.map((fonte) => ({ fonte: fonte.fonte, nome: NOMES_DAS_FONTES[fonte.fonte], idade: idadeDaFonte(fonte) }));
}

/** O passo curto que abre embaixo da tarefa. Só um de cada vez, e os campos vivem só enquanto ele está aberto. */
export type Passo =
  | { readonly tipo: "fechado" }
  | { readonly tipo: "concluir"; readonly proximo: string; readonly vence: string }
  | { readonly tipo: "adiar"; readonly para: string };

export type EventoDoPasso =
  | { readonly tipo: "abrir_concluir" }
  | { readonly tipo: "abrir_adiar"; readonly sugestao: Dia }
  | { readonly tipo: "proximo"; readonly texto: string }
  | { readonly tipo: "vence"; readonly texto: string }
  | { readonly tipo: "para"; readonly texto: string }
  | { readonly tipo: "fechar" };

export const PASSO_FECHADO: Passo = { tipo: "fechado" };

/** Evento de um campo que não está aberto é ignorado: um clique atrasado não ressuscita o passo. */
export function reduzirPasso(passo: Passo, evento: EventoDoPasso): Passo {
  switch (evento.tipo) {
    case "abrir_concluir":
      return passo.tipo === "concluir" ? PASSO_FECHADO : { tipo: "concluir", proximo: "", vence: "" };
    case "abrir_adiar":
      return passo.tipo === "adiar" ? PASSO_FECHADO : { tipo: "adiar", para: evento.sugestao };
    case "proximo":
      return passo.tipo === "concluir" ? { ...passo, proximo: evento.texto } : passo;
    case "vence":
      return passo.tipo === "concluir" ? { ...passo, vence: evento.texto } : passo;
    case "para":
      return passo.tipo === "adiar" ? { ...passo, para: evento.texto } : passo;
    case "fechar":
      return PASSO_FECHADO;
  }
}

type Lido<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly mensagem: string };

function diaDeHojeEmDiante(texto: string, hoje: Dia, rotulo: string): Lido<Dia> {
  const dia = lerDia(texto);
  if (dia === null) return { ok: false, mensagem: `Escolha a data ${rotulo}.` };
  if (dia < hoje) return { ok: false, mensagem: `A data ${rotulo} precisa ser hoje ou depois.` };
  return { ok: true, valor: dia };
}

function tamanho(texto: string): number {
  return [...texto].length;
}

/**
 * Vira o passo aberto no pedido à API. `semProximo` é o botão "Concluir sem próximo passo".
 * As regras são as da borda do servidor, repetidas aqui só para o vendedor ver o erro antes de enviar.
 */
export function pedidoDoPasso(passo: Passo, tarefa: Tarefa, hoje: Dia, semProximo = false): Lido<PedidoDaTarefa> {
  const versao = tarefa.versao;
  switch (passo.tipo) {
    case "fechado":
      return { ok: false, mensagem: "Escolha uma ação." };
    case "concluir": {
      if (semProximo) return { ok: true, valor: { acao: "concluir", corpo: { versao } } };
      const proximo = passo.proximo.trim();
      if (proximo === "") return { ok: false, mensagem: "Escreva o próximo passo, ou conclua sem próximo passo." };
      if (tamanho(proximo) > LIMITES.proximoPasso) return { ok: false, mensagem: `O próximo passo cabe em ${LIMITES.proximoPasso} letras.` };
      if (passo.vence === "") return { ok: true, valor: { acao: "concluir", corpo: { versao, proximoPasso: proximo } } };
      const vence = diaDeHojeEmDiante(passo.vence, hoje, "do próximo passo");
      if (!vence.ok) return vence;
      return { ok: true, valor: { acao: "concluir", corpo: { versao, proximoPasso: proximo, venceEm: vence.valor } } };
    }
    case "adiar": {
      const para = diaDeHojeEmDiante(passo.para, hoje, "nova");
      if (!para.ok) return para;
      return { ok: true, valor: { acao: "adiar", corpo: { versao, para: para.valor } } };
    }
  }
}

export interface CamposDaNovaTarefa {
  readonly titulo: string;
  readonly vence: string;
  readonly cliente: string;
}

/** `id` é o do rascunho: o mesmo em toda tentativa de enviar, para a repetição não criar outra tarefa. */
export function lerNovaTarefa(campos: CamposDaNovaTarefa, hoje: Dia, id: string): Lido<CorpoDeCriar> {
  const titulo = campos.titulo.replace(/\s+/g, " ").trim();
  if (titulo === "") return { ok: false, mensagem: "Escreva o título da tarefa." };
  if (tamanho(titulo) > LIMITES.titulo) return { ok: false, mensagem: `O título cabe em ${LIMITES.titulo} letras.` };
  const cliente = campos.cliente.replace(/\s+/g, " ").trim();
  if (tamanho(cliente) > LIMITES.clienteNome) return { ok: false, mensagem: `O nome do cliente cabe em ${LIMITES.clienteNome} letras.` };
  let venceEm: Dia | undefined;
  if (campos.vence !== "") {
    const dia = diaDeHojeEmDiante(campos.vence, hoje, "da tarefa");
    if (!dia.ok) return dia;
    venceEm = dia.valor;
  }
  return {
    ok: true,
    valor: { id, titulo, ...(venceEm === undefined ? {} : { venceEm }), ...(cliente === "" ? {} : { clienteNome: cliente }) },
  };
}

export function lerNota(texto: string): Lido<string> {
  const limpo = texto.trim();
  if (limpo === "") return { ok: false, mensagem: "Escreva a nota." };
  if (tamanho(limpo) > LIMITES.nota) return { ok: false, mensagem: `A nota cabe em ${LIMITES.nota} letras.` };
  return { ok: true, valor: limpo };
}

export const AVISO_DE_MUDANCA = "Esta tarefa mudou em outra janela.";

/** O que o aviso pode levar além do texto: uma linha por item (o resumo da sincronização) e o botão de desfazer. */
export interface ExtrasDoAviso {
  readonly linhas?: readonly string[];
  readonly desfazer?: () => void;
  /** O aviso do "não é cliente" fica no topo da janela, como o dono escolheu no protótipo. */
  readonly noTopo?: boolean;
  /** O link do recibo do CRM, como veio. O aviso só leva o botão "Abrir no CRM" se ele passar em `linkDoCrm`. */
  readonly link?: string;
}

export type Aviso = (
  | { readonly tom: "mudou"; readonly texto: string; readonly detalhe: string }
  | { readonly tom: "erro"; readonly texto: string; readonly detalhe: string }
  | { readonly tom: "feito"; readonly texto: string; readonly detalhe: string | null }
) &
  ExtrasDoAviso;

/**
 * O que mostrar quando a API recusa. Versão velha e estado que já mudou são a mesma coisa para o
 * vendedor: outra janela, ou o agente, mexeu na tarefa. O painel recarrega e mostra como ficou.
 */
export function avisoDoErro(erro: ErroOperacao): Aviso {
  if (erro.codigo === "conflito_de_versao" || erro.codigo === "estado_da_tarefa") {
    return { tom: "mudou", texto: AVISO_DE_MUDANCA, detalhe: "Recarreguei a tarefa. Confira como ela está e faça a mudança de novo, se ainda valer." };
  }
  return { tom: "erro", texto: erro.mensagem, detalhe: erro.acao };
}

/** O que dizer depois que a ação deu certo. A tarefa seguinte aparece pelo título, como texto. */
export function avisoDoFeito(pedido: PedidoDaTarefa, resposta: RespostaDaTarefa, hoje: Dia): Aviso {
  switch (pedido.acao) {
    case "concluir": {
      const seguinte = resposta.seguinte;
      if (seguinte === null) return { tom: "feito", texto: "Tarefa concluída.", detalhe: null };
      const prazo = seguinte.venceEm === null ? "sem data" : `para ${formatarDia(seguinte.venceEm, hoje)}`;
      return { tom: "feito", texto: "Tarefa concluída.", detalhe: `Próximo passo criado, ${prazo}: ${seguinte.titulo}` };
    }
    case "adiar":
      return { tom: "feito", texto: `Tarefa adiada para ${formatarDia(resposta.tarefa.venceEm ?? hoje, hoje)}.`, detalhe: null };
    case "descartar":
      return { tom: "feito", texto: "Tarefa descartada.", detalhe: "Ela fica em Tarefas, no filtro Descartadas." };
    case "reabrir":
      return { tom: "feito", texto: "Tarefa reaberta.", detalhe: null };
    case "anotar":
      return { tom: "feito", texto: "Nota salva.", detalhe: null };
  }
}
