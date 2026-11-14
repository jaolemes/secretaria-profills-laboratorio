import { ChevronDown, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  JANELAS_DE_EMAIL,
  PREDEFINICOES_DE_EMAIL,
  PROVEDORES_DE_EMAIL,
  ROTULOS_DAS_ACOES,
  lerRotulo,
  type Acao,
  type ConfigEmail,
  type ErroOperacao,
  type IdContaEmail,
  type JanelaDias,
  type ProvedorEmail,
  type VisaoDaContaEmail,
} from "../../dominio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetClose, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { criarApiDoEmail, type CorpoDeAdicionarEmail, type PedidoDoEmail } from "../api";
import { descrever, ordemNoRodape } from "../descrever";
import {
  ENVIO_INICIAL,
  SELO_DA_CONTA,
  TEXTOS_DO_PROVEDOR,
  podeEnviar,
  problemaDaConta,
  reduzirEnvio,
  vistaDoEnvio,
} from "../email";
import { lerContaNova, lerReconexao, type CamposDaConta, type Erros } from "../formularios";
import { AlertaDeErro, Etiqueta, Prazo, Selo } from "./Cartao";

export const apiDoEmail = criarApiDoEmail();

const AJUDA_DO_GMAIL = PREDEFINICOES_DE_EMAIL.gmail?.ajuda ?? "https://myaccount.google.com/apppasswords";

/** A gaveta flutuante à direita, com margem de 12 px e véu atrás. Em tela estreita ocupa a tela toda. */
export const CLASSE_DA_GAVETA =
  "inset-0 h-auto w-full gap-0 overflow-hidden border-0 bg-card p-0 outline-none sm:inset-y-3 sm:right-3 sm:left-auto sm:w-[min(440px,calc(100%-24px))] sm:max-w-none sm:rounded-2xl sm:border";

