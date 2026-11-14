import { ERROS, PROBLEMAS, SINAIS, mostrarInvisiveis, type ErroOperacao, type EstadoCrm, type Sinal } from "../dominio";
import type { CartaoVisto, ClienteDoCartao, EstadoDaEscrita, Escrita, ResumoDaEscrita, ToolDeEscrita } from "../escritas";
import type { ApiDeTarefas, Resposta } from "./api";
import { avisoDasMarcas, partesDoTexto } from "./conversas";
import type { Aviso } from "./tarefas";
import { momento } from "./tempo";

/**
 * A fila de aprovação vista pelo painel, sem React: título e apoio da linha, selos, botões por estado,
 * campos do cartão, edição, o portão do CRM e o aviso de cada desfecho. O painel só importa tipo de
 * `nucleo/escritas`: o que precisa em tempo de execução está nas tabelas deste arquivo, e um teste as
 * confere contra `CAMPOS_DE_TEXTO` e `CAMPOS_OBRIGATORIOS`.
 */

export const NOMES_DAS_ACOES_DE_ESCRITA: { readonly [T in ToolDeEscrita]: string } = {
  registrar_atendimento: "Registrar atendimento",
  criar_compromisso: "Criar compromisso",
  criar_contato: "Criar contato",
};

/** O nome na linha e no aviso: o do CRM, ou "cliente nº <id>" enquanto a Secretária não o conferiu. `null` sem cliente. */
export function nomeDoCliente(cliente: ClienteDoCartao): string | null {
  if (cliente === null) return null;
  return cliente.conferido ? cliente.nome : `cliente nº ${cliente.id}`;
}

type ParaALinha = Pick<ResumoDaEscrita, "tool" | "cliente">;

export function tituloDoCartao(resumo: ParaALinha): string {
  const acao = NOMES_DAS_ACOES_DE_ESCRITA[resumo.tool];
  const nome = nomeDoCliente(resumo.cliente);
  return nome === null ? acao : `${acao} · ${nome}`;
}

/**
 * "Redigido pelo agente hoje às 9h12". Com a marca "confira o cliente", a cidade vem antes: é como a
 * primeira escrita de um cliente vinculado só pelo número mostra nome e cidade. Cliente por conferir diz isso.
 */
export function apoioDoCartao(resumo: Pick<ResumoDaEscrita, "cliente" | "confiraOCliente" | "criadaEm">, agora: Date): string {
  const redigido = `Redigido pelo agente ${momento(resumo.criadaEm, agora)}`;
  const { cliente } = resumo;
  if (cliente !== null && !cliente.conferido) return `Cliente ainda não conferido no CRM · ${redigido}`;
  if (resumo.confiraOCliente && cliente?.conferido === true && cliente.cidade !== null) return `${cliente.cidade} · ${redigido}`;
  return redigido;
}

/** Os selos de atenção, nesta ordem. */
export function selosDoCartao(resumo: Pick<ResumoDaEscrita, "confiraOTexto" | "confiraOCliente" | "estado">): string[] {
  return [
    ...(resumo.confiraOTexto ? ["Confira o texto"] : []),
    ...(resumo.confiraOCliente ? ["Confira o cliente"] : []),
    ...(resumo.estado === "falhou_incerto" ? ["Pode ter gravado"] : []),
    ...(resumo.estado === "falhou" ? ["O CRM recusou"] : []),
  ];
}

/** Os sinais de todos os campos de texto, sem repetir, na ordem de `SINAIS`. */
export function sinaisDoCartao(sinais: CartaoVisto["sinais"]): Sinal[] {
  const acesos = new Set(Object.values(sinais).flat());
  return SINAIS.filter((sinal) => acesos.has(sinal));
}

export type AcaoDeDecisao = "aprovar" | "descartar" | "tentar_de_novo" | "ja_esta_no_crm";
export type AcaoDoCartao = AcaoDeDecisao | "ver" | "editar" | "salvar" | "cancelar" | "fechar";

export const ROTULOS_DAS_ACOES_DO_CARTAO: { readonly [A in AcaoDoCartao]: string } = {
  aprovar: "Aprovar",
  descartar: "Descartar",
  tentar_de_novo: "Não gravou, tentar de novo",
  ja_esta_no_crm: "Já está no CRM",
  ver: "Ver o texto",
  editar: "Editar",
  salvar: "Salvar",
  cancelar: "Cancelar",
  fechar: "Fechar",
};

