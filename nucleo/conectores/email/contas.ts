import { z } from "zod";
import {
  gravarEmailPulado,
  inserirContaEmail,
  lerEmailPulado,
  listarContasEmail,
  mudarContaEmail,
  removerContaEmail,
  senhaLegadaMigrada,
  type ContaGravada,
  type MudancaDaConta,
} from "../../banco";
import { Segredo, chaveDaSenhaDoEmail } from "../../cofre";
import {
  JANELAS_DE_EMAIL,
  JANELA_PADRAO,
  configDoProvedor,
  PROVEDORES_DE_EMAIL,
  acoesPossiveis,
  falha,
  lerEnderecoEmail,
  lerIdContaEmail,
  lerRotulo,
  ok,
  type Acao,
  type ColetaDaConta,
  type ContaEmail,
  type ContaEmailComEstado,
  type CorpoLido,
  type EstadoDoEmail,
  type IdContaEmail,
  type Instante,
  type JanelaDias,
  type Resultado,
} from "../../dominio";
import type { Dependencias } from "../dependencias";
import type { Motor } from "../motor";
import { SERVIDOR_IMAP, criarCascaDaConta, type CascaDaConta } from "./casca";

const JANELA = z.literal(JANELAS_DE_EMAIL);

/**
 * Corpo de adicionar. Sem predefinição (`outro`), servidor, porta e segurança são obrigatórios.
 * `id` é o UUID que quem pede escolhe para a conta, para poder repetir o pedido.
 */
const corpoDeAdicionar = z.strictObject({
  id: z.string().optional(),
  rotulo: z.string(),
  provedor: z.enum(PROVEDORES_DE_EMAIL),
  endereco: z.string().trim(),
  servidor: SERVIDOR_IMAP.optional(),
  porta: z.number().int().min(1).max(65_535).optional(),
  seguranca: z.enum(["tls", "starttls"]).optional(),
  janelaDias: JANELA.optional(),
  senha: z.union([z.string().min(1), z.custom<Segredo>((valor) => valor instanceof Segredo)]),
});

const corpoDeMudar = z
  .strictObject({ rotulo: z.string().optional(), janelaDias: JANELA.optional() })
  .refine((corpo) => corpo.rotulo !== undefined || corpo.janelaDias !== undefined);

const USO_DE_ADICIONAR =
  "Informe rótulo, provedor (profills, gmail ou outro), endereço e senha. Em `outro`, também servidor, porta e segurança (tls ou starttls). Janela: 30, 60 ou 90 dias.";

export interface ContasDeEmail {
  estado(): EstadoDoEmail;
  /**
   * Só o painel chama: cria a conta e já começa o teste do login com a senha. Repetir o pedido com
   * o mesmo `id` (clique duplo, resposta perdida) não cria outra conta nem responde "repetida":
   * conecta a conta desse id quando a fase dela aceita, e devolve a conta.
   */
  adicionar(dados: unknown): Promise<Resultado<ContaEmailComEstado>>;
  agir(id: string, acao: Acao, dados: unknown): Promise<Resultado<ContaEmailComEstado>>;
  /** Rótulo e janela. `{rotulo?, janelaDias?}`, pelo menos um. */
  mudar(id: string, dados: unknown): Promise<Resultado<ContaEmailComEstado>>;
  /** Apaga a senha do cofre e depois a conta. */
  remover(id: string): Promise<Resultado<{ readonly removida: IdContaEmail }>>;
  pular(pulado: boolean): Resultado<EstadoDoEmail>;
  /** Lê os cabeçalhos da janela de uma conta conectada. Só leitura, e não grava: quem chama grava. */
  coletar(id: IdContaEmail, agora: Instante, sinal: AbortSignal): Promise<Resultado<ColetaDaConta>>;
  /** O corpo de uma mensagem, lido agora. `local` vem do cursor da pasta e do id do e-mail. */
  lerCorpo(id: IdContaEmail, local: { readonly caminho: string; readonly uidValidity: string; readonly uid: number }, sinal?: AbortSignal): Promise<Resultado<CorpoLido>>;
  reconciliar(): Promise<void>;
  motores(): readonly Motor<"email", unknown>[];
  /** Corta os testes em voo. */
  parar(): void;
}

