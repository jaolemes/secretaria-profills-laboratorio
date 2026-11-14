import { ArrowLeftRight, Check, ChevronRight, ExternalLink, EyeOff, LoaderCircle, Mail, MessageSquareWarning, Plus, RefreshCw, Undo2, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { chaveDoItem, type CanalDeVinculo, type ClienteSemAtendimento, type Compromisso, type Dia, type EstadoCrm, type NaoClienteDoDia, type PropostaAberta } from "../../dominio";
import type { MeuDia as DadosDoDia, Tarefa } from "../../tarefas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  SINCRONIZACAO_PARADA,
  alvoDoIgnorado,
  apoioDoIgnorado,
  atencaoDaProposta,
  blocoEscolhido,
  contador,
  diaVazio,
  explicacaoDoMotivo,
  FILTROS_DE_CANAL,
  filtroAplicado,
  itensFiltrados,
  limparFiltros,
  linhasSemLeitura,
  linkDoCrm,
  listaEscolhida,
  lugarDoCliente,
  montarBlocos,
  resumoDaSincronizacao,
  rodapeDoDia,
  rotuloDaSincronizacao,
  textoDaFaixa,
  textoDoCompromisso,
  textoDoEnvio,
  textoDosIgnorados,
  textoSemAtendimento,
  tituloDoIgnorado,
  valorDaProposta,
  type AlvoDoDia,
  type BlocoMontado,
  type ContagemDoFiltro,
  type EstadoDaSincronizacao,
  type Explicacao,
  type FiltroDeCanal,
  type FiltrosPorBloco,
  type IdDoBloco,
  type IgnoradoDoDia,
  type ItemDoDia,
  type ListaDoDia,
} from "../meu-dia";
import { hashDaRota } from "../rota";
import { diaPorExtenso, formatarDia } from "../tarefas";
import {
  AVISO_DE_DESFEITO,
  AVISO_DE_NAO_CLIENTE_DESFEITO,
  chaveDoNaoCliente,
  etiquetaDoCanal,
  frasePrincipalDoNaoCliente,
  recortarNaoClientes,
  textoDaEscolha,
  type AlvoDeVinculo,
  type RespostaDaEscolha,
} from "../conversas";
import { useAcoesDaTarefa } from "./AcoesDaTarefa";
import { MOTIVO_DE_ABRIR_O_TEXTO, acoesDaLinha, fraseDoPortao, motivoDoAprovar, selosDoCartao, vistaDoBotao, type AcaoDeDecisao, type AcaoDoCartao, type PortaoDoCrm } from "../aprovar";
import { AvisoFlutuante, BotaoDoMotivo, CabecalhoDaTela, ErroDeCarga, MetaDaTarefa, api, useCarga, useExecutor, type Executor } from "./comum";
import { BotaoDoCartao, GavetaDoCartao } from "./GavetaDoCartao";
import { GavetasDasConversas, type GavetaAberta } from "./GavetasDasConversas";
import { useFila, type FilaDeAprovacao } from "./useFila";

const SELO = "inline-flex h-6 shrink-0 items-center rounded-sm px-2 text-xs font-medium whitespace-nowrap";

function Selo({ children, atencao = false }: { children: ReactNode; atencao?: boolean }) {
  return <span className={cn(SELO, atencao ? "bg-destaque/15 text-destaque" : "bg-muted text-muted-foreground")}>{children}</span>;
}

/**
 * Uma linha da lista: título numa linha, a linha de apoio, os selos e as ações à direita, a principal por último.
 * `tituloEmDuasLinhas` deixa o título quebrar uma vez antes das reticências.
 */
function Linha({
  titulo,
  apoio,
  abrir,
  selos,
  acoes,
  embaixo,
  tituloEmDuasLinhas = false,
}: {
  titulo: string;
  apoio: ReactNode;
  abrir?: ReactNode;
  selos?: ReactNode;
  acoes: ReactNode;
  embaixo?: ReactNode;
  tituloEmDuasLinhas?: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className={cn("text-[15px] leading-snug font-medium", tituloEmDuasLinhas ? "line-clamp-2 break-words" : "truncate")} title={titulo}>
              {titulo}
            </p>
            <div className="min-w-0 text-sm text-muted-foreground">{apoio}</div>
          </div>
          {abrir}
        </div>
        {selos && <div className="flex flex-wrap items-center gap-1.5">{selos}</div>}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{acoes}</div>
      </div>
      {embaixo}
    </li>
  );
}

export function LinhaDaTarefa({ tarefa, hoje, executor }: { tarefa: Tarefa; hoje: Dia; executor: Executor }) {
  const { botoes, passo } = useAcoesDaTarefa({ tarefa, hoje, executor, arranjo: "linha" });
  return (
    <Linha
      titulo={tarefa.titulo}
      apoio={<MetaDaTarefa tarefa={tarefa} hoje={hoje} comSemData={false} />}
      abrir={
        <Button variant="ghost" size="icon-sm" asChild>
          <a href={hashDaRota({ tela: "tarefa", id: tarefa.id })} aria-label="Abrir a tarefa e as notas" title="Abrir a tarefa e as notas">
            <ChevronRight aria-hidden />
          </a>
        </Button>
      }
      acoes={botoes}
      embaixo={passo}
    />
  );
}