/** A ação que avança leva a cor da ação; as outras ficam em contorno. */
export function ehPrincipal(acao: AcaoDoCartao): boolean {
  return acao === "aprovar" || acao === "salvar" || acao === "ja_esta_no_crm" || acao === "fechar";
}

const DECIDE = new Set<AcaoDoCartao>(["aprovar", "descartar", "tentar_de_novo", "ja_esta_no_crm", "editar", "salvar"]);
const GRAVA = new Set<AcaoDoCartao>(["aprovar", "tentar_de_novo"]);

/** Aprovar e Descartar da linha, com Ver o texto no meio. Cartão que já saiu da aprovação só deixa ver. */
export function acoesDaLinha(estado: EstadoDaEscrita): AcaoDoCartao[] {
  return estado === "rascunho" || estado === "falhou" ? ["descartar", "ver", "aprovar"] : ["ver"];
}

/** O rodapé da gaveta. Estado que já não aceita decisão só deixa fechar. */
export function acoesDaGaveta(estado: EstadoDaEscrita, editando: boolean): AcaoDoCartao[] {
  if (estado === "rascunho" || estado === "falhou") return editando ? ["cancelar", "salvar"] : ["editar", "descartar", "aprovar"];
  if (estado === "falhou_incerto") return ["descartar", "tentar_de_novo", "ja_esta_no_crm"];
  return ["fechar"];
}

export const FRASES_DO_ESTADO_FINAL: { readonly [E in "gravando" | "aprovado" | "gravado" | "descartado"]: string } = {
  gravando: "Este cartão está sendo gravado no CRM.",
  aprovado: "Este cartão está sendo gravado no CRM.",
  gravado: "Este cartão já foi gravado no CRM.",
  descartado: "Este cartão foi descartado.",
};

/** Por que o CRM não deixa aprovar agora. Espelha o `portaoDoCrm` do servidor. */
export interface PortaoDoCrm {
  readonly mensagem: string;
  readonly acao: string;
}

/** `null` quando passa, e também sem estado ainda: quem responde, então, é o servidor. */
export function portaoDoCrm(crm: EstadoCrm | null): PortaoDoCrm | null {
  if (crm === null || crm.fase === "conectado") return null;
  const { mensagem, acao } = crm.fase === "atencao" ? PROBLEMAS[crm.problema.codigo] : ERROS.crm_desconectado;
  return { mensagem, acao };
}

export function fraseDoPortao(portao: PortaoDoCrm): string {
  return `${portao.mensagem} ${portao.acao}`;
}

export interface PedidoEmCurso {
  readonly id: string;
  readonly acao: AcaoDeDecisao | "editar";
}

/** O texto que a gaveta mostrou de cada cartão com `confiraOTexto`, por id: a versão e o hash que ela leu. */
export type TextosAbertos = ReadonlyMap<string, { readonly versao: number; readonly hash: string }>;

/**
 * O hash com que a linha decide. O resumo traz o hash, menos no cartão com `confiraOTexto`: esse só se
 * decide com o hash do cartão que a gaveta carregou, e só na versão que ela mostrou.
 */
export function hashParaDecidir(resumo: Pick<ResumoDaEscrita, "id" | "hash" | "versao">, abertos: TextosAbertos): string | null {
  if (resumo.hash !== null) return resumo.hash;
  const aberto = abertos.get(resumo.id);
  return aberto !== undefined && aberto.versao === resumo.versao ? aberto.hash : null;
}

export const MOTIVO_DE_ABRIR_O_TEXTO = "Abra o texto antes de aprovar";

/** Por que Aprovar da linha está desabilitado, ou `null`. O CRM barrado vem antes: abrir o texto não resolve. */
export function motivoDoAprovar(resumo: Pick<ResumoDaEscrita, "id" | "hash" | "versao">, abertos: TextosAbertos, portao: PortaoDoCrm | null): string | null {
  if (portao !== null) return fraseDoPortao(portao);
  return hashParaDecidir(resumo, abertos) === null ? MOTIVO_DE_ABRIR_O_TEXTO : null;
}

