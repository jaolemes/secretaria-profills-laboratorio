import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { ErroOperacao } from "../../dominio";
import type { CartaoVisto } from "../../escritas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AlertaDeErro, Selo } from "../cartoes/Cartao";
import { CLASSE_DA_GAVETA, Cabecalho, Corpo, ROTULO_DE_SECAO, Rodape } from "../cartoes/GavetaDoEmail";
import {
  FRASES_DO_ESTADO_FINAL,
  NOMES_DAS_ACOES_DE_ESCRITA,
  ROTULOS_DAS_ACOES_DO_CARTAO,
  acoesDaGaveta,
  apoioDoCartao,
  avisoDasMarcasDoCartao,
  camposDoCartao,
  ehPrincipal,
  fraseDoPortao,
  podeSalvar,
  selosDoCartao,
  sinaisDoCartao,
  textoDoCliente,
  valoresDaEdicao,
  vistaDoBotao,
  type AcaoDeDecisao,
  type AcaoDoCartao,
  type PedidoEmCurso,
  type PortaoDoCrm,
  type VistaDoBotao,
} from "../aprovar";
import { NOMES_DOS_SINAIS } from "../conversas";
import type { Aviso } from "../tarefas";
import { BotaoDoMotivo, CLASSE_DO_CAMPO_DE_TEXTO, api, useCarga } from "./comum";
import { focarNaAbertura } from "./GavetasDasConversas";
import { TextoDaMensagem } from "./TextoMarcado";
import type { FilaDeAprovacao } from "./useFila";

/** A edição aberta: o texto de cada campo editável como o vendedor o deixou, e o erro que o servidor recusou. */
export interface EdicaoDaGaveta {
  readonly valores: Readonly<Record<string, string>>;
  readonly erro: ErroOperacao | null;
}

export interface PropsDoMiolo {
  readonly cartao: CartaoVisto;
  readonly agora: Date;
  readonly portao: PortaoDoCrm | null;
  readonly pedido: PedidoEmCurso | null;
  readonly edicao: EdicaoDaGaveta | null;
  /** Falha ao recarregar o cartão com a gaveta aberta. */
  readonly erroDeCarga?: ErroOperacao | null;
  /** O erro do último pedido feito daqui: a gaveta fica aberta e o diz no alto do corpo. */
  readonly alerta?: Aviso | null;
  aoEditar(): void;
  aoCancelar(): void;
  aoSalvar(): void;
  aoMudarCampo(campo: string, texto: string): void;
  aoDecidir(acao: AcaoDeDecisao): void;
  fechar(): void;
}

const ATENCAO = "rounded-lg bg-destaque/10 px-3 py-2.5 text-sm leading-snug text-foreground";

function Paragrafo({ children }: { children: ReactNode }) {
  return <p className={ATENCAO}>{children}</p>;
}

/** O que pede atenção no topo do corpo, um parágrafo por caso. */
function Atencoes({ cartao, portao }: { cartao: CartaoVisto; portao: PortaoDoCrm | null }) {
  const sinais = sinaisDoCartao(cartao.sinais);
  const { cliente } = cartao;
  const decide = cartao.estado === "rascunho" || cartao.estado === "falhou" || cartao.estado === "falhou_incerto";
  const erro = cartao.erro !== null && "mensagem" in cartao.erro ? cartao.erro : null;
  return (
    <>
      {cartao.confiraOTexto && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {sinais.map((sinal) => (
              <Selo key={sinal} tom="atencao" texto={NOMES_DOS_SINAIS[sinal]} />
            ))}
          </div>
          <Paragrafo>O texto acendeu um sinal de atenção. Leia antes de aprovar.</Paragrafo>
        </div>
      )}
      {cartao.confiraOCliente && <Paragrafo>A Secretária achou este cliente pelo número ou pelo e-mail da conversa. Confira se é este.</Paragrafo>}
      {cliente !== null && !cliente.conferido && <Paragrafo>A Secretária ainda não conferiu este cliente no CRM. Ao aprovar, ela confere e mostra o nome para você aprovar de novo.</Paragrafo>}
      {erro !== null && <AlertaDeErro erro={{ codigo: erro.codigo, mensagem: erro.mensagem, acao: erro.acao }} />}
      {decide && portao !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-[1_1_14rem] text-sm leading-snug">{fraseDoPortao(portao)}</p>
          <BotaoDoMotivo botao="conexoes" sincronizar={() => {}} sincronizando={false} />
        </div>
      )}
    </>
  );
}