/** Abre a tela do CRM em outra aba. Link fora de `https` não vira botão. */
function AbrirNoCrm({ link }: { link: string | null }) {
  const seguro = linkDoCrm(link);
  if (seguro === null) return null;
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={seguro} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        Abrir no CRM
      </a>
    </Button>
  );
}

function LinhaDoCompromisso({ compromisso }: { compromisso: Compromisso }) {
  const apoio = [textoDoCompromisso(compromisso), compromisso.cliente?.nome].filter(Boolean).join(" · ");
  return <Linha titulo={compromisso.titulo} apoio={<p className="truncate">{apoio}</p>} acoes={null} />;
}

export interface AcoesDoDia {
  readonly ocupado: boolean;
  criarTarefa(alvo: AlvoDoDia): void;
  ignorar(alvo: AlvoDoDia, nome: string): void;
  desfazer(alvo: AlvoDoDia, nome: string): void;
  /** Abre a gaveta de escolher o cliente de uma conversa sem cliente. `chave` é a do item: o telefone, ou o id `e-...` do e-mail. */
  escolherCliente(canal: CanalDeVinculo, chave: string): void;
  /** Desfaz o "não é cliente" de um número ou endereço: a conversa volta a Responder com Qual cliente?, sem esperar a sincronização. */
  desfazerNaoCliente(alvo: AlvoDeVinculo): void;
  /** Trocar cliente: o confirmado volta a "Qual cliente?" na hora, com o cliente que era como candidato. */
  trocarCliente(alvo: AlvoDeVinculo): void;
  /** Abre a gaveta com o texto das mensagens em quarentena de uma conversa do WhatsApp, pelo telefone. */
  verMensagens(telefone: string): void;
  /** Abre a gaveta que lê o e-mail na hora, pelo id do item. */
  verEmail(id: string): void;
  /** O que a linha e a gaveta de um cartão da fila de aprovação compartilham. */
  readonly fila: FilaDeAprovacao;
}

function BotaoCriarTarefa({ acoes, alvo }: { acoes: AcoesDoDia; alvo: AlvoDoDia }) {
  return (
    <Button size="sm" disabled={acoes.ocupado} onClick={() => acoes.criarTarefa(alvo)}>
      <Plus aria-hidden />
      Criar tarefa
    </Button>
  );
}

function BotaoIgnorar({ acoes, alvo, nome }: { acoes: AcoesDoDia; alvo: AlvoDoDia; nome: string }) {
  return (
    <Button variant="outline" size="sm" disabled={acoes.ocupado} onClick={() => acoes.ignorar(alvo, nome)}>
      <EyeOff aria-hidden />
      Ignorar por 7 dias
    </Button>
  );
}

function LinhaDaProposta({ proposta, acoes }: { proposta: PropostaAberta; acoes: AcoesDoDia }) {
  const valor = valorDaProposta(proposta);
  const faixa = textoDaFaixa(proposta.faixa);
  const atencao = atencaoDaProposta(proposta);
  const nome = `Proposta ${proposta.codigo}`;
  return (
    <Linha
      titulo={`${proposta.codigo} · ${proposta.cliente.nome}`}
      apoio={<p className="truncate">{[textoDoEnvio(proposta.dias_desde_envio), valor].filter(Boolean).join(" · ")}</p>}
      selos={
        (faixa || atencao) && (
          <>
            {faixa && <Selo>{faixa}</Selo>}
            {atencao && <Selo atencao>{atencao}</Selo>}
          </>
        )
      }
      acoes={
        <>
          <AbrirNoCrm link={proposta.link} />
          <BotaoIgnorar acoes={acoes} alvo={{ tipo: "proposta", id: proposta.id }} nome={nome} />
          <BotaoCriarTarefa acoes={acoes} alvo={{ tipo: "proposta", id: proposta.id }} />
        </>
      }
    />
  );
}

function LinhaDoCliente({ cliente, acoes }: { cliente: ClienteSemAtendimento; acoes: AcoesDoDia }) {
  const lugar = lugarDoCliente(cliente);
  return (
    <Linha
      titulo={cliente.nome}
      apoio={<p className="truncate">{[textoSemAtendimento(cliente), lugar].filter(Boolean).join(" · ")}</p>}
      acoes={
        <>
          <BotaoIgnorar acoes={acoes} alvo={{ tipo: "cliente", id: cliente.id }} nome={cliente.nome} />
          <BotaoCriarTarefa acoes={acoes} alvo={{ tipo: "cliente", id: cliente.id }} />
        </>
      }
    />
  );
}

const SELO_DA_CONVERSA = "Qual cliente?";

type ConversaDeResponder = Extract<ItemDoDia, { tipo: "responder" }>["conversa"];

type ConversaDaLinha = ConversaDeResponder | Extract<ItemDoDia, { tipo: "esperando" }>["conversa"];

/** O alvo de Ignorar e Criar tarefa: o canal e a chave do item. */
function alvoDaConversa(conversa: ConversaDaLinha): AlvoDoDia {
  return { tipo: "conversa", canal: conversa.canal, id: chaveDoItem(conversa) };
}

/** A ação principal da conversa: Escolher cliente quando falta o cliente, senão Criar tarefa. Sem endereço não há o que escolher, e Criar tarefa recusaria. */
function PrincipalDaConversa({ conversa, acoes }: { conversa: ConversaDaLinha; acoes: AcoesDoDia }) {
  if (conversa.canal === "email" && conversa.endereco === null) return null;
  if (conversa.vinculo !== "ambiguo") return <BotaoCriarTarefa acoes={acoes} alvo={alvoDaConversa(conversa)} />;
  return (
    <Button size="sm" disabled={acoes.ocupado} onClick={() => acoes.escolherCliente(conversa.canal, chaveDoItem(conversa))}>
      <Users aria-hidden />
      Escolher cliente
    </Button>
  );
}

