import { z } from "zod";
import { conhecidoDaConta, gravarContaEmail } from "../../banco";
import { Segredo, chaveDaSenhaDoEmail } from "../../cofre";
import {
  falha,
  ok,
  problemaDaFalha,
  transicionarEmail,
  type Acao,
  type ColetaDaConta,
  type ConfigEmail,
  type ContaEmail,
  type CorpoLido,
  type EfeitoEmail,
  type EntradaConectar,
  type EstadoEmail,
  type EventoEmail,
  type FalhaDeLeitura,
  type Instante,
  type Resultado,
  type SondagemEmail,
} from "../../dominio";
import type { Dependencias } from "../dependencias";
import { criarMotor, pedir, type Motor } from "../motor";
import { coletarCabecalhos, lerCorpoDoEmail, testarImap } from "./imap";

export const SERVIDOR_IMAP = z
  .string()
  .trim()
  .max(253)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/);

const SENHA = z.union([z.string().min(1), z.custom<Segredo>((valor) => valor instanceof Segredo)]);

/** Corpo do `conectar` de uma conta: a senha e, quando o vendedor mudou, servidor, porta e segurança. */
const formulario = z.strictObject({
  senha: SENHA,
  servidor: SERVIDOR_IMAP.optional(),
  porta: z.number().int().min(1).max(65_535).optional(),
  seguranca: z.enum(["tls", "starttls"]).optional(),
});

function lerEntrada(conta: ContaEmail, dados: unknown): EntradaConectar["email"] | null {
  const lida = formulario.safeParse(dados);
  if (!lida.success) return null;
  const { senha, servidor, porta, seguranca } = lida.data;
  const config: ConfigEmail = {
    endereco: conta.config.endereco,
    servidor: servidor ?? conta.config.servidor,
    porta: porta ?? conta.config.porta,
    seguranca: seguranca ?? conta.config.seguranca,
  };
  return { config, senha: typeof senha === "string" ? Segredo.de(senha) : senha };
}

export interface CascaDaConta {
  readonly motor: Motor<"email", EventoEmail>;
  conta(): ContaEmail;
  /** Troca rótulo ou janela em memória, depois de o banco já ter gravado. */
  ajustar(mudanca: Partial<Pick<ContaEmail, "rotulo" | "janelaDias">>): void;
  agir(acao: Acao, dados: unknown): Promise<Resultado<EstadoEmail>>;
  /**
   * Lê os cabeçalhos da janela da conta, só leitura. Não grava nada e não muda o estado da conta:
   * senha recusada ou certificado inválido só pedem a reconciliação, e a máquina decide.
   */
  coletar(agora: Instante, sinal: AbortSignal): Promise<Resultado<ColetaDaConta>>;
  /** Lê o corpo de uma mensagem agora. O texto sai daqui direto para quem pediu e não é guardado. */
  lerCorpo(local: { readonly caminho: string; readonly uidValidity: string; readonly uid: number }, sinal?: AbortSignal): Promise<Resultado<CorpoLido>>;
  reconciliar(): Promise<void>;
  /** Corta o teste em voo. */
  parar(): void;
}

export interface OpcoesDaConta {
  readonly conta: ContaEmail;
  readonly inicial: EstadoEmail;
  /** Resolve quando a senha da conta única antiga já está na chave da conta. A sondagem lê o cofre só depois. */
  readonly senhaAntigaMigrada: () => Promise<void>;
  readonly aoMudar: () => void;
}

