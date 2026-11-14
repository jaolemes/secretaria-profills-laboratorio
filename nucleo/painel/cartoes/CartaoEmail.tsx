import { ChevronRight, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LIMITE_DE_CONTAS_DE_EMAIL, type ErroOperacao, type IdContaEmail, type VisaoDaContaEmail, type VisaoDoEmail } from "../../dominio";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NOMES_DOS_CONECTORES } from "../descrever";
import { SELO_DA_CONTA, contagemDasContas, podeAdicionar, situacaoDoCartao } from "../email";
import { hashDaRota, type GavetaDoEmail as GavetaDaRota } from "../rota";
import { AlertaDeErro, Etiqueta, MolduraDoCartao, Selo } from "./Cartao";
import { CLASSE_DA_GAVETA, DetalheDaConta, EscolhaDoProvedor, FormularioDaConta, apiDoEmail } from "./GavetaDoEmail";

const NOVA: GavetaDaRota = { tipo: "nova", provedor: null };

function LinhaDaConta({ conta, marcada, abrir }: { conta: VisaoDaContaEmail; marcada: boolean; abrir: () => void }) {
  const selo = SELO_DA_CONTA[conta.estado.fase];
  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={abrir}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 px-5 py-2.5 text-left text-sm transition-colors hover:bg-accent",
          marcada && "bg-accent",
        )}
      >
        <Etiqueta>{conta.rotulo}</Etiqueta>
        <span className="min-w-0 flex-1 truncate">{conta.config.endereco}</span>
        <Selo tom={selo.tom} texto={selo.texto} />
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