/** Só na conversa cujo cliente o vendedor confirmou: volta a perguntar "Qual cliente?". */
function BotaoTrocarCliente({ conversa, acoes }: { conversa: ConversaDaLinha; acoes: AcoesDoDia }) {
  if (conversa.vinculo !== "confirmado") return null;
  const alvo: AlvoDeVinculo | null = conversa.canal === "whatsapp" ? { canal: "whatsapp", chave: conversa.telefone } : conversa.endereco === null ? null : { canal: "email", chave: conversa.endereco };
  if (alvo === null) return null;
  return (
    <Button variant="outline" size="sm" disabled={acoes.ocupado} onClick={() => acoes.trocarCliente(alvo)}>
      <ArrowLeftRight aria-hidden />
      Trocar cliente
    </Button>
  );
}

/** Etiqueta do canal, entre o texto e as ações. Só com o filtro em "Tudo". */
function etiquetaDaLinha(conversa: Parameters<typeof etiquetaDoCanal>[0], mostrar: boolean): ReactNode {
  return mostrar && <Selo>{etiquetaDoCanal(conversa)}</Selo>;
}

/** Responder: o cliente do CRM, ou o contato ainda sem cliente. Nunca leva texto de mensagem nem corpo de e-mail. */
function LinhaDeResponder({ item, acoes, etiqueta }: { item: Extract<ItemDoDia, { tipo: "responder" }>; acoes: AcoesDoDia; etiqueta: boolean }) {
  const { conversa, titulo } = item;
  const alvo = alvoDaConversa(conversa);
  const nome = conversa.cliente === null ? titulo : conversa.cliente.nome;
  const ambiguo = conversa.vinculo === "ambiguo";
  return (
    <Linha
      titulo={titulo}
      // Quebra em vez de cortar numa linha: a frase da mensagem ilegível e o "há quanto tempo" do e-mail não podem sumir no celular.
      apoio={conversa.canal === "email" ? <ApoioDoEmail apoio={item.apoio} /> : <p className="break-words">{item.apoio}</p>}
      selos={
        (etiqueta || ambiguo || conversa.em_quarentena) && (
          <>
            {etiquetaDaLinha(conversa, etiqueta)}
            {ambiguo && <Selo atencao>{SELO_DA_CONVERSA}</Selo>}
            {conversa.em_quarentena && <Selo atencao>Em quarentena</Selo>}
          </>
        )
      }
      acoes={
        <>
          {conversa.canal === "email" ? (
            <BotaoVerEmail acoes={acoes} id={conversa.id} />
          ) : (
            conversa.em_quarentena && (
              <Button variant="outline" size="sm" onClick={() => acoes.verMensagens(conversa.telefone)}>
                <MessageSquareWarning aria-hidden />
                Ver mensagem
              </Button>
            )
          )}
          <BotaoTrocarCliente conversa={conversa} acoes={acoes} />
          <BotaoIgnorar acoes={acoes} alvo={alvo} nome={nome} />
          <PrincipalDaConversa conversa={conversa} acoes={acoes} />
        </>
      }
    />
  );
}

function BotaoVerEmail({ acoes, id }: { acoes: AcoesDoDia; id: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => acoes.verEmail(id)}>
      <Mail aria-hidden />
      Ver e-mail
    </Button>
  );
}

/** O assunto e o há quanto tempo, em até duas linhas. */
function ApoioDoEmail({ apoio }: { apoio: string }) {
  return (
    <p className="line-clamp-2 break-words" title={apoio}>
      {apoio}
    </p>
  );
}

function LinhaDeEsperando({ item, acoes, etiqueta }: { item: Extract<ItemDoDia, { tipo: "esperando" }>; acoes: AcoesDoDia; etiqueta: boolean }) {
  const { conversa } = item;
  const alvo = alvoDaConversa(conversa);
  const emQuarentena = conversa.canal === "email" && conversa.em_quarentena;
  const ambiguo = conversa.vinculo === "ambiguo";
  return (
    <Linha
      titulo={item.titulo}
      apoio={conversa.canal === "email" ? <ApoioDoEmail apoio={item.apoio} /> : <p className="truncate">{item.apoio}</p>}
      selos={
        (etiqueta || ambiguo || emQuarentena) && (
          <>
            {etiquetaDaLinha(conversa, etiqueta)}
            {ambiguo && <Selo atencao>{SELO_DA_CONVERSA}</Selo>}
            {emQuarentena && <Selo atencao>Em quarentena</Selo>}
          </>
        )
      }
      acoes={
        <>
          {conversa.canal === "email" && <BotaoVerEmail acoes={acoes} id={conversa.id} />}
          <BotaoTrocarCliente conversa={conversa} acoes={acoes} />
          <BotaoIgnorar acoes={acoes} alvo={alvo} nome={item.titulo} />
          <PrincipalDaConversa conversa={conversa} acoes={acoes} />
        </>
      }
    />
  );
}