/** Uma conta de e-mail: a máquina dela, o teste IMAP e a senha na chave dela no cofre. */
export function criarCascaDaConta(deps: Dependencias, opcoes: OpcoesDaConta): CascaDaConta {
  const { ambiente, cofre, registro } = deps;
  let conta = opcoes.conta;
  const chave = chaveDaSenhaDoEmail(conta.id);
  const fim = new AbortController();
  /** Teste de credencial em voo. O estado `testando` que o abriu é a identidade da tentativa. */
  let emTeste: { readonly estado: EstadoEmail; readonly aborto: AbortController } | null = null;
  /** A leitura do corpo da vez. Cliques repetidos no painel não abrem uma conexão cada: o provedor limita os logins simultâneos. */
  let leituraDoCorpo: Promise<unknown> = Promise.resolve();

  const motor = criarMotor<"email", EventoEmail, EfeitoEmail>({
    id: "email",
    inicial: opcoes.inicial,
    transicionar: (estado, evento, agora) => transicionarEmail(estado, evento, agora, conta.provedor),
    executar,
    aoMudar() {
      // Cancelar e prazo vencido tiram a conta de `testando` sem efeito: o teste em voo é cortado aqui.
      if (emTeste !== null && motor.estado() !== emTeste.estado) {
        emTeste.aborto.abort();
        emTeste = null;
      }
      opcoes.aoMudar();
    },
    aoFalhar: () => void reconciliar(),
    gravar(efeito, causa) {
      gravarContaEmail(deps.banco, conta.id, efeito.estado, efeito.config, causa, ambiente.agora());
      if (efeito.config !== undefined) {
        conta = { ...conta, config: efeito.config };
        opcoes.aoMudar();
      }
    },
    agora: ambiente.agora,
    armar: deps.armar,
    registro,
  });

  /** Parte sem esperar o fim: o resultado chega como evento, e `cancelar` não fica preso atrás do teste. */
  function testar(efeito: Extract<EfeitoEmail, { tipo: "testar" }>): void {
    const tentativa = motor.estado();
    if (tentativa.fase !== "testando") return;
    const aborto = new AbortController();
    emTeste = { estado: tentativa, aborto };
    void testarImap(efeito.config, efeito.senha, ambiente.caExtra, AbortSignal.any([fim.signal, aborto.signal])).then((teste) => {
      if (motor.estado() !== tentativa) return;
      emTeste = null;
      motor.despachar(
        teste.ok
          ? { tipo: "teste_ok", mensagens: teste.mensagens, naoLidas: teste.naoLidas, senha: efeito.senha }
          : { tipo: "teste_falhou", motivo: teste.motivo, detalhe: teste.detalhe },
      );
    });
  }

  async function sondar(geracao: number): Promise<void> {
    await opcoes.senhaAntigaMigrada();
    const senha = await cofre.ler(chave);
    const resultado: SondagemEmail =
      senha === null ? { senha: "ausente" } : { senha: "presente", resultado: await testarImap(conta.config, senha, ambiente.caExtra, fim.signal) };
    if (motor.geracao() !== geracao) {
      registro.info("email.sondagem_descartada", {});
      return;
    }
    motor.despachar({ tipo: "sondagem", resultado });
  }

  async function executar(efeito: Exclude<EfeitoEmail, { tipo: "armar_prazo" | "gravar" }>, geracao: number): Promise<void> {
    switch (efeito.tipo) {
      case "testar":
        return testar(efeito);
      case "sondar":
        return sondar(geracao);
      case "guardar_senha":
        return cofre.gravar(chave, efeito.senha);
      case "apagar_senha":
        return cofre.apagar(chave);
    }
  }

  function reconciliar(): Promise<void> {
    const geracao = motor.geracao();
    return motor.enfileirar(() => sondar(geracao));
  }

  /** Conta fora de `conectado` não abre conexão: a senha pode nem existir mais. */
  async function prepararLeitura(): Promise<Resultado<Segredo>> {
    if (motor.estado().fase !== "conectado") return falha("email_conta_desconectada");
    await opcoes.senhaAntigaMigrada();
    const senha = await cofre.ler(chave);
    if (senha === null) {
      void reconciliar().catch(() => {});
      return falha("email_conta_desconectada");
    }
    return ok(senha);
  }

  function falhaDaLeitura(leitura: FalhaDeLeitura, sinalDoPedido: AbortSignal | undefined): Resultado<never> {
    if (fim.signal.aborted) return falha("servidor_fora_do_ar", "A Secretária parou no meio da leitura.");
    if (sinalDoPedido?.aborted === true) return falha("email_prazo_da_leitura");
    const { motivo } = leitura;
    registro.aviso("email.leitura_falhou", { conta: conta.id, motivo });
    // Senha ou certificado: a máquina da conta confere e decide se ela vai para `atencao`. Sem esperar.
    if (motivo === "senha_recusada" || motivo === "senha_de_app_exigida" || motivo === "certificado_invalido") void reconciliar().catch(() => {});
    return falha(problemaDaFalha(conta.provedor, motivo));
  }

  async function lerCorpoAgora(local: Parameters<CascaDaConta["lerCorpo"]>[0], sinal: AbortSignal | undefined): Promise<Resultado<CorpoLido>> {
    const preparo = await prepararLeitura();
    if (!preparo.ok) return preparo;
    const lido = await lerCorpoDoEmail({ config: conta.config, senha: preparo.dados, caExtra: ambiente.caExtra, ...local }, sinal === undefined ? fim.signal : AbortSignal.any([sinal, fim.signal]));
    if (lido.ok) return ok(lido.corpo);
    if (lido.motivo === "nao_encontrado") return falha("nao_encontrado", "Este e-mail não está mais nesta pasta do servidor. Sincronize e liste de novo.");
    return falhaDaLeitura(lido, sinal);
  }

  return {
    motor,
    conta: () => conta,
    async coletar(agora, sinal) {
      const preparo = await prepararLeitura();
      if (!preparo.ok) return preparo;
      const lida = await coletarCabecalhos(
        { config: conta.config, senha: preparo.dados, caExtra: ambiente.caExtra, janelaDias: conta.janelaDias, agora, conhecido: conhecidoDaConta(deps.banco, conta.id), ...(deps.tetoDeEmailPorPasta === undefined ? {} : { teto: deps.tetoDeEmailPorPasta }) },
        AbortSignal.any([sinal, fim.signal]),
      );
      return lida.ok ? ok(lida.coleta) : falhaDaLeitura(lida, sinal);
    },
    lerCorpo(local, sinal) {
      const vez = leituraDoCorpo.then(() => lerCorpoAgora(local, sinal));
      leituraDoCorpo = vez.catch(() => {});
      return vez;
    },
    ajustar(mudanca) {
      conta = { ...conta, ...mudanca };
      opcoes.aoMudar();
    },
    async agir(acao, dados) {
      if (acao !== "conectar") return pedir(motor, acao, { tipo: `pedido_${acao}` });
      const entrada = lerEntrada(conta, dados);
      if (entrada === null) return falha("entrada_invalida", "Informe a senha e, se mudou, servidor, porta e segurança (tls ou starttls).");
      return pedir(motor, acao, { tipo: "pedido_conectar", entrada });
    },
    reconciliar,
    parar: () => fim.abort(),
  };
}