export interface VistaDoBotao {
  readonly desabilitado: boolean;
  readonly titulo: string | undefined;
  /** O botão que está esperando o CRM: ícone girando e "Gravando". */
  readonly gravando: boolean;
}

/**
 * Enquanto um pedido está em curso, todo botão de decisão da tela fica desabilitado, de todos os cartões.
 * `motivo` é o do Aprovar da linha; na gaveta o hash já está carregado, então só o portão vale.
 */
export function vistaDoBotao(
  acao: AcaoDoCartao,
  contexto: { readonly id: string; readonly pedido: PedidoEmCurso | null; readonly portao: PortaoDoCrm | null; readonly motivoDoAprovar?: string | null; readonly salvarPode?: boolean },
): VistaDoBotao {
  const { id, pedido, portao } = contexto;
  const motivo = acao === "aprovar" ? (contexto.motivoDoAprovar ?? (portao === null ? null : fraseDoPortao(portao))) : acao === "tentar_de_novo" && portao !== null ? fraseDoPortao(portao) : null;
  const semMudanca = acao === "salvar" && contexto.salvarPode !== true;
  return {
    desabilitado: (DECIDE.has(acao) && pedido !== null) || motivo !== null || semMudanca,
    titulo: motivo ?? undefined,
    gravando: GRAVA.has(acao) && pedido?.id === id && pedido.acao === acao,
  };
}

type CampoDoCartao = "linha" | "area" | "leitura";

interface DefinicaoDoCampo {
  readonly rotulo: string;
  /** `linha` e `area` são os campos de texto, os que o vendedor edita. */
  readonly tipo: CampoDoCartao;
  readonly obrigatorio?: true;
}

type ChavesDosDados<T extends ToolDeEscrita> = Exclude<keyof Extract<Escrita, { readonly tool: T }>["dados"], "cliente_id">;

/**
 * Os campos de cada tool, em português, na ordem de `docs-mcp/tools.md`. O compilador cobra a chave que faltar;
 * `cliente_id` é o bloco "Cliente", não um campo da lista. Ordem não conferida contra a tela do CRM de verdade.
 */
export const CAMPOS_DO_CARTAO: { readonly [T in ToolDeEscrita]: { readonly [C in ChavesDosDados<T>]: DefinicaoDoCampo } } = {
  registrar_atendimento: {
    assunto: { rotulo: "Assunto", tipo: "linha", obrigatorio: true },
    status: { rotulo: "Situação", tipo: "leitura" },
    descricao: { rotulo: "Descrição", tipo: "area" },
    contato_id: { rotulo: "Contato", tipo: "leitura" },
  },
  criar_compromisso: {
    titulo: { rotulo: "Título", tipo: "linha", obrigatorio: true },
    inicio: { rotulo: "Início", tipo: "leitura" },
    fim: { rotulo: "Fim", tipo: "leitura" },
    descricao: { rotulo: "Descrição", tipo: "area" },
    tipo: { rotulo: "Tipo", tipo: "leitura" },
  },
  criar_contato: {
    nome: { rotulo: "Nome", tipo: "linha", obrigatorio: true },
    telefone: { rotulo: "Telefone", tipo: "leitura" },
    email: { rotulo: "E-mail", tipo: "leitura" },
    cargo: { rotulo: "Cargo", tipo: "linha" },
    departamento: { rotulo: "Departamento", tipo: "linha" },
    observacoes: { rotulo: "Observações", tipo: "area" },
  },
};

const TIPOS_DE_COMPROMISSO: { readonly [tipo: string]: string } = { client: "Com cliente", internal: "Interno", operational: "Operacional" };

const SEMANA_DIA_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const MOMENTO = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

function horaDoRelogio(hora: number, minuto: number): string {
  return minuto === 0 ? `${hora}h` : `${hora}h${String(minuto).padStart(2, "0")}`;
}

/**
 * "sexta-feira, 20 de novembro, 10h", lido do texto `AAAA-MM-DD HH:MM`. A hora já é de Brasília: nada
 * converte fuso, as partes do texto viram o relógio como estão.
 */