/**
 * O cartão da fila: Descartar, Ver o texto e Aprovar. O texto do payload nunca aparece aqui, só na gaveta. O
 * título quebra em duas linhas: o nome do cliente decide o OK. A dica de abrir o texto aparece embaixo, porque o
 * `title` do botão desabilitado não chega ao toque nem ao teclado.
 */
function LinhaDoCartao({ item, acoes }: { item: Extract<ItemDoDia, { tipo: "aprovar" }>; acoes: AcoesDoDia }) {
  const { escrita, titulo, apoio } = item;
  const { fila } = acoes;
  const motivo = motivoDoAprovar(escrita, fila.abertos, fila.portao);
  const selos = selosDoCartao(escrita);
  const clicar = (acao: AcaoDoCartao) => (acao === "ver" ? fila.ver(escrita.id) : void fila.decidir(escrita, acao as AcaoDeDecisao));
  return (
    <Linha
      titulo={titulo}
      tituloEmDuasLinhas
      embaixo={motivo === MOTIVO_DE_ABRIR_O_TEXTO && <p className="text-xs leading-snug text-muted-foreground">{MOTIVO_DE_ABRIR_O_TEXTO}.</p>}
      apoio={
        <p className="truncate" title={apoio}>
          {apoio}
        </p>
      }
      selos={
        selos.length > 0 && (
          <>
            {selos.map((selo) => (
              <Selo key={selo} atencao>
                {selo}
              </Selo>
            ))}
          </>
        )
      }
      acoes={acoesDaLinha(escrita.estado).map((acao) => (
        <BotaoDoCartao key={acao} acao={acao} tamanho="sm" vista={vistaDoBotao(acao, { id: escrita.id, pedido: fila.pedido, portao: fila.portao, motivoDoAprovar: motivo })} aoClicar={() => clicar(acao)} />
      ))}
    />
  );
}

/** `etiqueta` põe a etiqueta do canal na linha de conversa: só quando o filtro de canal está em "Tudo". */
export function LinhaDoItem({ item, hoje, executor, acoes, etiqueta = false }: { item: ItemDoDia; hoje: Dia; executor: Executor; acoes: AcoesDoDia; etiqueta?: boolean }) {
  switch (item.tipo) {
    case "tarefa":
      return <LinhaDaTarefa tarefa={item.tarefa} hoje={hoje} executor={executor} />;
    case "compromisso":
      return <LinhaDoCompromisso compromisso={item.compromisso} />;
    case "proposta":
      return <LinhaDaProposta proposta={item.proposta} acoes={acoes} />;
    case "cliente":
      return <LinhaDoCliente cliente={item.cliente} acoes={acoes} />;
    case "responder":
      return <LinhaDeResponder item={item} acoes={acoes} etiqueta={etiqueta} />;
    case "esperando":
      return <LinhaDeEsperando item={item} acoes={acoes} etiqueta={etiqueta} />;
    case "aprovar":
      return <LinhaDoCartao item={item} acoes={acoes} />;
  }
}

/** No celular, dois por fileira e o último ímpar na fileira inteira; até o `xl`, quatro; daí em diante, todos numa fileira só. */
function Contadores({ blocos, escolhido, escolher }: { blocos: readonly BlocoMontado[]; escolhido: ListaDoDia; escolher: (id: IdDoBloco) => void }) {
  return (
    <div role="group" aria-label="Blocos do dia" className="grid grid-cols-2 gap-2.5 max-sm:[&>:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-4 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none">
      {blocos.map(({ definicao, conteudo }) => {
        const numero = contador(conteudo);
        const ativo = definicao.id === escolhido;
        return (
          <button
            key={definicao.id}
            type="button"
            aria-pressed={ativo}
            aria-controls="lista-do-dia"
            aria-label={`${definicao.nome}: ${numero.falado}`}
            onClick={() => escolher(definicao.id)}
            className={cn(
              "flex min-h-[4.75rem] flex-col items-start justify-between gap-1 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent",
              ativo ? "border-primary" : "border-border",
            )}
          >
            <span className={cn("text-2xl leading-none font-semibold tabular-nums", numero.apagado && "text-muted-foreground")}>{numero.texto}</span>
            <span className={cn("text-sm leading-snug", numero.apagado ? "text-muted-foreground" : "text-foreground")}>{definicao.nome}</span>
          </button>
        );
      })}
    </div>
  );
}

function CorpoNaoLido({ explicacao, sincronizar, sincronizando }: { explicacao: Explicacao; sincronizar: () => void; sincronizando: boolean }) {
  const { texto, acao, botao } = explicacao;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-5 md:px-5">
      <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
        <p className="text-[15px] font-medium">{texto}</p>
        <p className="text-sm text-muted-foreground">{acao}</p>
      </div>
      <div className="ml-auto">
        <BotaoDoMotivo botao={botao} sincronizar={sincronizar} sincronizando={sincronizando} />
      </div>
    </div>
  );
}

function DiaLivre() {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-5 md:px-5">
      <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
        <p className="text-[15px] font-medium">Nada pendente hoje.</p>
        <p className="text-sm text-muted-foreground">Crie uma tarefa ou peça ao seu agente. Para conferir o CRM e o WhatsApp de novo, use Sincronizar, no rodapé.</p>
      </div>
      <div className="ml-auto">
        <Button size="sm" asChild>
          <a href={hashDaRota({ tela: "nova" })}>
            <Plus aria-hidden />
            Criar tarefa
          </a>
        </Button>
      </div>
    </div>
  );
}

