/**
 * O e-mail de mentira do servidor de desenvolvimento: as mesmas rotas do servidor de verdade, sobre
 * um `EstadoDoEmail` em memória. O teste do login dura alguns segundos e passa, menos com a senha
 * `errada`. Nenhum IMAP é chamado.
 */
import {
  LIMITE_DE_CONTAS_DE_EMAIL,
  PRAZOS_MS,
  configDoProvedor,
  falha,
  lerEnderecoEmail,
  lerIdContaEmail,
  lerJanela,
  lerRotulo,
  ok,
  somar,
  type ContaEmailComEstado,
  type EstadoDoEmail,
  type EstadoEmail,
  type IdContaEmail,
  type Instante,
  type ProvedorEmail,
  type Resultado,
} from "../../dominio";

export interface Passo<T> {
  readonly email: EstadoDoEmail;
  readonly resultado: Resultado<T>;
  /** Conta cujo teste começou: o servidor chama `concluirTeste` depois de um tempo. */
  readonly testar?: { readonly id: IdContaEmail; readonly passa: boolean };
}

const PROVEDORES: readonly ProvedorEmail[] = ["profills", "gmail", "outro"];
const objeto = (valor: unknown): Record<string, unknown> => (typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {});
const texto = (valor: unknown) => (typeof valor === "string" ? valor : undefined);

function trocar(email: EstadoDoEmail, id: IdContaEmail, mudar: (conta: ContaEmailComEstado) => ContaEmailComEstado): EstadoDoEmail {
  return { ...email, contas: email.contas.map((conta) => (conta.id === id ? mudar(conta) : conta)) };
}

function testando(conta: ContaEmailComEstado, agora: Instante): EstadoEmail {
  const anterior = conta.estado.fase === "atencao" || conta.estado.fase === "desconectado" ? conta.estado : { fase: "desconectado" as const };
  return { fase: "testando", config: conta.config, expiraEm: somar(agora, PRAZOS_MS.testeDoEmail), anterior };
}

export function adicionar(email: EstadoDoEmail, dados: unknown, agora: Instante): Passo<ContaEmailComEstado> {
  const corpo = objeto(dados);
  const id = lerIdContaEmail(texto(corpo.id) ?? "");
  const rotulo = lerRotulo(texto(corpo.rotulo) ?? "");
  const provedor = PROVEDORES.find((nome) => nome === corpo.provedor);
  const endereco = lerEnderecoEmail(texto(corpo.endereco) ?? "");
  const senha = texto(corpo.senha) ?? "";
  const janelaDias = corpo.janelaDias === undefined ? 30 : lerJanela(corpo.janelaDias);
  const porta = typeof corpo.porta === "number" ? corpo.porta : undefined;
  const seguranca = corpo.seguranca === "tls" || corpo.seguranca === "starttls" ? corpo.seguranca : undefined;
  const config = provedor && endereco ? configDoProvedor(provedor, endereco, { servidor: texto(corpo.servidor), porta, seguranca }) : null;
  if (!id || !rotulo || !provedor || !endereco || senha === "" || janelaDias === null || config === null) return { email, resultado: falha("entrada_invalida") };

  const existente = email.contas.find((conta) => conta.id === id);
  if (existente !== undefined) {
    if (existente.config.endereco.toLowerCase() !== endereco.toLowerCase()) return { email, resultado: falha("entrada_invalida") };
    if (existente.estado.fase !== "atencao" && existente.estado.fase !== "desconectado") return { email, resultado: ok(existente) };
    const novo = trocar(email, id, (conta) => ({ ...conta, config, estado: testando({ ...conta, config }, agora) }));
    return { email: novo, resultado: ok(novo.contas.find((conta) => conta.id === id)!), testar: { id, passa: senha !== "errada" } };
  }
  if (email.contas.length >= LIMITE_DE_CONTAS_DE_EMAIL) return { email, resultado: falha("email_limite_de_contas") };
  if (email.contas.some((conta) => conta.rotulo.toLowerCase() === rotulo.toLowerCase())) return { email, resultado: falha("email_rotulo_repetido") };
  if (email.contas.some((conta) => conta.config.endereco.toLowerCase() === endereco.toLowerCase())) return { email, resultado: falha("email_endereco_repetido") };
  const base = { id, rotulo, provedor, config, janelaDias };
  const conta: ContaEmailComEstado = { ...base, estado: testando({ ...base, estado: { fase: "desconectado" } }, agora) };
  return { email: { pulado: false, contas: [...email.contas, conta] }, resultado: ok(conta), testar: { id, passa: senha !== "errada" } };
}