export function momentoPorExtenso(texto: string): string {
  const achado = MOMENTO.exec(texto);
  if (achado === null) return texto;
  const [ano, mes, dia, hora, minuto] = achado.slice(1).map(Number) as [number, number, number, number, number];
  return `${SEMANA_DIA_MES.format(new Date(Date.UTC(ano, mes - 1, dia)))}, ${horaDoRelogio(hora, minuto)}`;
}

/** "1 hora e 30 minutos", "45 minutos", "2 horas". */
export function duracaoPorExtenso(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  const partes = [horas === 0 ? null : horas === 1 ? "1 hora" : `${horas} horas`, resto === 0 ? null : resto === 1 ? "1 minuto" : `${resto} minutos`];
  return partes.filter((parte) => parte !== null).join(" e ");
}

/** Quando termina um compromisso sem `fim`: "11h", ou "0h30, no dia seguinte" se passa da meia-noite. */
function terminaAs(inicio: string, minutos: number): string {
  const achado = MOMENTO.exec(inicio);
  if (achado === null) return inicio;
  const [ano, mes, dia, hora, minuto] = achado.slice(1).map(Number) as [number, number, number, number, number];
  const comeco = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const fim = new Date(comeco + minutos * 60_000);
  const outroDia = fim.getUTCDate() !== dia;
  return `${horaDoRelogio(fim.getUTCHours(), fim.getUTCMinutes())}${outroDia ? ", no dia seguinte" : ""}`;
}

export function fimPorExtenso(compromisso: NonNullable<CartaoVisto["compromisso"]>): string {
  if (compromisso.fimAssumido || compromisso.fim === null) {
    return `Não informado. O CRM assume ${duracaoPorExtenso(compromisso.duracaoMin)}: termina às ${terminaAs(compromisso.inicio, compromisso.duracaoMin)}.`;
  }
  return `${momentoPorExtenso(compromisso.fim)} (${duracaoPorExtenso(compromisso.duracaoMin)})`;
}

export interface CampoParaMostrar {
  readonly campo: string;
  readonly rotulo: string;
  readonly tipo: CampoDoCartao;
  readonly obrigatorio: boolean;
  /** Como o vendedor lê. No texto, cada caractere invisível já é `⟦U+XXXX⟧`. `null` é campo opcional ausente. */
  readonly valor: string | null;
  /** O texto como está guardado, para a edição. Vazio num campo ausente. */
  readonly cru: string;
}

function valorParaLer(tool: ToolDeEscrita, campo: string, cartao: Pick<CartaoVisto, "dados" | "compromisso">): string | null {
  const bruto = cartao.dados[campo];
  if (tool === "criar_compromisso" && cartao.compromisso !== null) {
    if (campo === "inicio") return momentoPorExtenso(cartao.compromisso.inicio);
    if (campo === "fim") return fimPorExtenso(cartao.compromisso);
  }
  if (bruto === undefined || bruto === null) return null;
  if (campo === "contato_id") return `Contato nº ${String(bruto)} do cliente no CRM`;
  if (campo === "tipo") return TIPOS_DE_COMPROMISSO[String(bruto)] ?? mostrarInvisiveis(String(bruto));
  return mostrarInvisiveis(String(bruto));
}

/** Os campos da tool na ordem da tabela. Campo opcional ausente fica de fora, menos o Fim do compromisso. */
export function camposDoCartao(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso">): CampoParaMostrar[] {
  const tabela: { readonly [campo: string]: DefinicaoDoCampo } = CAMPOS_DO_CARTAO[cartao.tool];
  return Object.entries(tabela).map(([campo, definicao]) => {
    const cru = cartao.dados[campo];
    return {
      campo,
      rotulo: definicao.rotulo,
      tipo: definicao.tipo,
      obrigatorio: definicao.obrigatorio === true,
      valor: valorParaLer(cartao.tool, campo, cartao),
      cru: typeof cru === "string" ? cru : "",
    };
  });
}

/** Os campos da leitura: o que está ausente não aparece. */
export function camposParaLer(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso">): CampoParaMostrar[] {
  return camposDoCartao(cartao).filter((campo) => campo.valor !== null);
}