/** Primeira linha: o título e o X, alinhados. Segunda linha, quando há: etiqueta e selo. */
export function Cabecalho({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b px-5 py-4">
      <div className="flex items-center gap-3">
        <SheetTitle className="min-w-0 flex-1 truncate text-base font-semibold">{titulo}</SheetTitle>
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" className="-mr-2 shrink-0" aria-label="Fechar" title="Fechar">
            <X aria-hidden />
          </Button>
        </SheetClose>
      </div>
      {children && <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Corpo({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">{children}</div>;
}

export function Rodape({ children }: { children: ReactNode }) {
  return <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-4">{children}</footer>;
}

export const ROTULO_DE_SECAO = "text-xs font-medium text-muted-foreground";

function Campo(props: { id: string; rotulo: string; ajuda?: string; erro?: string; className?: string; children: (aria: object) => ReactNode }) {
  const descritores = [props.ajuda && `${props.id}-ajuda`, props.erro && `${props.id}-erro`].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1.5", props.className)}>
      <Label htmlFor={props.id}>{props.rotulo}</Label>
      {props.children({ id: props.id, "aria-invalid": props.erro !== undefined, "aria-describedby": descritores || undefined })}
      {props.ajuda && (
        <p id={`${props.id}-ajuda`} className="text-xs leading-snug text-muted-foreground">
          {props.ajuda}
        </p>
      )}
      {props.erro && (
        <p id={`${props.id}-erro`} className="text-sm text-destructive">
          {props.erro}
        </p>
      )}
    </div>
  );
}

/** Escolha curta em trilho (dias, segurança), feita de rádios para o teclado andar com as setas. */
function Trilho<T extends string | number>(props: {
  legenda: string;
  opcoes: readonly { readonly valor: T; readonly rotulo: string }[];
  valor: T;
  mudar: (valor: T) => void;
  desabilitado?: boolean;
  ajuda?: string;
}) {
  const nome = useId();
  return (
    <fieldset disabled={props.desabilitado} className="flex min-w-0 flex-col gap-2 disabled:opacity-60">
      <legend className={cn(ROTULO_DE_SECAO, "mb-2")}>{props.legenda}</legend>
      <div className="inline-flex w-fit gap-0.5 rounded-[11px] bg-trilho p-[3px]">
        {props.opcoes.map(({ valor, rotulo }) => (
          <label
            key={String(valor)}
            className="relative inline-flex h-11 cursor-pointer items-center rounded-md px-4 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent/60 has-checked:bg-accent has-checked:font-medium has-checked:text-foreground has-focus-visible:bg-accent/60 md:h-7 md:px-3"
          >
            <input type="radio" name={nome} value={String(valor)} checked={props.valor === valor} onChange={() => props.mudar(valor)} className="sr-only" />
            {rotulo}
          </label>
        ))}
      </div>
      {props.ajuda && <p className="text-xs leading-snug text-muted-foreground">{props.ajuda}</p>}
    </fieldset>
  );
}

const OPCOES_DA_JANELA = JANELAS_DE_EMAIL.map((dias) => ({ valor: dias, rotulo: `${dias} dias` }));
const OPCOES_DA_SEGURANCA: readonly { readonly valor: ConfigEmail["seguranca"]; readonly rotulo: string }[] = [
  { valor: "tls", rotulo: "TLS" },
  { valor: "starttls", rotulo: "STARTTLS" },
];
const LEGENDA_DA_JANELA = "Quanto tempo para trás a Secretária olha";

type CamposDoServidor = Pick<CamposDaConta, "servidor" | "porta" | "seguranca">;

function CamposDoServidor(props: { campos: CamposDoServidor; mudar: (campos: Partial<CamposDoServidor>) => void; erros: Erros }) {
  const base = useId();
  return (
    <div className="grid grid-cols-6 gap-x-3 gap-y-4">
      <Campo
        id={`${base}-servidor`}
        rotulo="Servidor de entrada"
        ajuda="Está nas configurações do seu e-mail, como servidor IMAP ou de entrada."
        erro={props.erros.servidor}
        className="col-span-6 sm:col-span-4"
      >
        {(aria) => (
          <Input
            {...aria}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="imap.empresa.com.br"
            value={props.campos.servidor}
            onChange={(evento) => props.mudar({ servidor: evento.target.value })}
          />
        )}
      </Campo>
      <Campo id={`${base}-porta`} rotulo="Porta" erro={props.erros.porta} className="col-span-6 sm:col-span-2">
        {(aria) => <Input {...aria} inputMode="numeric" autoComplete="off" placeholder="993" value={props.campos.porta} onChange={(evento) => props.mudar({ porta: evento.target.value })} />}
      </Campo>
      <div className="col-span-6">
        <Trilho
          legenda="Segurança"
          opcoes={OPCOES_DA_SEGURANCA}
          valor={props.campos.seguranca}
          mudar={(seguranca) => props.mudar({ seguranca })}
          ajuda="Normalmente TLS com a porta 993, ou STARTTLS com a porta 143."
        />
      </div>
    </div>
  );
}

function OpcoesAvancadas({ abertas, alternar, children }: { abertas: boolean; alternar: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="outline" className="self-start" aria-expanded={abertas} aria-controls={id} onClick={alternar}>
        Opções avançadas
        <ChevronDown aria-hidden className={cn("transition-transform", abertas && "rotate-180")} />
      </Button>
      {abertas && <div id={id}>{children}</div>}
    </div>
  );
}

/** O problema da conta no topo do corpo: a frase, o próximo passo e o link de ajuda do provedor. */
function AvisoDoProblema({ conta, alerta = false }: { conta: VisaoDaContaEmail; alerta?: boolean }) {
  const problema = problemaDaConta(conta);
  if (problema === null) return null;
  return (
    <div role={alerta ? "alert" : undefined} className="flex flex-col gap-2 rounded-lg border border-destaque/35 bg-destaque/10 px-3 py-2.5 text-sm leading-snug">
      <p className="font-medium text-destaque">{problema.mensagem}</p>
      <p className="text-foreground">{problema.acao}</p>
      {problema.ajuda && (
        <Button variant="outline" size="sm" className="self-start" asChild>
          <a href={problema.ajuda} target="_blank" rel="noopener noreferrer">
            Criar senha de app
            <ExternalLink aria-hidden />
            <span className="sr-only"> (abre o Google numa aba nova)</span>
          </a>
        </Button>
      )}
    </div>
  );
}

function Andamento({ conta, agora }: { conta: VisaoDaContaEmail | undefined; agora: Date }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg bg-accent px-3 py-2.5 text-sm leading-snug">
      <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium">Testando o login com o servidor de e-mail.</p>
        {conta?.estado.fase === "testando" ? (
          <Prazo expiraEm={conta.estado.expiraEm} agora={agora} rotulo="Tempo máximo:" />
        ) : (
          <p className="text-muted-foreground">Isso leva alguns segundos.</p>
        )}
      </div>
    </div>
  );
}

/** Rodapé do detalhe: Remover sempre; das ações do estado, cada uma no seu lugar, com Conectar por último. */
function BotaoDaConta({ acao, desabilitado, formulario, agir }: { acao: Acao; desabilitado: boolean; formulario: string; agir: (pedido: PedidoDoEmail) => void }) {
  if (acao === "conectar") {
    return (
      <Button type="submit" form={formulario} disabled={desabilitado}>
        {ROTULOS_DAS_ACOES.conectar}
      </Button>
    );
  }
  if (acao !== "testar" && acao !== "cancelar" && acao !== "desconectar") return null;
  return (
    <Button variant="outline" disabled={desabilitado} onClick={() => agir({ acao, corpo: undefined })}>
      {acao === "cancelar" ? "Cancelar o teste" : ROTULOS_DAS_ACOES[acao]}
    </Button>
  );
}

function camposDoServidorDe(config: ConfigEmail): CamposDoServidor {
  return { servidor: config.servidor, porta: String(config.porta), seguranca: config.seguranca };
}

/** O nome da conta, salvo à parte do resto. Recomeça quando o rótulo muda pelo SSE. */
function SecaoDoRotulo({ conta, contas, livre, salvar }: { conta: VisaoDaContaEmail; contas: readonly VisaoDaContaEmail[]; livre: boolean; salvar: (rotulo: string) => Promise<boolean> }) {
  const id = useId();
  const [texto, setTexto] = useState(conta.rotulo);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const rotulo = lerRotulo(texto);
    if (rotulo === null) return setErro("Dê um nome curto para esta conta, como Profills ou Pessoal.");
    if (contas.some((outra) => outra.id !== conta.id && outra.rotulo.toLowerCase() === rotulo.toLowerCase())) return setErro("Já existe uma conta com esse nome.");
    setErro(null);
    if (rotulo === conta.rotulo) return;
    setSalvando(true);
    await salvar(rotulo);
    setSalvando(false);
  };

  return (
    <form onSubmit={(evento) => void enviar(evento)} noValidate className="flex flex-col gap-2">
      <Label htmlFor={id} className={ROTULO_DE_SECAO}>
        Como chamar esta conta
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={texto}
          maxLength={30}
          aria-invalid={erro !== null}
          aria-describedby={erro ? `${id}-erro` : undefined}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!livre || salvando}>
          Salvar
        </Button>
      </div>
      {erro && (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </form>
  );
}

export function DetalheDaConta(props: { conta: VisaoDaContaEmail; contas: readonly VisaoDaContaEmail[]; agora: Date; livre: boolean; fechar: () => void }) {
  const { conta, agora } = props;
  const idDoFormulario = useId();
  const senha = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroOperacao | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [avancadas, setAvancadas] = useState(false);
  const [servidor, setServidor] = useState(() => camposDoServidorDe(conta.config));
  const [errosDaSenha, setErrosDaSenha] = useState<Erros>({});
  const livre = props.livre && !ocupado;
  const selo = SELO_DA_CONTA[conta.estado.fase];
  const podeConectar = conta.acoes.includes("conectar");
  const situacao = descrever("email", conta.estado, agora);

  const agir = async (pedido: PedidoDoEmail): Promise<boolean> => {
    setOcupado(true);
    setErro(null);
    const resposta = await apiDoEmail.agir(conta.id, pedido);
    setOcupado(false);
    if (!resposta.ok) setErro(resposta.erro);
    return resposta.ok;
  };

  const reconectar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const campo = senha.current;
    const leitura = lerReconexao({ ...servidor, avancadas }, campo?.value ?? "");
    if (!leitura.ok) return setErrosDaSenha(leitura.erros);
    setErrosDaSenha({});
    if (campo) campo.value = "";
    void agir({ acao: "conectar", corpo: leitura.corpo });
  };

  const remover = async () => {
    if (await agir({ acao: "remover", corpo: undefined })) props.fechar();
  };

  const textos = TEXTOS_DO_PROVEDOR[conta.provedor];

  return (
    <>
      <Cabecalho titulo={conta.config.endereco}>
        <Etiqueta>{conta.rotulo}</Etiqueta>
        <Selo tom={selo.tom} texto={selo.texto} />
      </Cabecalho>
      <Corpo>
        <AvisoDoProblema conta={conta} />
        {conta.estado.fase === "testando" && <Andamento conta={conta} agora={agora} />}
        {conta.estado.fase === "conectado" && (
          <div className="flex flex-col gap-0.5 text-sm text-muted-foreground tabular-nums">
            {situacao.detalhes.map((detalhe) => (
              <p key={detalhe}>{detalhe}</p>
            ))}
          </div>
        )}
        {podeConectar && (
          <form id={idDoFormulario} onSubmit={reconectar} noValidate className="flex flex-col gap-4">
            <Campo id={`${idDoFormulario}-senha`} rotulo={textos.nomeDaSenha} erro={errosDaSenha.senha} ajuda="Digite a senha para conectar de novo. Ela não fica nesta página.">
              {(aria) => <Input {...aria} ref={senha} type="password" autoComplete="current-password" data-foco-inicial />}
            </Campo>
            <OpcoesAvancadas abertas={avancadas} alternar={() => setAvancadas((atual) => !atual)}>
              <CamposDoServidor campos={servidor} mudar={(mudanca) => setServidor((atual) => ({ ...atual, ...mudanca }))} erros={errosDaSenha} />
            </OpcoesAvancadas>
          </form>
        )}
        <SecaoDoRotulo
          key={conta.rotulo}
          conta={conta}
          contas={props.contas}
          livre={livre}
          salvar={(rotulo) => agir({ acao: "mudar", corpo: { rotulo } })}
        />
        <Trilho
          legenda={LEGENDA_DA_JANELA}
          opcoes={OPCOES_DA_JANELA}
          valor={conta.janelaDias}
          desabilitado={!livre}
          mudar={(janelaDias) => void agir({ acao: "mudar", corpo: { janelaDias } })}
        />
        {erro && <AlertaDeErro erro={erro} />}
      </Corpo>
      <Rodape>
        {confirmarRemocao ? (
          <>
            <p role="alert" className="basis-full text-sm leading-snug">
              Remover a conta {conta.rotulo}? A senha sai desta máquina.
            </p>
            <Button variant="outline" onClick={() => setConfirmarRemocao(false)}>
              Não
            </Button>
            <Button variant="destructive" disabled={!livre} onClick={() => void remover()}>
              Sim, remover
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={!livre} onClick={() => setConfirmarRemocao(true)}>
              Remover
            </Button>
            {ordemNoRodape(conta.acoes).map((acao) => (
              <BotaoDaConta key={acao} acao={acao} desabilitado={!livre} formulario={idDoFormulario} agir={(pedido) => void agir(pedido)} />
            ))}
          </>
        )}
      </Rodape>
    </>
  );
}

export function EscolhaDoProvedor({ escolher }: { escolher: (provedor: ProvedorEmail) => void }) {
  return (
    <>
      <Cabecalho titulo="Conectar um e-mail" />
      <Corpo>
        <p className="text-[15px] leading-snug font-medium">Qual e-mail você quer conectar?</p>
        <ul className="flex flex-col gap-2">
          {PROVEDORES_DE_EMAIL.map((provedor) => (
            <li key={provedor}>
              <button
                type="button"
                onClick={() => escolher(provedor)}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-input px-4 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-[15px] font-semibold">{TEXTOS_DO_PROVEDOR[provedor].nome}</span>
                <span className="text-sm text-muted-foreground">{TEXTOS_DO_PROVEDOR[provedor].resumo}</span>
              </button>
            </li>
          ))}
        </ul>
      </Corpo>
      <Rodape>
        <SheetClose asChild>
          <Button variant="outline">Cancelar</Button>
        </SheetClose>
      </Rodape>
    </>
  );
}

function PassosDoGmail() {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 rounded-lg bg-muted px-3 py-3 pl-8 text-sm leading-snug text-muted-foreground">
      <li>
        Abra as{" "}
        <a href={AJUDA_DO_GMAIL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
          senhas de app do Google
          <span className="sr-only"> (abre numa aba nova)</span>
        </a>
        .
      </li>
      <li>Se o Google pedir, ligue a verificação em duas etapas.</li>
      <li>Crie uma senha com o nome Secretária e copie as 16 letras.</li>
      <li>Cole a senha abaixo, no campo Senha de app.</li>
    </ol>
  );
}

function camposIniciais(provedor: ProvedorEmail): CamposDaConta {
  const predefinicao = PREDEFINICOES_DE_EMAIL[provedor];
  return {
    endereco: "",
    rotulo: TEXTOS_DO_PROVEDOR[provedor].rotuloSugerido,
    servidor: predefinicao?.servidor ?? "",
    porta: predefinicao === null ? "" : String(predefinicao.porta),
    seguranca: predefinicao?.seguranca ?? "tls",
    janelaDias: 30,
    avancadas: false,
  };
}

const novoId = () => crypto.randomUUID() as IdContaEmail;

/**
 * Formulário da conta nova. O `id` nasce aqui e vai em toda tentativa: o clique duplo e a nova
 * tentativa depois de um login recusado caem na mesma conta. A senha fica só no campo: é lida no
 * envio, vai no corpo do POST e o campo é limpo em seguida.
 */
export function FormularioDaConta(props: {
  provedor: ProvedorEmail;
  contas: readonly VisaoDaContaEmail[];
  agora: Date;
  livre: boolean;
  voltar: () => void;
  conectou: (id: IdContaEmail) => void;
}) {
  const { provedor, conectou } = props;
  const base = useId();
  const senha = useRef<HTMLInputElement>(null);
  // O clique duplo chega antes do render que desabilita o botão: a trava vale já no segundo clique.
  const enviando = useRef(false);
  const [id, setId] = useState(novoId);
  const [campos, setCampos] = useState(() => camposIniciais(provedor));
  const [erros, setErros] = useState<Erros>({});
  const [envio, despachar] = useReducer(reduzirEnvio, ENVIO_INICIAL);
  const conta = props.contas.find((candidata) => candidata.id === id);
  const vista = vistaDoEnvio(envio, conta);
  const textos = TEXTOS_DO_PROVEDOR[provedor];
  const mudar = (mudanca: Partial<CamposDaConta>) => setCampos((atuais) => ({ ...atuais, ...mudanca }));

  useEffect(() => {
    if (vista.tipo === "conectou") conectou(id);
  }, [vista.tipo, id, conectou]);

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (enviando.current || !podeEnviar(vista) || !props.livre) return;
    const campo = senha.current;
    const leitura = lerContaNova(provedor, id, campos, campo?.value ?? "");
    if (!leitura.ok) return setErros(leitura.erros);
    setErros({});
    if (campo) campo.value = "";
    enviando.current = true;
    despachar({ tipo: "enviar", conta });
    try {
      await enviarConta(leitura.corpo);
    } finally {
      enviando.current = false;
    }
  };

  const enviarConta = async (lido: CorpoDeAdicionarEmail) => {
    let corpo = lido;
    if (conta !== undefined) {
      // A conta desta tentativa já existe. Outro endereço é outra conta; rótulo e dias mudam por `mudar`.
      if (conta.config.endereco.toLowerCase() !== corpo.endereco.toLowerCase()) {
        const removida = await apiDoEmail.agir(conta.id, { acao: "remover", corpo: undefined });
        if (!removida.ok) return despachar({ tipo: "recusado", erro: removida.erro });
        const outro = novoId();
        setId(outro);
        corpo = { ...corpo, id: outro };
      } else if (conta.rotulo !== corpo.rotulo || conta.janelaDias !== corpo.janelaDias) {
        const mudou = await apiDoEmail.agir(conta.id, { acao: "mudar", corpo: { rotulo: corpo.rotulo, janelaDias: corpo.janelaDias ?? 30 } });
        if (!mudou.ok) return despachar({ tipo: "recusado", erro: mudou.erro });
      }
    }
    const resposta = await apiDoEmail.adicionar(corpo);
    despachar(resposta.ok ? { tipo: "aceito" } : { tipo: "recusado", erro: resposta.erro });
  };

  const emCurso = vista.tipo === "enviando" || vista.tipo === "testando";
  const comServidor = provedor === "outro";

  return (
    <>
      <Cabecalho titulo={textos.nome} />
      <Corpo>
        {vista.tipo === "editando" && vista.problema && <AvisoDoProblema conta={vista.problema} alerta />}
        {vista.tipo === "editando" && vista.erro && <AlertaDeErro erro={vista.erro} />}
        {emCurso && <Andamento conta={conta} agora={props.agora} />}
        {provedor === "gmail" && <PassosDoGmail />}
        <form id={base} onSubmit={(evento) => void enviar(evento)} noValidate>
          <fieldset disabled={emCurso} className="flex flex-col gap-4 disabled:opacity-60">
            <Campo id={`${base}-endereco`} rotulo="E-mail" erro={erros.endereco}>
              {(aria) => (
                <Input
                  {...aria}
                  type="email"
                  autoComplete="email"
                  data-foco-inicial
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={textos.exemplo}
                  value={campos.endereco}
                  onChange={(evento) => mudar({ endereco: evento.target.value })}
                />
              )}
            </Campo>
            {comServidor && <CamposDoServidor campos={campos} mudar={mudar} erros={erros} />}
            <Campo id={`${base}-senha`} rotulo={textos.nomeDaSenha} erro={erros.senha} ajuda="Não fica guardada nesta página.">
              {(aria) => <Input {...aria} ref={senha} type="password" autoComplete="current-password" />}
            </Campo>
            <Campo id={`${base}-rotulo`} rotulo="Como chamar esta conta" erro={erros.rotulo}>
              {(aria) => <Input {...aria} maxLength={30} placeholder="Profills, Pessoal" value={campos.rotulo} onChange={(evento) => mudar({ rotulo: evento.target.value })} />}
            </Campo>
            <Trilho legenda={LEGENDA_DA_JANELA} opcoes={OPCOES_DA_JANELA} valor={campos.janelaDias} mudar={(janelaDias: JanelaDias) => mudar({ janelaDias })} />
            {provedor === "profills" && (
              <OpcoesAvancadas abertas={campos.avancadas} alternar={() => mudar({ avancadas: !campos.avancadas })}>
                <CamposDoServidor campos={campos} mudar={mudar} erros={erros} />
              </OpcoesAvancadas>
            )}
          </fieldset>
        </form>
      </Corpo>
      <Rodape>
        {emCurso && conta?.estado.fase === "testando" ? (
          <Button variant="outline" onClick={() => void apiDoEmail.agir(conta.id, { acao: "cancelar", corpo: undefined })}>
            Cancelar o teste
          </Button>
        ) : (
          <Button variant="outline" disabled={emCurso} onClick={props.voltar}>
            Voltar
          </Button>
        )}
        <Button type="submit" form={base} disabled={!props.livre || !podeEnviar(vista)}>
          {emCurso && <LoaderCircle aria-hidden className="animate-spin" />}
          {ROTULOS_DAS_ACOES.conectar}
        </Button>
      </Rodape>
    </>
  );
}
