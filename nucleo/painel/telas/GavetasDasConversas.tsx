import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CanalDeVinculo, ErroOperacao, ItemDeEsperando, ItemDeResponder, ItemDeResponderDoWhatsapp, MensagemParaOPainel } from "../../dominio";
import { chaveDoItem } from "../../dominio";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AlertaDeErro, Selo } from "../cartoes/Cartao";
import { CLASSE_DA_GAVETA, Cabecalho, Corpo, Rodape } from "../cartoes/GavetaDoEmail";
import {
  NOMES_DOS_SINAIS,
  avisoDasMarcas,
  formatarTelefone,
  lugarDoCandidato,
  maisAntigaPrimeiro,
  motivoDaDuvida,
  motivoDaDuvidaDoEmail,
  nomeDoRemetente,
  nomeNoWhatsapp,
  partesDoTexto,
  tituloDaConversa,
  type AlvoDeVinculo,
  type Escolha,
  type RespostaDaEscolha,
} from "../conversas";
import { momento } from "../tempo";
import { api } from "./comum";
import { LerEmail } from "./LerEmail";
import { TextoDaMensagem } from "./TextoMarcado";

/**
 * A gaveta aberta numa conversa: escolher o cliente, ler as mensagens em quarentena do WhatsApp ou ler o
 * e-mail. `chave` é a do item no canal: o telefone, ou o id `e-...` do item de e-mail.
 */
export type GavetaAberta = { readonly tipo: "escolher" | "quarentena" | "email"; readonly canal: CanalDeVinculo; readonly chave: string } | null;

type Ambigua = Extract<ItemDeResponder | ItemDeEsperando, { readonly vinculo: "ambiguo" }>;

/** A conversa de e-mail sem cliente só chega à gaveta com endereço: sem ele, a linha nem tem o botão. */
function alvoDaAmbigua(item: Ambigua): AlvoDeVinculo | null {
  if (item.canal === "whatsapp") return { canal: "whatsapp", chave: item.telefone };
  return item.endereco === null ? null : { canal: "email", chave: item.endereco };
}

/** Ao abrir, o foco vai à própria gaveta; o X é o primeiro Tab. Nenhum cartão nasce marcado. */
export function focarNaAbertura(evento: Event): void {
  evento.preventDefault();
  if (evento.currentTarget instanceof HTMLElement) evento.currentTarget.focus({ preventScroll: true });
}