/** A frase da marca, uma vez, para todos os campos de texto juntos. */
export function avisoDasMarcasDoCartao(campos: readonly CampoParaMostrar[]): string | null {
  const texto = campos.filter((campo) => campo.tipo !== "leitura" && campo.valor !== null).map((campo) => campo.valor).join("\n");
  return avisoDasMarcas(partesDoTexto(texto), "CRM");
}

export function textoDoCliente(cliente: ClienteDoCartao): { readonly nome: string; readonly cidade: string | null } {
  if (cliente === null) return { nome: "Sem cliente", cidade: null };
  if (!cliente.conferido) return { nome: `Cliente nº ${cliente.id}`, cidade: null };
  return { nome: cliente.nome, cidade: cliente.cidade };
}

/** O texto de cada campo editável, como está guardado. Opcional vazio entra com `""`. */
export function valoresDaEdicao(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso">): Record<string, string> {
  return Object.fromEntries(camposDoCartao(cartao).filter((campo) => campo.tipo !== "leitura").map((campo) => [campo.campo, campo.cru]));
}

/** O servidor apara as pontas e troca `\r\n` por `\n`: quem só mexeu nisso não mudou nada. */
function comoOServidorGuarda(texto: string): string {
  return texto.replace(/\r\n/g, "\n").trim();
}

/** Só os campos que mudaram. Opcional esvaziado vai como `""`, que o servidor tira. */
export function camposAlterados(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso">, valores: Readonly<Record<string, string>>): Record<string, string> {
  const antes = valoresDaEdicao(cartao);
  return Object.fromEntries(Object.entries(valores).filter(([campo, valor]) => campo in antes && comoOServidorGuarda(valor) !== antes[campo]));
}

export function corpoDeEditar(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso" | "hash" | "versao">, valores: Readonly<Record<string, string>>): { readonly hash: string; readonly versao: number; readonly campos: Record<string, string> } {
  return { hash: cartao.hash, versao: cartao.versao, campos: camposAlterados(cartao, valores) };
}

export function podeSalvar(cartao: Pick<CartaoVisto, "tool" | "dados" | "compromisso">, valores: Readonly<Record<string, string>>): boolean {
  return Object.keys(camposAlterados(cartao, valores)).length > 0;
}

const CONFLITOS = ["conflito_da_escrita", "estado_da_escrita", "cliente_por_conferir"];

/** O cartão que a recusa leva em `erro.atual`, ou `null` se não veio nada que pareça um. */
export function cartaoDoErro(erro: ErroOperacao): CartaoVisto | null {
  const atual = erro.atual as Partial<CartaoVisto> | null | undefined;
  if (typeof atual !== "object" || atual === null) return null;
  return typeof atual.id === "string" && typeof atual.hash === "string" && typeof atual.versao === "number" && typeof atual.estado === "string" && typeof atual.dados === "object" ? (atual as CartaoVisto) : null;
}

function avisoDoErroDaEscrita(erro: ErroOperacao): Aviso {
  if (CONFLITOS.includes(erro.codigo)) return { tom: "mudou", texto: erro.mensagem, detalhe: erro.acao };
  return { tom: "erro", texto: erro.mensagem, detalhe: erro.acao };
}

function erroDoCartao(cartao: CartaoVisto): { readonly mensagem: string; readonly acao: string } {
  const { erro } = cartao;
  return erro !== null && "mensagem" in erro ? { mensagem: erro.mensagem, acao: erro.acao } : { mensagem: ERROS.interno.mensagem, acao: ERROS.interno.acao };
}

export function textoDoGravado(cartao: Pick<CartaoVisto, "tool" | "cliente">): string {
  const nome = nomeDoCliente(cartao.cliente);
  const acao = NOMES_DAS_ACOES_DE_ESCRITA[cartao.tool].toLowerCase();
  return `Gravado no CRM: ${acao}${nome === null ? "" : ` de ${nome}`}.`;
}

/**
 * Aprovar com cliente por conferir não aprova: o servidor confere, e o cartão volta com nome e cidade. A frase
 * fixa do conflito chega ao painel no lugar da que o servidor escreve para esse caso (`respostaJson` troca a
 * mensagem pelo texto da tabela), então a tela a diz ao ver o cliente passar de por conferir a conferido.
 */