/** Tudo, WhatsApp e E-mail, cada um com a contagem da lista. O escolhido leva a borda na cor da ação. */
export function FiltroPorCanal({ contagem, escolhido, escolher }: { contagem: ContagemDoFiltro; escolhido: FiltroDeCanal; escolher: (filtro: FiltroDeCanal) => void }) {
  return (
    <div role="group" aria-label="Filtrar por canal" className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5 md:px-5">
      {FILTROS_DE_CANAL.map(({ id, rotulo }) => (
        <Button
          key={id}
          variant="outline"
          size="sm"
          aria-pressed={escolhido === id}
          // O escolhido se vê também pela forma (visto e peso), e o foco nele pinta um tom acima, já que o fundo dele é o do hover.
          className={cn(escolhido === id && "border-primary bg-accent font-semibold hover:bg-primary/20")}
          onClick={() => escolher(id)}
        >
          {escolhido === id && <Check aria-hidden />}
          {rotulo}
          <span className="text-muted-foreground tabular-nums">{contagem[id]}</span>
        </Button>
      ))}
    </div>
  );
}

interface PropsDaLista {
  readonly bloco: BlocoMontado;
  /** O filtro de canal escolhido neste bloco. */
  readonly filtro: FiltroDeCanal | undefined;
  readonly escolherFiltro: (filtro: FiltroDeCanal) => void;
  readonly dia: DadosDoDia;
  readonly tudoVazio: boolean;
  readonly executor: Executor;
  readonly acoes: AcoesDoDia;
  readonly sincronizar: () => void;
  readonly sincronizando: boolean;
  /** O CRM fora de `conectado` barra Aprovar: a frase aparece uma vez, na faixa de notas de Aprovar. */
  readonly portao: PortaoDoCrm | null;
}

function ListaDoBloco({ bloco, filtro, escolherFiltro, dia, tudoVazio, executor, acoes, sincronizar, sincronizando, portao }: PropsDaLista) {
  const { definicao, conteudo } = bloco;
  const idDoTitulo = "titulo-da-lista-do-dia";
  const numero = contador(conteudo);
  const aplicado = filtroAplicado(conteudo, filtro);
  const visiveis = conteudo.leitura === "lido" ? itensFiltrados(conteudo.itens, aplicado) : [];
  const contagem = conteudo.leitura === "lido" ? conteudo.filtro : undefined;
  let corpo: ReactNode;
  if (conteudo.leitura === "nao_lido") corpo = <CorpoNaoLido explicacao={explicacaoDoMotivo(conteudo)} sincronizar={sincronizar} sincronizando={sincronizando} />;
  else if (visiveis.length > 0) {
    corpo = (
      <ul className="max-h-[min(36rem,65dvh)] divide-y overflow-y-auto">
        {visiveis.map((item) => (
          <LinhaDoItem key={item.chave} item={item} hoje={dia.hoje} executor={executor} acoes={acoes} etiqueta={contagem !== undefined && aplicado === "tudo"} />
        ))}
      </ul>
    );
  } else if (aplicado !== "tudo" && conteudo.leitura === "lido") corpo = <p className="px-4 py-5 text-[15px] text-muted-foreground md:px-5">{conteudo.vazioDoFiltro?.[aplicado]}</p>;
  else if (tudoVazio && definicao.id === "fazer-hoje") corpo = <DiaLivre />;
  else corpo = <p className="px-4 py-5 text-[15px] text-muted-foreground md:px-5">{definicao.vazio}</p>;

  const notas = conteudo.leitura === "lido" ? conteudo.notas : [];
  const avisoDoCrm = definicao.id === "aprovar" && portao !== null && visiveis.length > 0 ? portao : null;
  return (
    <Card id="lista-do-dia" role="region" aria-labelledby={idDoTitulo} className="gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3 md:px-5">
        <h2 id={idDoTitulo} className="text-base font-semibold">
          {definicao.nome}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{numero.texto}</span>
        <span className="ml-auto text-right text-xs text-muted-foreground">{definicao.dica(dia)}</span>
      </header>
      {contagem !== undefined && <FiltroPorCanal contagem={contagem} escolhido={aplicado} escolher={escolherFiltro} />}
      {(notas.length > 0 || avisoDoCrm !== null) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-xs text-muted-foreground md:px-5">
          <div className="min-w-0 flex-[1_1_16rem]">
            {notas.map((nota) => (
              <p key={nota}>{nota}</p>
            ))}
            {avisoDoCrm !== null && <p>{fraseDoPortao(avisoDoCrm)}</p>}
          </div>
          {avisoDoCrm !== null && (
            <div className="ml-auto">
              <BotaoDoMotivo botao="conexoes" sincronizar={sincronizar} sincronizando={sincronizando} />
            </div>
          )}
        </div>
      )}
      {corpo}
    </Card>
  );
}

export function LinhaDoIgnorado({ item, hoje, acoes }: { item: IgnoradoDoDia; hoje: Dia; acoes: AcoesDoDia }) {
  const titulo = tituloDoIgnorado(item);
  const apoio = apoioDoIgnorado(item, hoje);
  return (
    <Linha
      titulo={titulo}
      apoio={
        <p className="line-clamp-2 break-words" title={apoio}>
          {apoio}
        </p>
      }
      acoes={
        <Button size="sm" disabled={acoes.ocupado} onClick={() => acoes.desfazer(alvoDoIgnorado(item), titulo)}>
          <Undo2 aria-hidden />
          Desfazer
        </Button>
      }
    />
  );
}