export function EscolherCliente({ item, fechar, escolheu }: { item: Ambigua; fechar: () => void; escolheu: (alvo: AlvoDeVinculo, resposta: RespostaDaEscolha) => void }) {
  const grupo = useId();
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroOperacao | null>(null);
  // O clique duplo chega antes do render que desabilita o botão.
  const enviando = useRef(false);
  const alvo = alvoDaAmbigua(item);

  const enviar = async (escolha: Escolha) => {
    if (enviando.current || alvo === null) return;
    enviando.current = true;
    setOcupado(true);
    setErro(null);
    const resposta = await api.escolherCliente(alvo, escolha);
    enviando.current = false;
    setOcupado(false);
    if (!resposta.ok) return setErro(resposta.erro);
    escolheu(alvo, resposta.dados);
    fechar();
  };

  const doEmail = item.canal === "email";
  const titulo = item.canal === "whatsapp" ? formatarTelefone(item.telefone) : (item.endereco ?? "E-mail sem endereço");
  const motivo = item.canal === "whatsapp" ? motivoDaDuvida(item) : motivoDaDuvidaDoEmail(item);
  const nomeDoContato = item.canal === "whatsapp" ? nomeNoWhatsapp(item.nome_no_whatsapp) : nomeDoRemetente(item.nome_do_remetente);
  return (
    <>
      <Cabecalho titulo={titulo}>
        <p className="text-sm text-muted-foreground">Qual cliente é este?</p>
      </Cabecalho>
      <Corpo>
        <p className="text-sm leading-snug break-words">
          <span>{motivo}</span>
          {nomeDoContato !== null && <span className="text-muted-foreground"> {nomeDoContato}</span>}
        </p>
        <fieldset className="flex flex-col gap-2" disabled={ocupado}>
          <legend className="sr-only">{doEmail ? "Clientes do CRM com este endereço" : "Clientes do CRM com este número"}</legend>
          {item.candidatos.map((candidato) => {
            const lugar = lugarDoCandidato(candidato);
            const marcado = selecionado === candidato.id;
            return (
              <label
                key={candidato.id}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-accent has-focus-visible:bg-accent",
                  marcado ? "border-primary" : "border-border",
                )}
              >
                <input type="radio" name={grupo} value={candidato.id} checked={marcado} onChange={() => setSelecionado(candidato.id)} className="sr-only" />
                <span aria-hidden className={cn("size-3.5 shrink-0 rounded-full border-[1.5px]", marcado ? "border-primary bg-[radial-gradient(var(--primary)_45%,transparent_50%)]" : "border-input")} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium" title={candidato.nome}>
                    {candidato.nome}
                  </span>
                  {lugar !== null && <span className="truncate text-sm text-muted-foreground">{lugar}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        {erro && <AlertaDeErro erro={erro} />}
      </Corpo>
      <Rodape>
        <Button variant="outline" disabled={ocupado} onClick={() => void enviar({ naoCliente: true })}>
          Não é cliente
        </Button>
        <Button disabled={ocupado || selecionado === null} onClick={() => selecionado !== null && void enviar({ clienteId: selecionado })}>
          {ocupado && <LoaderCircle aria-hidden className="animate-spin" />}
          Confirmar
        </Button>
      </Rodape>
    </>
  );
}

type Lida = { readonly tipo: "ok"; readonly mensagem: MensagemParaOPainel } | { readonly tipo: "erro"; readonly erro: ErroOperacao };

/** Abre o texto de cada mensagem pela rota do painel. O texto fica só neste estado, e some quando a gaveta fecha. */
function useMensagens(conversa: string, ids: readonly string[]): { readonly prontas: boolean; readonly lidas: readonly Lida[] } {
  const [lidas, setLidas] = useState<ReadonlyMap<string, Lida>>(new Map());
  const chave = ids.join(",");

  useEffect(() => {
    let valendo = true;
    setLidas(new Map());
    for (const id of ids) {
      void api.mensagemEmQuarentena(conversa, id).then((resposta) => {
        if (!valendo) return;
        const lida: Lida = resposta.ok ? { tipo: "ok", mensagem: resposta.dados } : { tipo: "erro", erro: resposta.erro };
        setLidas((atuais) => new Map(atuais).set(id, lida));
      });
    }
    return () => {
      valendo = false;
    };
  }, [conversa, chave]);

  const chegadas = ids.flatMap((id) => lidas.get(id) ?? []);
  const mensagens = maisAntigaPrimeiro(chegadas.flatMap((lida) => (lida.tipo === "ok" ? [lida.mensagem] : [])));
  const erros = chegadas.flatMap((lida) => (lida.tipo === "erro" ? [lida] : []));
  return { prontas: chegadas.length === ids.length, lidas: [...mensagens.map((mensagem): Lida => ({ tipo: "ok", mensagem })), ...erros] };
}

export function UmaMensagem({ mensagem, agora }: { mensagem: MensagemParaOPainel; agora: Date }) {
  const aviso = avisoDasMarcas(partesDoTexto(mensagem.texto));
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">Mensagem de {momento(mensagem.em, agora)}</h3>
      {mensagem.sinais.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mensagem.sinais.map((sinal) => (
            <Selo key={sinal} tom="atencao" texto={NOMES_DOS_SINAIS[sinal]} />
          ))}
        </div>
      )}
      <TextoDaMensagem texto={mensagem.texto} />
      {aviso !== null && <p className="text-xs leading-snug text-muted-foreground">{aviso}</p>}
    </section>
  );
}

function Quarentena({ item, fechar }: { item: ItemDeResponderDoWhatsapp; fechar: () => void }) {
  const { prontas, lidas } = useMensagens(item.conversa, item.mensagens_em_quarentena);
  const agora = new Date();
  return (
    <>
      <Cabecalho titulo={tituloDaConversa(item)}>
        <p className="text-sm text-muted-foreground">Mensagem em quarentena</p>
      </Cabecalho>
      <Corpo>
        <p className="text-sm leading-snug text-muted-foreground">A Secretária escondeu este texto do agente. Você pode ler. Ele não.</p>
        {!prontas && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Abrindo o texto.
          </p>
        )}
        {prontas &&
          lidas.map((lida, indice) =>
            lida.tipo === "ok" ? <UmaMensagem key={lida.mensagem.id} mensagem={lida.mensagem} agora={agora} /> : <AlertaDeErro key={indice} erro={lida.erro} />,
          )}
      </Corpo>
      <Rodape>
        <Button onClick={fechar}>Fechar</Button>
      </Rodape>
    </>
  );
}