export function criarContasDeEmail(deps: Dependencias, aoMudar: () => void): ContasDeEmail {
  const { banco, cofre, ambiente } = deps;
  const cascas = new Map<IdContaEmail, CascaDaConta>();
  let pulado = lerEmailPulado(banco);
  /** A conta que veio da conta única antiga, enquanto a senha dela não saiu da chave `email.senha`. */
  let legada: IdContaEmail | null = null;
  let migracao: Promise<void> | null = null;
  /** Adicionar e remover mudam a lista: um por vez. */
  let fila: Promise<unknown> = Promise.resolve();

  function emFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const proxima = fila.then(tarefa);
    fila = proxima.catch(() => {});
    return proxima;
  }

  /**
   * Leva a senha da conta única antiga para a chave da conta, uma vez. Cada passo confere antes de
   * mudar, então uma queda em qualquer ponto converge no boot seguinte: copia só se a chave nova
   * estiver vazia (um login novo nunca é sobrescrito), apaga a antiga e só então solta a marca.
   */
  async function migrarSenhaAntiga(): Promise<void> {
    const antiga = await cofre.ler("email.senha");
    const alvo = legada !== null && cascas.has(legada) ? legada : null;
    if (antiga !== null) {
      if (alvo !== null && (await cofre.ler(chaveDaSenhaDoEmail(alvo))) === null) await cofre.gravar(chaveDaSenhaDoEmail(alvo), antiga);
      await cofre.apagar("email.senha");
    }
    if (legada !== null) senhaLegadaMigrada(banco);
    legada = null;
  }

  /** Falhou (cofre fora do ar): a próxima sondagem tenta de novo. */
  function senhaAntigaMigrada(): Promise<void> {
    migracao ??= migrarSenhaAntiga().catch((erro: unknown) => {
      migracao = null;
      throw erro;
    });
    return migracao;
  }

  function ligar(gravada: ContaGravada): CascaDaConta {
    const casca = criarCascaDaConta(deps, { conta: gravada.conta, inicial: gravada.estado, senhaAntigaMigrada, aoMudar });
    cascas.set(gravada.conta.id, casca);
    return casca;
  }

  for (const gravada of listarContasEmail(banco)) {
    ligar(gravada);
    if (gravada.senhaLegada) legada = gravada.conta.id;
  }

  function comEstado(casca: CascaDaConta): ContaEmailComEstado {
    return { ...casca.conta(), estado: casca.motor.estado() };
  }

  function achar(id: string): CascaDaConta | null {
    const lido = lerIdContaEmail(id);
    return lido === null ? null : (cascas.get(lido) ?? null);
  }

  const inexistente = () => falha("nao_encontrado", "Esta conta de e-mail não existe. Confira a lista em `email.contas` do estado.");

  function lerAdicao(dados: unknown): Resultado<{ readonly conta: ContaEmail; readonly senha: Segredo }> {
    const lido = corpoDeAdicionar.safeParse(dados);
    if (!lido.success) return falha("entrada_invalida", USO_DE_ADICIONAR);
    const { provedor, servidor, porta, seguranca, senha } = lido.data;
    const rotulo = lerRotulo(lido.data.rotulo);
    if (rotulo === null) return falha("entrada_invalida", "O rótulo precisa ter de 1 a 30 caracteres, como Profills ou Pessoal.");
    const endereco = lerEnderecoEmail(lido.data.endereco);
    if (endereco === null) return falha("entrada_invalida", "Digite o e-mail completo, como nome@empresa.com.br.");
    const config = configDoProvedor(provedor, endereco, { servidor, porta, seguranca });
    if (config === null) return falha("entrada_invalida", USO_DE_ADICIONAR);
    const id = lido.data.id === undefined ? (crypto.randomUUID() as IdContaEmail) : lerIdContaEmail(lido.data.id);
    if (id === null) return falha("entrada_invalida", "O `id` da conta precisa ser um UUID.");
    const conta: ContaEmail = {
      id,
      rotulo,
      provedor,
      config,
      janelaDias: lido.data.janelaDias ?? JANELA_PADRAO,
    };
    return ok({ conta, senha: typeof senha === "string" ? Segredo.de(senha) : senha });
  }

  return {
    estado: () => ({ pulado, contas: [...cascas.values()].map(comEstado) }),

    adicionar: (dados) =>
      emFila(async () => {
        const lido = lerAdicao(dados);
        if (!lido.ok) return lido;
        const { conta, senha } = lido.dados;
        const repetido = cascas.get(conta.id);
        if (repetido !== undefined) {
          const atual = repetido.conta();
          if (atual.config.endereco.toLowerCase() !== conta.config.endereco.toLowerCase()) {
            return falha("entrada_invalida", "Este `id` já é de outra conta de e-mail. Mande um `id` novo para uma conta nova.");
          }
          if (!acoesPossiveis(repetido.motor.estado()).includes("conectar")) return ok(comEstado(repetido));
          const { servidor, porta, seguranca } = conta.config;
          const pedido = await repetido.agir("conectar", { senha, servidor, porta, seguranca });
          return pedido.ok ? ok(comEstado(repetido)) : pedido;
        }
        const inserida = inserirContaEmail(banco, conta, ambiente.agora());
        if (!inserida.ok) return inserida;
        pulado = false;
        const casca = ligar(inserida.dados);
        aoMudar();
        const pedido = await casca.agir("conectar", { senha });
        return pedido.ok ? ok(comEstado(casca)) : pedido;
      }),

    async agir(id, acao, dados) {
      const casca = achar(id);
      if (casca === null) return inexistente();
      const resultado = await casca.agir(acao, dados);
      return resultado.ok ? ok(comEstado(casca)) : resultado;
    },

    async mudar(id, dados) {
      const casca = achar(id);
      if (casca === null) return inexistente();
      const lido = corpoDeMudar.safeParse(dados);
      if (!lido.success) return falha("entrada_invalida", "Mande `rotulo` (até 30 caracteres) ou `janelaDias` (30, 60 ou 90).");
      const mudanca: { rotulo?: string; janelaDias?: JanelaDias } = {};
      if (lido.data.rotulo !== undefined) {
        const rotulo = lerRotulo(lido.data.rotulo);
        if (rotulo === null) return falha("entrada_invalida", "O rótulo precisa ter de 1 a 30 caracteres, como Profills ou Pessoal.");
        mudanca.rotulo = rotulo;
      }
      if (lido.data.janelaDias !== undefined) mudanca.janelaDias = lido.data.janelaDias;
      const gravado = mudarContaEmail(banco, casca.conta().id, mudanca satisfies MudancaDaConta, ambiente.agora());
      if (!gravado.ok) return gravado;
      casca.ajustar(mudanca);
      return ok(comEstado(casca));
    },

    remover: (id) =>
      emFila(async () => {
        const casca = achar(id);
        if (casca === null) return inexistente();
        const contaId = casca.conta().id;
        // A senha antiga pode ser desta conta: ela sai do cofre junto.
        await senhaAntigaMigrada();
        casca.motor.encerrar();
        casca.parar();
        await casca.motor.assentar();
        try {
          await cofre.apagar(chaveDaSenhaDoEmail(contaId));
        } catch (erro) {
          // A conta continua na lista, com o estado gravado, para o vendedor tentar de novo.
          const gravada = listarContasEmail(banco).find((linha) => linha.conta.id === contaId);
          if (gravada !== undefined) void ligar(gravada).reconciliar();
          throw erro;
        }
        removerContaEmail(banco, contaId);
        cascas.delete(contaId);
        aoMudar();
        return ok({ removida: contaId });
      }),

    pular(novo) {
      const gravado = gravarEmailPulado(banco, novo, ambiente.agora());
      if (!gravado.ok) return gravado;
      if (pulado !== novo) {
        pulado = novo;
        aoMudar();
      }
      return ok({ pulado, contas: [...cascas.values()].map(comEstado) });
    },

    async coletar(id, agora, sinal) {
      const casca = cascas.get(id);
      return casca === undefined ? inexistente() : casca.coletar(agora, sinal);
    },

    async lerCorpo(id, local, sinal) {
      const casca = cascas.get(id);
      return casca === undefined ? inexistente() : casca.lerCorpo(local, sinal);
    },

    async reconciliar() {
      // Sem conta não há sondagem, e a senha antiga que sobrou também precisa sair do cofre.
      await senhaAntigaMigrada().catch((erro: unknown) => {
        deps.registro.erro("email.migracao_da_senha_falhou", { erro: erro instanceof Error ? erro.name : typeof erro });
      });
      await Promise.all([...cascas.values()].map((casca) => casca.reconciliar()));
    },
    motores: () => [...cascas.values()].map((casca) => casca.motor),
    parar() {
      for (const casca of cascas.values()) casca.parar();
    },
  };
}