function AlertaDoPedido({ aviso }: { aviso: Aviso }) {
  const mudou = aviso.tom === "mudou";
  return (
    <div role="alert" className={cn("rounded-lg border px-3 py-2.5 text-sm leading-snug", mudou ? "border-destaque/50" : "border-destructive/40")}>
      <p className={cn("font-medium", mudou ? "text-foreground" : "text-destructive")}>{aviso.texto}</p>
      {aviso.detalhe && <p className="text-muted-foreground">{aviso.detalhe}</p>}
    </div>
  );
}

function Valor({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-snug break-words">{children}</p>;
}

function Rotulo({ children }: { children: ReactNode }) {
  return <p className={ROTULO_DE_SECAO}>{children}</p>;
}

/** A leitura: cada campo de texto inteiro, com cada caractere invisível marcado. Tudo é texto puro, nunca HTML nem link. */
function Campos({ cartao, edicao, aoMudarCampo, desabilitado }: { cartao: CartaoVisto; edicao: EdicaoDaGaveta | null; aoMudarCampo: PropsDoMiolo["aoMudarCampo"]; desabilitado: boolean }) {
  const base = useId();
  const campos = camposDoCartao(cartao);
  const editando = edicao !== null;
  const visiveis = campos.filter((campo) => (editando && campo.tipo !== "leitura") || campo.valor !== null);
  const aviso = editando ? null : avisoDasMarcasDoCartao(campos);
  return (
    <>
      {visiveis.map((campo) => {
        const id = `${base}-${campo.campo}`;
        if (edicao !== null && campo.tipo !== "leitura") {
          const valor = edicao.valores[campo.campo] ?? "";
          return (
            <div key={campo.campo} className="flex flex-col gap-1.5">
              <Label htmlFor={id} className={ROTULO_DE_SECAO}>
                {campo.rotulo}
              </Label>
              {campo.tipo === "linha" ? (
                <Input id={id} value={valor} disabled={desabilitado} aria-required={campo.obrigatorio} onChange={(evento) => aoMudarCampo(campo.campo, evento.target.value)} />
              ) : (
                <textarea id={id} value={valor} rows={5} disabled={desabilitado} className={CLASSE_DO_CAMPO_DE_TEXTO} onChange={(evento) => aoMudarCampo(campo.campo, evento.target.value)} />
              )}
            </div>
          );
        }
        return (
          <div key={campo.campo} className="flex flex-col gap-1.5">
            <Rotulo>{campo.rotulo}</Rotulo>
            {campo.tipo === "leitura" ? <Valor>{campo.valor}</Valor> : <TextoDaMensagem texto={campo.valor ?? ""} />}
          </div>
        );
      })}
      {aviso !== null && <p className="text-xs leading-snug text-muted-foreground">{aviso}</p>}
    </>
  );
}

export function BotaoDoCartao({ acao, vista, tamanho, aoClicar }: { acao: AcaoDoCartao; vista: VistaDoBotao; tamanho?: "sm"; aoClicar: () => void }) {
  const botao = (
    <Button variant={ehPrincipal(acao) ? "default" : "outline"} size={tamanho} disabled={vista.desabilitado} title={vista.titulo} onClick={aoClicar}>
      {vista.gravando && <LoaderCircle aria-hidden className="animate-spin" />}
      {vista.gravando ? "Gravando" : ROTULOS_DAS_ACOES_DO_CARTAO[acao]}
    </Button>
  );
  // O botão desabilitado não recebe o mouse: a dica fica no envoltório.
  return vista.titulo === undefined ? botao : <span title={vista.titulo} className="inline-flex">{botao}</span>;
}

/**
 * O cartão já carregado, dentro da gaveta: cabeçalho, corpo e rodapé. Quem o carrega e guarda a edição é
 * `GavetaDoCartao`; aqui só se desenha, para a tela poder ser conferida em cada estado.
 */
export function MioloDoCartao(props: PropsDoMiolo) {
  const { cartao, agora, portao, pedido, edicao, fechar } = props;
  const apoio = apoioDoCartao(cartao, agora);
  const { estado } = cartao;
  const final = estado === "gravando" || estado === "aprovado" || estado === "gravado" || estado === "descartado" ? estado : null;
  const cliente = textoDoCliente(cartao.cliente);
  const contexto = { id: cartao.id, pedido, portao, salvarPode: edicao !== null && podeSalvar(cartao, edicao.valores) };
  const clicar = (acao: AcaoDoCartao) => {
    if (acao === "editar") props.aoEditar();
    else if (acao === "cancelar") props.aoCancelar();
    else if (acao === "salvar") props.aoSalvar();
    else if (acao === "fechar") fechar();
    else if (acao === "aprovar" || acao === "descartar" || acao === "tentar_de_novo" || acao === "ja_esta_no_crm") props.aoDecidir(acao);
  };
  return (
    <>
      <Cabecalho titulo={NOMES_DAS_ACOES_DE_ESCRITA[cartao.tool]}>
        <span className="max-w-full min-w-0 truncate text-sm text-muted-foreground" title={apoio}>
          {apoio}
        </span>
        {selosDoCartao(cartao).map((selo) => (
          <Selo key={selo} tom="atencao" texto={selo} />
        ))}
      </Cabecalho>
      <Corpo>
        {props.alerta && <AlertaDoPedido aviso={props.alerta} />}
        {props.erroDeCarga && <AlertaDeErro erro={props.erroDeCarga} />}
        {final !== null && <p className="text-sm leading-snug text-muted-foreground">{FRASES_DO_ESTADO_FINAL[final]}</p>}
        <Atencoes cartao={cartao} portao={portao} />
        <div className="flex flex-col gap-1.5">
          <Rotulo>Cliente</Rotulo>
          <Valor>
            <span className="font-medium">{cliente.nome}</span>
            {cliente.cidade !== null && <span className="text-muted-foreground"> · {cliente.cidade}</span>}
          </Valor>
        </div>
        <Campos cartao={cartao} edicao={edicao} aoMudarCampo={props.aoMudarCampo} desabilitado={pedido !== null} />
        {edicao?.erro && <AlertaDeErro erro={edicao.erro} />}
      </Corpo>
      <Rodape>
        {acoesDaGaveta(estado, edicao !== null).map((acao) => (
          <BotaoDoCartao key={acao} acao={acao} vista={vistaDoBotao(acao, contexto)} aoClicar={() => clicar(acao)} />
        ))}
      </Rodape>
    </>
  );
}

/** Carrega o cartão, guarda a edição e liga o miolo à fila. A gaveta fica aberta enquanto ele não sai do pedido. */
function CartaoNaGaveta({ id, mudancas, fila, fechar, segurar }: { id: string; mudancas: number; fila: FilaDeAprovacao; fechar: () => void; segurar: MutableRefObject<boolean> }) {
  const [edicao, setEdicao] = useState<EdicaoDaGaveta | null>(null);
  const [alerta, setAlerta] = useState<Aviso | null>(null);
  // O cartão que uma resposta trouxe (o salvo, ou `erro.atual` de um conflito) vale até chegar um mais novo.
  const [recebido, setRecebido] = useState<CartaoVisto | null>(null);
  // Com a edição aberta ou um pedido dela em curso, o `event: tarefas` não recarrega: o texto do vendedor não some.
  const congelada = edicao !== null || fila.pedido?.id === id;
  const gatilho = useRef(mudancas);
  if (!congelada) gatilho.current = mudancas;
  const carga = useCarga(`escrita:${id}`, () => api.verEscrita(id), gatilho.current);
  const cartao = recebido !== null && (carga.dados === null || recebido.versao >= carga.dados.versao) ? recebido : carga.dados;

  useEffect(() => {
    if (cartao !== null) fila.marcarAberto(cartao.id, cartao.versao, cartao.hash);
  }, [cartao?.id, cartao?.versao, cartao?.hash]);

  const comMudanca = cartao !== null && edicao !== null && podeSalvar(cartao, edicao.valores);
  useEffect(() => {
    segurar.current = comMudanca;
    return () => {
      segurar.current = false;
    };
  }, [comMudanca]);

  if (cartao === null) {
    return (
      <>
        <Cabecalho titulo="Cartão do agente" />
        <Corpo>
          {carga.erro ? (
            <AlertaDeErro erro={carga.erro} />
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Abrindo o cartão.
            </p>
          )}
        </Corpo>
        <Rodape>
          <BotaoDoCartao acao="fechar" vista={{ desabilitado: false, titulo: undefined, gravando: false }} aoClicar={fechar} />
        </Rodape>
      </>
    );
  }

  const salvar = async () => {
    if (edicao === null) return;
    setAlerta(null);
    const desfecho = await fila.editar(cartao, edicao.valores);
    if (desfecho === null) return;
    setAlerta(desfecho.avisoNaGaveta);
    if (desfecho.cartao !== null) setRecebido(desfecho.cartao);
    if (desfecho.erroNaGaveta !== null) setEdicao({ valores: edicao.valores, erro: desfecho.erroNaGaveta });
    else if (desfecho.fechaEdicao) setEdicao(null);
  };

  const decidir = async (acao: AcaoDeDecisao) => {
    setAlerta(null);
    const desfecho = await fila.decidir(cartao, acao, true);
    if (desfecho === null) return;
    setAlerta(desfecho.avisoNaGaveta);
    if (desfecho.cartao !== null) setRecebido(desfecho.cartao);
  };

  return (
    <MioloDoCartao
      cartao={cartao}
      alerta={alerta}
      agora={new Date()}
      portao={fila.portao}
      pedido={fila.pedido}
      edicao={edicao}
      erroDeCarga={carga.erro}
      aoEditar={() => setEdicao({ valores: valoresDaEdicao(cartao), erro: null })}
      aoCancelar={() => setEdicao(null)}
      aoSalvar={() => void salvar()}
      aoMudarCampo={(campo, texto) => setEdicao((atual) => (atual === null ? atual : { valores: { ...atual.valores, [campo]: texto }, erro: atual.erro }))}
      aoDecidir={(acao) => void decidir(acao)}
      fechar={fechar}
    />
  );
}

/**
 * A gaveta do cartão, no padrão das outras: flutua à direita, com véu; Esc e clique no véu fecham. Com texto
 * mudado na edição eles não fecham: só Cancelar e Salvar saem dela. Guarda o id do cartão, não o cartão: ela
 * segue aberta enquanto ele grava e sai do bloco Aprovar.
 */
export function GavetaDoCartao({ id, mudancas, fila, fechar }: { id: string | null; mudancas: number; fila: FilaDeAprovacao; fechar: () => void }) {
  const aberta = id !== null;
  const ultimo = useRef<string | null>(null);
  const estavaAberta = useRef(false);
  const origem = useRef<Element | null>(null);
  const segurar = useRef(false);
  // A gaveta abre por um botão da linha, sem `Dialog.Trigger`: quem tinha o foco ao abrir é quem o recebe ao fechar.
  if (aberta && !estavaAberta.current) origem.current = document.activeElement;
  estavaAberta.current = aberta;
  if (id !== null) ultimo.current = id;
  const mostrado = id ?? ultimo.current;

  const devolverFoco = (evento: Event) => {
    evento.preventDefault();
    const alvo = origem.current;
    if (alvo instanceof HTMLElement && alvo.isConnected && alvo !== document.body) alvo.focus({ preventScroll: true });
  };

  return (
    <Sheet open={aberta} onOpenChange={(abrir) => !abrir && fechar()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={focarNaAbertura}
        onCloseAutoFocus={devolverFoco}
        onEscapeKeyDown={(evento) => segurar.current && evento.preventDefault()}
        onInteractOutside={(evento) => segurar.current && evento.preventDefault()}
        className={CLASSE_DA_GAVETA}
      >
        {mostrado !== null && <CartaoNaGaveta key={mostrado} id={mostrado} mudancas={mudancas} fila={fila} fechar={fechar} segurar={segurar} />}
      </SheetContent>
    </Sheet>
  );
}