type ItemDaGaveta = ItemDeResponder | ItemDeEsperando;

/** O que a gaveta pedida mostra, ou `null` quando o item não tem mais o que ela pede. */
function conteudoPedido(gaveta: NonNullable<GavetaAberta>, item: ItemDaGaveta): Mostrada | null {
  if (gaveta.tipo === "escolher") return "vinculo" in item && item.vinculo === "ambiguo" ? { tipo: "escolher", item } : null;
  if (gaveta.tipo === "quarentena") return item.canal === "whatsapp" && "em_quarentena" in item && item.em_quarentena ? { tipo: "quarentena", item } : null;
  return item.canal === "email" ? { tipo: "email", item } : null;
}

type Mostrada =
  | { readonly tipo: "escolher"; readonly item: Ambigua }
  | { readonly tipo: "quarentena"; readonly item: ItemDeResponderDoWhatsapp }
  | { readonly tipo: "email"; readonly item: Extract<ItemDaGaveta, { readonly canal: "email" }> };

/**
 * As gavetas laterais das conversas, no padrão da do e-mail: flutuam à direita, com véu; Esc e clique
 * no véu fecham. Ficam abertas enquanto o item segue num bloco do jeito que a gaveta pede. `conversas`
 * traz os itens de Responder e de Esperando cliente, e o item se acha pelo canal e pela chave.
 */
export function GavetasDasConversas(props: {
  gaveta: GavetaAberta;
  conversas: readonly ItemDaGaveta[];
  fechar: () => void;
  escolheu: (alvo: AlvoDeVinculo, resposta: RespostaDaEscolha) => void;
}) {
  const { gaveta, fechar } = props;
  const item = gaveta === null ? undefined : props.conversas.find((conversa) => conversa.canal === gaveta.canal && chaveDoItem(conversa) === gaveta.chave);
  const pedido = gaveta !== null && item !== undefined ? conteudoPedido(gaveta, item) : null;
  const pedida = pedido !== null;
  const mostrada = useRef<Mostrada | null>(null);
  const origem = useRef<Element | null>(null);
  // A gaveta abre por um botão da linha, sem `Dialog.Trigger`: quem tinha o foco ao abrir é quem o recebe ao fechar.
  if (pedida && mostrada.current === null) origem.current = document.activeElement;
  if (pedido !== null) mostrada.current = pedido;
  const atual = mostrada.current;

  // O item que sai do Meu dia (escolhido, ignorado, respondido, conta desconectada) leva a gaveta junto, e ela não reabre sozinha.
  useEffect(() => {
    if (gaveta !== null && !pedida) fechar();
  }, [gaveta, pedida, fechar]);

  const devolverFoco = (evento: Event) => {
    evento.preventDefault();
    mostrada.current = null;
    const alvo = origem.current;
    if (alvo instanceof HTMLElement && alvo.isConnected && alvo !== document.body) alvo.focus({ preventScroll: true });
  };

  return (
    <Sheet open={pedida} onOpenChange={(abrir) => !abrir && fechar()}>
      <SheetContent side="right" showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={focarNaAbertura} onCloseAutoFocus={devolverFoco} className={CLASSE_DA_GAVETA}>
        {atual?.tipo === "escolher" && <EscolherCliente key={`${atual.item.canal}:${chaveDoItem(atual.item)}`} item={atual.item} fechar={fechar} escolheu={props.escolheu} />}
        {atual?.tipo === "quarentena" && <Quarentena key={atual.item.telefone} item={atual.item} fechar={fechar} />}
        {atual?.tipo === "email" && <LerEmail key={atual.item.id} item={atual.item} fechar={fechar} />}
      </SheetContent>
    </Sheet>
  );
}