export const AVISO_DO_CLIENTE_CONFERIDO: Aviso = {
  tom: "mudou",
  texto: "A Secretária conferiu o cliente no CRM e o cartão mudou. Confira o nome e a cidade e aprove de novo.",
  detalhe: "Leia o cartão de novo e decida.",
};

function foiConferido(antes: ClienteDoCartao, atual: CartaoVisto | null): boolean {
  return antes !== null && !antes.conferido && atual?.cliente?.conferido === true;
}

export interface DesfechoDaDecisao {
  readonly aviso: Aviso;
  /** A gaveta aberta nesse cartão fecha. */
  readonly fechaGaveta: boolean;
  /**
   * O que a gaveta que ficou aberta mostra no alto do corpo: o erro do pedido. `null` quando ela fecha, ou
   * quando o cartão novo já traz o próprio erro (`falhou`, `falhou_incerto`), que a gaveta mostra.
   */
  readonly avisoNaGaveta: Aviso | null;
  /** O cartão que a resposta traz, para a gaveta aberta mostrar: o novo estado, ou `erro.atual` de um conflito. */
  readonly cartao: CartaoVisto | null;
}

/**
 * O que dizer depois de aprovar, descartar, tentar de novo ou marcar que já está no CRM. `antes` é o estado
 * em que o vendedor viu o cartão: descartar o que ficou incerto avisa para conferir no CRM.
 * O `link` do recibo vai como veio: quem o mostra confere com `linkDoCrm`.
 */
export function desfechoDaDecisao(acao: AcaoDeDecisao, antes: Pick<ResumoDaEscrita, "estado" | "cliente">, resposta: Resposta<CartaoVisto>): DesfechoDaDecisao {
  if (!resposta.ok) {
    const atual = cartaoDoErro(resposta.erro);
    const aviso = acao === "aprovar" && foiConferido(antes.cliente, atual) ? AVISO_DO_CLIENTE_CONFERIDO : avisoDoErroDaEscrita(resposta.erro);
    return { aviso, fechaGaveta: false, avisoNaGaveta: aviso, cartao: atual };
  }
  const cartao = resposta.dados;
  if (acao === "descartar") {
    const texto = antes.estado === "falhou_incerto" ? "Descartado. A Secretária parou de tentar. Confira no CRM se o registro existe." : "Descartado. Nada foi para o CRM.";
    return { aviso: { tom: "feito", texto, detalhe: null }, fechaGaveta: true, avisoNaGaveta: null, cartao };
  }
  if (acao === "ja_esta_no_crm") {
    return { aviso: { tom: "feito", texto: "Marcado como gravado. A Secretária não manda de novo.", detalhe: null }, fechaGaveta: true, avisoNaGaveta: null, cartao };
  }
  if (cartao.estado === "gravado") {
    const link = cartao.recibo?.link ?? null;
    return { aviso: { tom: "feito", texto: textoDoGravado(cartao), detalhe: null, ...(link === null ? {} : { link }) }, fechaGaveta: true, avisoNaGaveta: null, cartao };
  }
  const { mensagem, acao: proximo } = erroDoCartao(cartao);
  return { aviso: { tom: "erro", texto: mensagem, detalhe: proximo }, fechaGaveta: false, avisoNaGaveta: null, cartao };
}

export interface DesfechoDaEdicao {
  /** O aviso flutuante: só o de texto salvo. O erro fica dentro da gaveta. */
  readonly aviso: Aviso | null;
  /** O texto recusado, embaixo dos campos. */
  readonly erroNaGaveta: ErroOperacao | null;
  /** Conflito, 404 ou rede caída, no alto do corpo da gaveta. */
  readonly avisoNaGaveta: Aviso | null;
  readonly cartao: CartaoVisto | null;
  /** A edição sai de cena. Com o texto recusado ela continua aberta, como o vendedor a deixou. */
  readonly fechaEdicao: boolean;
}

export const AVISO_DE_TEXTO_SALVO = "Texto salvo. Agora é este o texto que vai para o CRM.";

export const TEXTO_NAO_SALVO = "O texto que você escreveu não foi salvo. Leia o cartão de novo e edite outra vez.";