export function concluirTeste(email: EstadoDoEmail, id: IdContaEmail, passa: boolean, agora: Instante): EstadoDoEmail {
  return trocar(email, id, (conta) => {
    if (conta.estado.fase !== "testando") return conta;
    if (passa) return { ...conta, config: conta.estado.config, estado: { fase: "conectado", verificadoEm: agora, caixaDeEntrada: { mensagens: 1250, naoLidas: 7 } } };
    const codigo = conta.provedor === "gmail" ? "email_gmail_senha_de_app" : "email_senha_recusada";
    return { ...conta, estado: { fase: "atencao", problema: { codigo, desde: agora } } };
  });
}

/** Uma ação de `POST /api/email/contas/:id/:acao`. */
export function agir(email: EstadoDoEmail, idTexto: string, acao: string, dados: unknown, agora: Instante): Passo<unknown> {
  const id = lerIdContaEmail(idTexto);
  const conta = email.contas.find((candidata) => candidata.id === id);
  if (id === null || conta === undefined) return { email, resultado: falha("nao_encontrado") };
  const corpo = objeto(dados);
  const fase = conta.estado.fase;
  const com = (novo: EstadoDoEmail, testar?: Passo<unknown>["testar"]): Passo<unknown> => ({
    email: novo,
    resultado: ok(novo.contas.find((candidata) => candidata.id === id)),
    ...(testar ? { testar } : {}),
  });
  switch (acao) {
    case "remover":
      return { email: { ...email, contas: email.contas.filter((candidata) => candidata.id !== id) }, resultado: ok({ removida: id }) };
    case "mudar": {
      const rotulo = corpo.rotulo === undefined ? undefined : lerRotulo(texto(corpo.rotulo) ?? "");
      const janelaDias = corpo.janelaDias === undefined ? undefined : lerJanela(corpo.janelaDias);
      if (rotulo === null || janelaDias === null || (rotulo === undefined && janelaDias === undefined)) return { email, resultado: falha("entrada_invalida") };
      if (rotulo && email.contas.some((outra) => outra.id !== id && outra.rotulo.toLowerCase() === rotulo.toLowerCase())) return { email, resultado: falha("email_rotulo_repetido") };
      return com(trocar(email, id, (atual) => ({ ...atual, ...(rotulo ? { rotulo } : {}), ...(janelaDias ? { janelaDias } : {}) })));
    }
    case "testar":
      if (fase !== "conectado") return { email, resultado: falha("acao_indisponivel") };
      return com(trocar(email, id, (atual) => ({ ...atual, estado: testando(atual, agora) })), { id, passa: true });
    case "conectar": {
      if (fase !== "desconectado" && fase !== "atencao") return { email, resultado: falha("acao_indisponivel") };
      const senha = texto(corpo.senha) ?? "";
      if (senha === "") return { email, resultado: falha("entrada_invalida") };
      return com(trocar(email, id, (atual) => ({ ...atual, estado: testando(atual, agora) })), { id, passa: senha !== "errada" });
    }
    case "cancelar":
      if (conta.estado.fase !== "testando") return { email, resultado: falha("acao_indisponivel") };
      return com(trocar(email, id, (atual) => ({ ...atual, estado: atual.estado.fase === "testando" ? atual.estado.anterior : atual.estado })));
    case "desconectar":
      if (fase !== "conectado") return { email, resultado: falha("acao_indisponivel") };
      return com(trocar(email, id, (atual) => ({ ...atual, estado: { fase: "desconectado" } })));
    default:
      return { email, resultado: falha("nao_encontrado") };
  }
}

export function pular(email: EstadoDoEmail, dados: unknown): Passo<EstadoDoEmail> {
  const pulado = objeto(dados).pulado;
  if (typeof pulado !== "boolean") return { email, resultado: falha("entrada_invalida") };
  if (pulado && email.contas.length > 0) return { email, resultado: falha("email_pular_com_contas") };
  const novo = { ...email, pulado };
  return { email: novo, resultado: ok(novo) };
}