function ListaDosIgnorados({ itens, hoje, acoes }: { itens: readonly IgnoradoDoDia[]; hoje: Dia; acoes: AcoesDoDia }) {
  const idDoTitulo = "titulo-da-lista-do-dia";
  return (
    <Card id="lista-do-dia" role="region" aria-labelledby={idDoTitulo} className="gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3 md:px-5">
        <h2 id={idDoTitulo} className="text-base font-semibold">
          Ignorados pelo agente
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{itens.length}</span>
        <span className="ml-auto text-right text-xs text-muted-foreground">A seu pedido, por 7 dias</span>
      </header>
      <ul className="max-h-[min(36rem,65dvh)] divide-y overflow-y-auto">
        {itens.map((item) => (
          <LinhaDoIgnorado key={`${item.tipo}:${item.id}`} item={item} hoje={hoje} acoes={acoes} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Uma linha discreta por número ou endereço que o vendedor marcou como não cliente, com Desfazer, na
 * ordem do servidor. Fica até ele desfazer. Passando de 5, as 5 mais novas e "e mais N". Sem nenhum, não existe.
 */
export function NaoClientes({ itens, acoes }: { itens: readonly NaoClienteDoDia[]; acoes: AcoesDoDia }) {
  const { visiveis, restantes } = recortarNaoClientes(itens.flatMap((item) => {
    const alvo = chaveDoNaoCliente(item);
    return alvo === null ? [] : [{ item, alvo }];
  }));
  if (visiveis.length === 0) return null;
  return (
    <ul aria-label="Números e endereços que você disse que não são clientes" className="flex flex-col gap-2 text-sm text-muted-foreground">
      {visiveis.map(({ item, alvo }) => (
        <li key={`${alvo.canal}:${alvo.chave}`} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-[1_1_16rem] break-words">{frasePrincipalDoNaoCliente(item.canal === "email" ? { canal: "email", endereco: alvo.chave } : item)}</span>
          <Button variant="outline" size="sm" disabled={acoes.ocupado} onClick={() => acoes.desfazerNaoCliente(alvo)}>
            Desfazer
          </Button>
        </li>
      ))}
      {restantes > 0 && <li>e mais {restantes}</li>}
    </ul>
  );
}

/** Abre e fecha a lista dos ignorados pelo agente. Sem item, não existe. */
function LinhaDosIgnorados({ quantos, aberta, alternar }: { quantos: number; aberta: boolean; alternar: () => void }) {
  const texto = textoDosIgnorados(quantos);
  if (texto === null) return null;
  return (
    <div>
      <Button variant="outline" size="sm" aria-pressed={aberta} aria-controls="lista-do-dia" onClick={alternar} className={cn("text-muted-foreground", aberta && "border-primary text-foreground")}>
        <EyeOff aria-hidden />
        {texto}
      </Button>
    </div>
  );
}

function Rodape({ dia, rotulo, sincronizando, sincronizar }: { dia: DadosDoDia; rotulo: string; sincronizando: boolean; sincronizar: () => void }) {
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t pt-4 text-sm text-muted-foreground">
      <ul aria-label="Idade dos dados" className="flex flex-wrap gap-x-5 gap-y-1">
        {rodapeDoDia(dia).map((fonte) => (
          <li key={fonte.fonte} className="whitespace-nowrap tabular-nums">
            <span className="text-foreground">{fonte.nome}</span> {fonte.idade}
          </li>
        ))}
      </ul>
      <Button variant="outline" className="ml-auto" disabled={sincronizando} onClick={sincronizar} aria-live="polite">
        {sincronizando ? <LoaderCircle aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
        {rotulo}
      </Button>
    </footer>
  );
}

/** A idade das fontes envelhece sozinha: o Meu dia recarrega a cada minuto, além do `event: tarefas`. */
function useMinuto(): number {
  const [minuto, setMinuto] = useState(0);
  useEffect(() => {
    const relogio = setInterval(() => setMinuto((n) => n + 1), 60_000);
    return () => clearInterval(relogio);
  }, []);
  return minuto;
}

/**
 * A rodada pedida aqui, mais o andamento que o SSE mostra, de qualquer rodada. A resposta do POST
 * fecha a rodada dela mesmo se o `terminou` do SSE se perdeu.
 */
function useSincronizacao(rodada: EstadoDaSincronizacao, recarregar: () => void, executor: Executor) {
  const [pedindo, setPedindo] = useState(false);
  const [fechada, setFechada] = useState<string | null>(null);

  const sincronizar = async () => {
    setPedindo(true);
    const resposta = await api.sincronizar();
    setPedindo(false);
    recarregar();
    if (!resposta.ok) {
      executor.avisar({ tom: "erro", texto: resposta.erro.mensagem, detalhe: resposta.erro.acao });
      return;
    }
    setFechada(resposta.dados.id);
    const resumo = resumoDaSincronizacao(resposta.dados);
    executor.avisar(resumo.tom === "feito" ? { tom: "feito", texto: resumo.texto, detalhe: null, linhas: resumo.linhas } : { tom: "erro", texto: resumo.texto, detalhe: "", linhas: resumo.linhas });
  };

  const naTela = rodada.tipo === "rodando" && rodada.id !== fechada ? rodada : SINCRONIZACAO_PARADA;
  const rotulo = naTela.tipo === "parada" && pedindo ? "Sincronizando" : rotuloDaSincronizacao(naTela);
  return { rodando: pedindo || naTela.tipo === "rodando", rotulo, sincronizar: () => void sincronizar() };
}

/** Criar tarefa, ignorar e desfazer, a partir de uma proposta, de um cliente ou de uma conversa. */
function useAcoesDoDia(hoje: Dia | null, recarregar: () => void, executor: Executor, verFazerHoje: () => void, abrir: (gaveta: GavetaAberta) => void, fila: FilaDeAprovacao) {
  const [ocupado, setOcupado] = useState(false);
  // Um id de tarefa por item até dar certo: o clique duplo e a nova tentativa caem na mesma tarefa.
  const rascunhos = useRef(new Map<string, string>());

  const rodar = async (fazer: () => Promise<void>) => {
    setOcupado(true);
    try {
      await fazer();
    } finally {
      setOcupado(false);
      recarregar();
    }
  };

  const desfazer = (alvo: AlvoDoDia, nome: string | null) =>
    void rodar(async () => {
      const desfeito = await api.desfazerIgnorado(alvo);
      if (!desfeito.ok) executor.avisar({ tom: "erro", texto: desfeito.erro.mensagem, detalhe: desfeito.erro.acao });
      else if (nome !== null) executor.avisar({ tom: "feito", texto: `${nome} de volta ao Meu dia.`, detalhe: null });
    });

  const desfazerEscolha = (alvo: AlvoDeVinculo) =>
    void rodar(async () => {
      const desfeito = await api.desfazerEscolha(alvo);
      executor.avisar(desfeito.ok ? { tom: "feito", ...AVISO_DE_DESFEITO } : { tom: "erro", texto: desfeito.erro.mensagem, detalhe: desfeito.erro.acao });
    });

  const desfazerNaoCliente = (alvo: AlvoDeVinculo) =>
    void rodar(async () => {
      const desfeito = await api.desfazerEscolha(alvo);
      executor.avisar(desfeito.ok ? { tom: "feito", ...AVISO_DE_NAO_CLIENTE_DESFEITO, noTopo: true } : { tom: "erro", texto: desfeito.erro.mensagem, detalhe: desfeito.erro.acao });
    });

  const acoes: AcoesDoDia = {
    fila,
    ocupado,
    criarTarefa: (alvo) => {
      const chave = alvo.tipo === "conversa" ? `conversa:${alvo.canal}:${alvo.id}` : `${alvo.tipo}:${alvo.id}`;
      const tarefaId = rascunhos.current.get(chave) ?? crypto.randomUUID();
      rascunhos.current.set(chave, tarefaId);
      void rodar(async () => {
        const resposta = await api.criarDoMeuDia(alvo, tarefaId);
        if (!resposta.ok) {
          executor.avisar({ tom: "erro", texto: resposta.erro.mensagem, detalhe: resposta.erro.acao });
          return;
        }
        rascunhos.current.delete(chave);
        executor.avisar({ tom: "feito", texto: "Tarefa criada em Fazer hoje.", detalhe: resposta.dados.tarefa.titulo });
        verFazerHoje();
      });
    },
    ignorar: (alvo, nome) =>
      void rodar(async () => {
        const resposta = await api.ignorar(alvo);
        if (!resposta.ok) {
          executor.avisar({ tom: "erro", texto: resposta.erro.mensagem, detalhe: resposta.erro.acao });
          return;
        }
        executor.avisar({
          tom: "feito",
          texto: `${nome} fora da lista até ${formatarDia(resposta.dados.ate, hoje ?? resposta.dados.ate)}.`,
          detalhe: "Volta sozinho depois disso, se ainda estiver pendente.",
          desfazer: () => desfazer(alvo, null),
        });
      }),
    desfazer,
    escolherCliente: (canal, chave) => abrir({ tipo: "escolher", canal, chave }),
    desfazerNaoCliente,
    trocarCliente: desfazerEscolha,
    verMensagens: (telefone) => abrir({ tipo: "quarentena", canal: "whatsapp", chave: telefone }),
    verEmail: (id) => abrir({ tipo: "email", canal: "email", chave: id }),
  };

  /** O que dizer depois de a gaveta decidir: os dois avisos levam o Desfazer. O de "não é cliente" fica no topo, por 10 segundos. */
  const escolheu = (alvo: AlvoDeVinculo, resposta: RespostaDaEscolha) => {
    const naoCliente = resposta.estado === "nao_cliente";
    executor.avisar({ tom: "feito", ...textoDaEscolha(resposta), desfazer: () => (naoCliente ? desfazerNaoCliente(alvo) : desfazerEscolha(alvo)), ...(naoCliente ? { noTopo: true } : {}) });
    recarregar();
  };

  return { acoes, escolheu };
}

export interface PropsDoMeuDia {
  readonly mudancas: number;
  readonly lista: ListaDoDia | undefined;
  readonly sincronizacao: EstadoDaSincronizacao;
  /** Muda quando uma rodada termina, pedida aqui ou pelo agente: o Meu dia recarrega o CRM. */
  readonly rodadasTerminadas: number;
  /** Muda quando o WhatsApp ou o CRM muda de fase: o motivo de um bloco sem leitura depende delas. */
  readonly conectores: string;
  /** O estado do CRM, para barrar Aprovar na tela com o motivo. `null` até o primeiro estado do SSE: o servidor responde. */
  readonly crm: EstadoCrm | null;
}

export function MeuDia({ mudancas, lista, sincronizacao, rodadasTerminadas, conectores, crm }: PropsDoMeuDia) {
  const minuto = useMinuto();
  const carga = useCarga("meu-dia", () => api.meuDia(), `${mudancas}:${minuto}:${rodadasTerminadas}:${conectores}`);
  const executor = useExecutor(carga.recarregar);
  const dia = carga.dados;
  const blocos = dia === null ? [] : montarBlocos(dia);
  const ignorados = dia?.ignorados_pelo_agente ?? [];
  const escolhida = listaEscolhida(lista ?? null, blocos, ignorados.length);
  const escolher = (id: ListaDoDia) => window.location.replace(hashDaRota({ tela: "meu-dia", lista: id }));
  const sinc = useSincronizacao(sincronizacao, carga.recarregar, executor);
  const [gaveta, setGaveta] = useState<GavetaAberta>(null);
  const fecharGaveta = useCallback(() => setGaveta(null), []);
  const [cartaoAberto, setCartaoAberto] = useState<string | null>(null);
  const fecharCartao = useCallback(() => setCartaoAberto(null), []);
  // O aviso fica acima do véu: o que veio de antes sai ao abrir uma gaveta, para não cobrir os botões dela.
  const abrirGaveta = (aberta: GavetaAberta) => {
    executor.fecharAviso();
    setGaveta(aberta);
  };
  const abrirCartao = (id: string) => {
    executor.fecharAviso();
    setCartaoAberto(id);
  };
  const fila = useFila({ executor, recarregar: carga.recarregar, crm, abrir: abrirCartao, fecharGaveta: (id) => setCartaoAberto((aberto) => (aberto === id ? null : aberto)) });
  const { acoes, escolheu } = useAcoesDoDia(dia?.hoje ?? null, carga.recarregar, executor, () => escolher("fazer-hoje"), abrirGaveta, fila);
  // O filtro de canal de cada bloco fica só neste estado: recarregar a página volta a "Tudo".
  const [filtros, setFiltros] = useState<FiltrosPorBloco>({});

  // A escolha vai para o hash: recarregar mantém a lista, e um bloco que esvazia segue escolhido.
  // Os ignorados que acabam voltam aos blocos, e o hash acompanha.
  useEffect(() => {
    if (dia !== null && lista !== escolhida) escolher(escolhida);
  }, [lista, dia === null, escolhida]);

  // O bloco que perde a fileira esquece a escolha, e ela volta em "Tudo" se a fileira reaparecer.
  useEffect(() => {
    setFiltros((atuais) => limparFiltros(atuais, blocos));
  }, [dia]);

  const selecionado = blocos.find(({ definicao }) => definicao.id === escolhida);
  const semLeitura = dia === null ? [] : linhasSemLeitura(dia, escolhida);
  const alternarIgnorados = () => escolher(escolhida === "ignorados" ? blocoEscolhido(null, blocos) : "ignorados");

  return (
    <div className="flex flex-col gap-4">
      <CabecalhoDaTela titulo="Meu dia" descricao={dia === null ? "O que pede a sua atenção hoje." : `${diaPorExtenso(dia.hoje)}. O que pede a sua atenção hoje.`} />
      {carga.erro && <ErroDeCarga erro={carga.erro} tentar={carga.recarregar} />}
      {dia !== null && (
        <>
          <Contadores blocos={blocos} escolhido={escolhida} escolher={escolher} />
          {escolhida === "ignorados" ? (
            <ListaDosIgnorados itens={ignorados} hoje={dia.hoje} acoes={acoes} />
          ) : (
            selecionado !== undefined && (
              <ListaDoBloco
                bloco={selecionado}
                filtro={filtros[selecionado.definicao.id]}
                escolherFiltro={(filtro) => setFiltros((atuais) => ({ ...atuais, [selecionado.definicao.id]: filtro }))}
                dia={dia}
                tudoVazio={diaVazio(blocos)}
                executor={executor}
                acoes={acoes}
                sincronizar={sinc.sincronizar}
                sincronizando={sinc.rodando}
                portao={fila.portao}
              />
            )
          )}
          {semLeitura.map((linha) => (
            <div key={linha.texto} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <p className="min-w-0 flex-[1_1_16rem]">{linha.texto}</p>
              {/* Sincronizar já está no rodapé, logo abaixo. */}
              {linha.botao === "conexoes" && <BotaoDoMotivo botao="conexoes" sincronizar={sinc.sincronizar} sincronizando={sinc.rodando} />}
            </div>
          ))}
          <NaoClientes itens={dia.nao_clientes} acoes={acoes} />
          <LinhaDosIgnorados quantos={ignorados.length} aberta={escolhida === "ignorados"} alternar={alternarIgnorados} />
          <Rodape dia={dia} rotulo={sinc.rotulo} sincronizando={sinc.rodando} sincronizar={sinc.sincronizar} />
        </>
      )}
      <GavetasDasConversas gaveta={gaveta} conversas={[...(dia?.responder.itens ?? []), ...(dia?.esperando_cliente.itens ?? [])]} fechar={fecharGaveta} escolheu={escolheu} />
      <GavetaDoCartao id={cartaoAberto} mudancas={mudancas} fila={fila} fechar={fecharCartao} />
      <AvisoFlutuante aviso={executor.aviso} fechar={executor.fecharAviso} />
    </div>
  );
}