/** Conflito fecha a edição: ela partiu de um cartão que já não é o atual. A gaveta diz que o texto escrito se perdeu. */
export function desfechoDaEdicao(resposta: Resposta<CartaoVisto>): DesfechoDaEdicao {
  if (resposta.ok) return { aviso: { tom: "feito", texto: AVISO_DE_TEXTO_SALVO, detalhe: null }, erroNaGaveta: null, avisoNaGaveta: null, cartao: resposta.dados, fechaEdicao: true };
  const { erro } = resposta;
  if (erro.codigo === "entrada_invalida") return { aviso: null, erroNaGaveta: erro, avisoNaGaveta: null, cartao: null, fechaEdicao: false };
  const conflito = CONFLITOS.includes(erro.codigo);
  const aviso = avisoDoErroDaEscrita(erro);
  return { aviso: null, erroNaGaveta: null, avisoNaGaveta: conflito ? { ...aviso, detalhe: TEXTO_NAO_SALVO } : aviso, cartao: cartaoDoErro(erro), fechaEdicao: conflito };
}

/** O aviso flutuante de uma decisão: o da linha, sempre; o da gaveta, só quando ela fecha, e no alto. */
export function avisoFlutuanteDaDecisao(desfecho: Pick<DesfechoDaDecisao, "aviso" | "fechaGaveta">, daGaveta: boolean): Aviso | null {
  if (!daGaveta) return desfecho.aviso;
  return desfecho.fechaGaveta ? { ...desfecho.aviso, noTopo: true } : null;
}

/** O que decidir precisa do cartão: o resumo da linha, ou o cartão que a gaveta carregou. */
export type AlvoDaDecisao = Pick<ResumoDaEscrita, "id" | "hash" | "versao" | "estado" | "cliente">;

export type ApiDaFila = Pick<ApiDeTarefas, "verEscrita" | "editarEscrita" | "descartarEscrita" | "aprovarEscrita" | "tentarDeNovo" | "jaEstaNoCrm">;

/**
 * Aprovar, descartar, tentar de novo ou marcar que já está no CRM, com o hash e a versão que o vendedor viu. O
 * resumo de um cartão com `confiraOTexto` não traz o hash: aí o cartão é buscado e a decisão usa o hash e a
 * versão que vierem. Só descartar chega aqui sem hash, porque a linha não aprova sem a gaveta ter aberto o texto.
 */
export async function decidirNoServidor(api: ApiDaFila, alvo: AlvoDaDecisao, acao: AcaoDeDecisao): Promise<DesfechoDaDecisao> {
  let { hash, versao, estado, cliente } = alvo;
  if (hash === null) {
    const lido = await api.verEscrita(alvo.id);
    if (!lido.ok) {
      const aviso = avisoDoErroDaEscrita(lido.erro);
      return { aviso, fechaGaveta: false, avisoNaGaveta: aviso, cartao: null };
    }
    ({ hash, versao, estado, cliente } = lido.dados);
  }
  const chamar = { aprovar: api.aprovarEscrita, descartar: api.descartarEscrita, tentar_de_novo: api.tentarDeNovo, ja_esta_no_crm: api.jaEstaNoCrm }[acao];
  return desfechoDaDecisao(acao, { estado, cliente }, await chamar(alvo.id, { hash, versao }));
}

/** Salvar a edição: só os campos que mudaram, com o hash e a versão do cartão carregado. */
export async function editarNoServidor(api: ApiDaFila, cartao: CartaoVisto, valores: Readonly<Record<string, string>>): Promise<DesfechoDaEdicao> {
  return desfechoDaEdicao(await api.editarEscrita(cartao.id, corpoDeEditar(cartao, valores)));
}

/**
 * A trava do clique duplo: o segundo clique chega antes do render que desabilita o botão, então o estado
 * da tela não basta. Guardada num `useRef`, como a de `EscolherCliente`.
 */
export interface Trava {
  /** Roda `fazer` se não há outra em curso; devolve `null` quando a trava estava fechada. */
  rodar<T>(fazer: () => Promise<T>): Promise<T | null>;
}

export function criarTrava(): Trava {
  let ocupada = false;
  return {
    async rodar(fazer) {
      if (ocupada) return null;
      ocupada = true;
      try {
        return await fazer();
      } finally {
        ocupada = false;
      }
    },
  };
}
