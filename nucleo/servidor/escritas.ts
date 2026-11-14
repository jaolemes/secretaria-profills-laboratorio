import {
  clienteJaTemEscritaAprovada,
  decisoesDoCartao,
  inserirCartao,
  lerCartao,
  listarCartoes,
  listarVinculos,
  mudarCartao,
  mudarCartaoEmSequencia,
  type BancoAberto,
} from "../banco";
import type { Conectores } from "../conectores";
import { falha, ok, type ErroOperacao, type Instante, type Resultado } from "../dominio";
import {
  ESTADOS_DA_ESCRITA,
  TOOLS_DE_ESCRITA,
  cartaoVisto,
  clienteIdDaEscrita,
  confiraOCliente,
  corpoDeDecidir,
  corpoDeEditar,
  corpoDePropor,
  escolherParaAprovar,
  filtroDeEstado,
  hashDaEscrita,
  lerEscrita,
  lerPorSchema,
  novoCartao,
  resumoDaEscrita,
  type CartaoDaEscrita,
  type CartaoVisto,
  type ClienteDoCartao,
  type ComandoDaEscrita,
  type DesfechoDaGravacao,
  type LeitorDaEscrita,
  type ResumoDaEscrita,
} from "../escritas";
import type { Publicador } from "./eventos";
import { lerCorpo, type Chamador } from "./guarda";
import { respostaJson, type Rota } from "./rotas";

export interface DependenciasDasEscritas {
  readonly banco: BancoAberto;
  /** Só o que as rotas usam: o teste troca `gravarNoCrm` por uma função dele. */
  readonly conectores: Pick<Conectores, "conferirCliente" | "estado" | "gravarNoCrm">;
  readonly publicador: Publicador;
  agora(): Instante;
}

const leitorDe = (chamador: Chamador): LeitorDaEscrita => (chamador === "agente" ? "agente" : "painel");
/** A regra pura confere de novo quem pede, também em `aprovar` e `tentar_de_novo`: a guarda da rota não é a única trava. */
const quemDecide = (chamador: Chamador): "agente" | "painel" => (chamador === "agente" ? "agente" : "painel");

/** O bloco `aprovar` do Meu dia: os cartões que esperam o vendedor, no resumo de quem lê. */
export function blocoAprovar(banco: BancoAberto, chamador: Chamador): ResumoDaEscrita[] {
  const leitor = leitorDe(chamador);
  return escolherParaAprovar(listarCartoes(banco)).map((cartao) => resumoDaEscrita(cartao, leitor));
}

const SO_O_VENDEDOR =
  "Aprovar, editar, descartar e decidir um cartão que falhou são do vendedor, no painel. Avise o vendedor de que o cartão espera por ele no painel; você só propõe, lista, vê e retira o seu rascunho.";
const SO_O_AGENTE = "Propor e retirar um cartão são do agente, pelo CLI.";

const ACOES = ["editar", "descartar", "aprovar", "retirar", "ja_esta_no_crm", "tentar_de_novo"] as const;
type Acao = (typeof ACOES)[number];

const FORMA_DO_FILTRO = `O filtro \`estado\` aceita ${ESTADOS_DA_ESCRITA.join(", ")}.`;
const FORMA_DE_PROPOR = `Mande { "id": <uuid, opcional>, "tool": ${TOOLS_DE_ESCRITA.join(" | ")}, "dados": { ... } }.`;

/**
 * No boot, o cartão que ficou em `gravando` é de um servidor que parou no meio da chamada: o CRM pode ter gravado ou não.
 * Vira `falhou_incerto` com `escrita_interrompida`, sem detalhe e sem chamar o CRM. Rodar de novo não muda mais nada.
 */
export function encerrarGravacoesInterrompidas(banco: BancoAberto, agora: Instante): number {
  let encerrados = 0;
  for (const cartao of listarCartoes(banco, "gravando")) {
    const feito = mudarCartao(banco, cartao.id, { acao: "ficou_incerto", erro: { codigo: "escrita_interrompida", detalhe: null } }, "servidor", agora);
    if (feito.ok) encerrados += 1;
  }
  return encerrados;
}