export function CartaoEmail({ email, livre, aberta, abrir }: { email: VisaoDoEmail; livre: boolean; aberta: IdContaEmail | null; abrir: (gaveta: GavetaDaRota) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroOperacao | null>(null);
  const situacao = situacaoDoCartao(email);
  const contagem = contagemDasContas(email.contas);

  const pular = async () => {
    setOcupado(true);
    const resposta = await apiDoEmail.pular(true);
    setOcupado(false);
    setErro(resposta.ok ? null : resposta.erro);
  };

  const rodape =
    situacao === "sem_conta" ? (
      <>
        <Button variant="outline" disabled={!livre || ocupado} onClick={() => void pular()}>
          Pular por enquanto
        </Button>
        <Button disabled={!livre} aria-haspopup="dialog" onClick={() => abrir(NOVA)}>
          Conectar um e-mail
        </Button>
      </>
    ) : situacao === "pulado" ? (
      <Button variant="outline" disabled={!livre} aria-haspopup="dialog" onClick={() => abrir(NOVA)}>
        Conectar depois
      </Button>
    ) : podeAdicionar(email) ? (
      <Button variant="outline" disabled={!livre} aria-haspopup="dialog" onClick={() => abrir(NOVA)}>
        Adicionar outra conta
      </Button>
    ) : (
      <p className="text-sm text-muted-foreground">Limite de {LIMITE_DE_CONTAS_DE_EMAIL} contas.</p>
    );

  return (
    <MolduraDoCartao
      nome={NOMES_DOS_CONECTORES.email}
      Icone={Mail}
      selos={
        <>
          <Selo tom="neutro" texto="Opcional" />
          {contagem && <Selo tom={contagem.tom} texto={contagem.texto} />}
        </>
      }
      rodape={rodape}
    >
      {situacao === "sem_conta" && (
        <div className="space-y-1.5">
          <p className="text-[15px] leading-snug font-medium text-pretty">Quer que a Secretária veja também o seu e-mail?</p>
          <p className="text-sm leading-snug text-muted-foreground">É opcional. Você pode conectar depois, e pode ter mais de uma conta.</p>
        </div>
      )}
      {situacao === "pulado" && <p className="text-sm leading-snug text-muted-foreground">E-mail pulado. A Secretária segue com o WhatsApp e o CRM.</p>}
      {situacao === "com_contas" && (
        <ul aria-label="Contas de e-mail" className="-mx-5 divide-y border-y">
          {email.contas.map((conta) => (
            <LinhaDaConta key={conta.id} conta={conta} marcada={conta.id === aberta} abrir={() => abrir({ tipo: "conta", id: conta.id })} />
          ))}
        </ul>
      )}
      {erro && <AlertaDeErro erro={erro} />}
    </MolduraDoCartao>
  );
}

/** Ao abrir, o foco vai ao primeiro campo do formulário, ou à própria gaveta; o X é o primeiro Tab. */
function focarNaAbertura(evento: Event): void {
  evento.preventDefault();
  const gaveta = evento.currentTarget;
  if (!(gaveta instanceof HTMLElement)) return;
  const campo = gaveta.querySelector<HTMLInputElement>("[data-foco-inicial]");
  (campo ?? gaveta).focus({ preventScroll: true });
}

const chaveDaGaveta = (gaveta: GavetaDaRota | undefined) => (gaveta === undefined ? "" : hashDaRota({ tela: "conexoes", gaveta }));

/**
 * A gaveta lateral do e-mail. Ela segue o hash; ao fechar, mostra o último conteúdo até a animação
 * de saída acabar. Conta que sumiu da lista (removida) fecha a gaveta.
 */
export function GavetaDoEmail(props: {
  gaveta: GavetaDaRota | undefined;
  email: VisaoDoEmail;
  agora: Date;
  livre: boolean;
  ir: (gaveta: GavetaDaRota) => void;
  fechar: () => void;
}) {
  const { gaveta, email, fechar } = props;
  const conta = gaveta?.tipo === "conta" ? email.contas.find((candidata) => candidata.id === gaveta.id) : undefined;
  const aberta = gaveta?.tipo === "nova" || conta !== undefined;
  const mostrada = useRef<{ gaveta: GavetaDaRota; conta: VisaoDaContaEmail | undefined } | null>(null);
  const origem = useRef<Element | null>(null);
  // A gaveta abre pelo hash, sem `Dialog.Trigger`: quem tinha o foco ao abrir é quem o recebe ao fechar.
  if (aberta && mostrada.current === null) origem.current = document.activeElement;
  mostrada.current = aberta ? { gaveta: gaveta!, conta } : mostrada.current;
  const atual = mostrada.current;

  const devolverFoco = (evento: Event) => {
    evento.preventDefault();
    mostrada.current = null;
    const valida = origem.current?.isConnected && origem.current !== document.body;
    const alvo = valida ? origem.current : document.querySelector(`[aria-labelledby="cartao-${NOMES_DOS_CONECTORES.email}"] footer button`);
    if (alvo instanceof HTMLElement) alvo.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (gaveta?.tipo === "conta" && conta === undefined) fechar();
  }, [gaveta, conta, fechar]);

  return (
    <Sheet open={aberta} onOpenChange={(abrir) => !abrir && fechar()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={focarNaAbertura}
        onCloseAutoFocus={devolverFoco}
        className={CLASSE_DA_GAVETA}
      >
        {atual?.gaveta.tipo === "conta" && atual.conta && (
          <DetalheDaConta key={atual.conta.id} conta={atual.conta} contas={email.contas} agora={props.agora} livre={props.livre} fechar={fechar} />
        )}
        {atual?.gaveta.tipo === "nova" && atual.gaveta.provedor === null && <EscolhaDoProvedor escolher={(provedor) => props.ir({ tipo: "nova", provedor })} />}
        {atual?.gaveta.tipo === "nova" && atual.gaveta.provedor !== null && (
          <FormularioDaConta
            key={chaveDaGaveta(atual.gaveta)}
            provedor={atual.gaveta.provedor}
            contas={email.contas}
            agora={props.agora}
            livre={props.livre}
            voltar={() => props.ir(NOVA)}
            conectou={(id) => props.ir({ tipo: "conta", id })}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