export function montarRotasDeEscritas(deps: DependenciasDasEscritas): readonly Rota[] {
  const { banco, conectores, publicador } = deps;

  function ver(cartao: CartaoDaEscrita, chamador: Chamador): CartaoVisto {
    return cartaoVisto(cartao, decisoesDoCartao(banco, cartao.id), leitorDe(chamador));
  }

  /** O cartão que vai dentro de `erro.atual` passa pela mesma visão: o agente nunca recebe o texto em quarentena por aqui. */
  function comAtualVisto<T>(resultado: Resultado<T>, chamador: Chamador): Resultado<T> {
    if (resultado.ok || resultado.erro.atual === undefined) return resultado;
    const erro: ErroOperacao = { ...resultado.erro, atual: ver(resultado.erro.atual as CartaoDaEscrita, chamador) };
    return { ok: false, erro };
  }

  const responder = <T>(resultado: Resultado<T>, chamador: Chamador): Response => respostaJson(comAtualVisto(resultado, chamador), chamador);

  async function propor(corpo: unknown, chamador: Chamador): Promise<Resultado<CartaoVisto>> {
    const forma = lerPorSchema(corpoDePropor, corpo);
    if (!forma.ok) return falha("entrada_invalida", `${forma.mensagem} ${FORMA_DE_PROPOR}`);
    const id = forma.valor.id ?? crypto.randomUUID();
    const lida = lerEscrita(forma.valor.tool, forma.valor.dados);
    if (!lida.ok) return falha("entrada_invalida", lida.mensagem);
    // Pedido repetido não confere de novo no CRM nem grava: devolve o cartão que existe.
    const existente = forma.valor.id === undefined ? null : lerCartao(banco, id);
    if (existente !== null) {
      if (hashDaEscrita(lida.valor) === hashProposto(existente)) return ok(ver(existente, chamador));
      const recusa = falha("conflito_da_escrita", `O id ${id} já é de um cartão com outro conteúdo. Nada mudou. Para propor este conteúdo, rode \`escrita propor\` sem \`--id\`.`);
      return recusa.ok ? recusa : { ok: false, erro: { ...recusa.erro, atual: existente } };
    }

    const clienteId = clienteIdDaEscrita(lida.valor);
    let cliente: ClienteDoCartao = null;
    if (clienteId !== null) {
      const conferencia = await conectores.conferirCliente(clienteId);
      if (conferencia.tipo === "nao_encontrado") {
        return falha("crm_nao_encontrado", `O CRM não achou o cliente ${clienteId}, ou o vendedor não tem acesso a ele. O cartão não foi criado.`);
      }
      cliente =
        conferencia.tipo === "conferido"
          ? { id: clienteId, conferido: true, nome: conferencia.ficha.nome, cidade: conferencia.ficha.cidade }
          : { id: clienteId, conferido: false };
    }
    const marca = confiraOCliente({
      clienteId,
      vinculos: [...listarVinculos(banco, "whatsapp").values(), ...listarVinculos(banco, "email").values()],
      jaAprovouEscritaDele: clienteId !== null && clienteJaTemEscritaAprovada(banco, clienteId),
    });
    const gravado = inserirCartao(banco, novoCartao({ id, escrita: lida.valor, cliente, confiraOCliente: marca, agora: deps.agora() }));
    if (gravado.inserido) publicador.tarefasMudaram();
    return ok(ver(gravado.cartao, chamador));
  }

  /** O hash do que o agente propôs: a primeira edição do vendedor guarda em `decisao` o hash de antes dela. */
  function hashProposto(cartao: CartaoDaEscrita): string {
    return decisoesDoCartao(banco, cartao.id).find((d) => d.acao === "editou")?.hash ?? cartao.hash;
  }

  function comando(acao: Acao, corpo: unknown): Resultado<ComandoDaEscrita> {
    if (acao === "retirar") return corpo === undefined ? ok({ acao }) : falha("entrada_invalida", `A ação "retirar" não leva corpo.`);
    const lido = acao === "editar" ? lerPorSchema(corpoDeEditar, corpo) : lerPorSchema(corpoDeDecidir, corpo);
    return lido.ok ? ok({ acao, ...lido.valor } as ComandoDaEscrita) : falha("entrada_invalida", lido.mensagem);
  }

  /** Uma gravação no CRM por vez, no servidor inteiro: quem chega com o CRM ocupado espera a vez antes da transação. */
  let fila: Promise<unknown> = Promise.resolve();

  function emSerie<T>(tarefa: () => Promise<T>): Promise<T> {
    const proxima = fila.then(tarefa);
    fila = proxima.catch(() => {});
    return proxima;
  }

  /** O CRM fora de `conectado` não deixa aprovar: o cartão fica como estava, sem decisão nova. */
  function portaoDoCrm(): Resultado<never> | null {
    const crm = conectores.estado().crm;
    if (crm.fase === "conectado") return null;
    return falha(crm.fase === "atencao" ? crm.problema.codigo : "crm_desconectado");
  }

  const fechamento = (desfecho: DesfechoDaGravacao): ComandoDaEscrita =>
    desfecho.tipo === "gravou"
      ? { acao: "gravou", recibo: desfecho.recibo }
      : { acao: desfecho.tipo === "recusou" ? "recusou" : "ficou_incerto", erro: desfecho.erro };

  /**
   * `aprovar` e `tentar_de_novo`: a mesma fila, nesta ordem. (1) o portão do CRM; (2) numa transação, a decisão do vendedor e
   * `comecar_gravacao`, e o cartão sai em `gravando`, nunca em `aprovado`; (3) `event: tarefas`; (4) a chamada ao CRM, uma só;
   * (5) o fecho, `gravou`, `recusou` ou `ficou_incerto`, e `event: tarefas` de novo; (6) o cartão no estado final. O OK do vendedor deu
   * certo: o que o CRM fez está em `estado`, `recibo` e `erro`. Nada aqui repete a chamada: só um clique novo leva a outra.
   * `aprovar` com cliente por conferir não aprova: confere o cliente no CRM e devolve o conflito com o cartão já com nome e
   * cidade, para o vendedor ver o cliente e aprovar de novo. Aprovar nunca confere e aprova no mesmo pedido.
   */
  function gravarOQueFoiAprovado(id: string, pedido: ComandoDaEscrita & { readonly acao: "aprovar" | "tentar_de_novo" }, chamador: Chamador): Promise<Resultado<CartaoVisto>> {
    return emSerie(async () => {
      const fechado = portaoDoCrm();
      if (fechado !== null) return fechado;
      const feito = mudarCartaoEmSequencia(
        banco,
        id,
        [
          { comando: pedido, quem: quemDecide(chamador) },
          { comando: { acao: "comecar_gravacao" }, quem: "servidor" },
        ],
        deps.agora(),
      );
      if (!feito.ok) return conferirOClienteSePrecisa(id, pedido.acao, feito);
      publicador.tarefasMudaram();
      const gravando = feito.dados[feito.dados.length - 1]?.cartao;
      if (gravando === undefined) return falha("interno");

      let desfecho: DesfechoDaGravacao;
      try {
        desfecho = await conectores.gravarNoCrm(gravando.escrita);
      } catch {
        desfecho = { tipo: "incerto", erro: { codigo: "crm_escrita_incerta", detalhe: null } };
      }
      const fecho = fechar(id, desfecho);
      if (!fecho.ok) return falha("interno");
      publicador.tarefasMudaram();
      return ok(ver(fecho.dados.cartao, chamador));
    });
  }

  /**
   * O fecho que lança com o servidor de pé (disco, SQLITE_BUSY) tenta uma vez o fecho do boot, `escrita_interrompida`:
   * em `gravando` o cartão sai do bloco Aprovar até o próximo boot. Se esse também lançar (o banco fechou porque o servidor
   * parou), a primeira exceção sobe e o boot resolve.
   */
  function fechar(id: string, desfecho: DesfechoDaGravacao) {
    try {
      return mudarCartao(banco, id, fechamento(desfecho), "servidor", deps.agora());
    } catch (erro) {
      try {
        return mudarCartao(banco, id, { acao: "ficou_incerto", erro: { codigo: "escrita_interrompida", detalhe: null } }, "servidor", deps.agora());
      } catch {
        throw erro;
      }
    }
  }

  async function conferirOClienteSePrecisa(id: string, acao: "aprovar" | "tentar_de_novo", feito: Resultado<never>): Promise<Resultado<never>> {
    if (feito.ok) return feito;
    const { atual } = feito.erro;
    if (feito.erro.codigo !== "cliente_por_conferir" || acao !== "aprovar") return feito;
    const cartao = atual as CartaoDaEscrita;
    if (cartao.cliente === null) return feito;
    const conferencia = await conectores.conferirCliente(cartao.cliente.id);
    if (conferencia.tipo === "nao_encontrado") {
      return falha("crm_nao_encontrado", `O CRM não achou o cliente ${cartao.cliente.id}, ou o vendedor não tem acesso a ele. O cartão ficou como estava.`);
    }
    if (conferencia.tipo === "nao_conferido") return feito;
    const conferido = mudarCartao(banco, id, { acao: "conferir_cliente", ficha: conferencia.ficha }, "servidor", deps.agora());
    if (!conferido.ok) return conferido;
    publicador.tarefasMudaram();
    return conflitoComOCliente(conferido.dados.cartao);
  }

  async function decidir(id: string, acao: Acao, corpo: unknown, chamador: Chamador): Promise<Resultado<CartaoVisto>> {
    const pedido = comando(acao, corpo);
    if (!pedido.ok) return pedido;
    if (pedido.dados.acao === "aprovar" || pedido.dados.acao === "tentar_de_novo") return gravarOQueFoiAprovado(id, pedido.dados, chamador);
    const feito = mudarCartao(banco, id, pedido.dados, quemDecide(chamador), deps.agora());
    if (!feito.ok) return feito;
    publicador.tarefasMudaram();
    return ok(ver(feito.dados.cartao, chamador));
  }

  return [
    {
      metodo: "POST",
      caminho: "/api/escritas",
      quem: ["agente"],
      async tratar({ req, chamador }) {
        const corpo = await lerCorpo(req);
        if (!corpo.ok) return respostaJson(falha(corpo.codigo), chamador);
        return responder(await propor(corpo.valor, chamador), chamador);
      },
    },
    {
      metodo: "GET",
      caminho: "/api/escritas",
      quem: ["painel", "agente"],
      tratar({ url, chamador }) {
        const filtro = filtroDeEstado.safeParse(url.searchParams.get("estado") ?? undefined);
        if (!filtro.success) return respostaJson(falha("entrada_invalida", FORMA_DO_FILTRO), chamador);
        const leitor = leitorDe(chamador);
        return respostaJson(ok({ escritas: listarCartoes(banco, filtro.data).map((cartao) => resumoDaEscrita(cartao, leitor)) }), chamador);
      },
    },
    {
      metodo: "GET",
      caminho: "/api/escritas/:id",
      quem: ["painel", "agente"],
      tratar({ parametros, chamador }) {
        const id = parametros.id ?? "";
        const cartao = lerCartao(banco, id);
        return respostaJson(cartao === null ? falha("nao_encontrado", `Não existe cartão com o id ${id}.`) : ok(ver(cartao, chamador)), chamador);
      },
    },
    {
      metodo: "POST",
      caminho: "/api/escritas/:id/:acao",
      quem: ["painel", "agente"],
      async tratar({ req, server, parametros, chamador }) {
        // Aprovar espera o CRM, e o `Bun.serve` fecha conexão parada por 10 s. O pedido não corta a gravação: fechar a aba não a interrompe.
        server.timeout(req, 0);
        const { id = "", acao } = parametros;
        if (!(ACOES as readonly (string | undefined)[]).includes(acao)) return respostaJson(falha("nao_encontrado"), chamador);
        const qual = acao as Acao;
        if (qual === "retirar" && chamador !== "agente") return respostaJson(falha("nao_autorizado", SO_O_AGENTE), chamador);
        if (qual !== "retirar" && chamador !== "painel") return respostaJson(falha("so_no_painel", SO_O_VENDEDOR), chamador);
        const corpo = await lerCorpo(req);
        if (!corpo.ok) return respostaJson(falha(corpo.codigo), chamador);
        return responder(await decidir(id, qual, corpo.valor, chamador), chamador);
      },
    },
  ];
}

/** O cartão que acabou de ser conferido, no formato de conflito: o vendedor lê o cliente e aprova de novo. */
function conflitoComOCliente(cartao: CartaoDaEscrita): Resultado<never> {
  return {
    ok: false,
    erro: {
      codigo: "conflito_da_escrita",
      mensagem: "A Secretária conferiu o cliente no CRM e o cartão mudou. Confira o nome e a cidade e aprove de novo.",
      acao: "Leia o cartão de novo e decida.",
      atual: cartao,
    },
  };
}
