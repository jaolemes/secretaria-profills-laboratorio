import { describe, expect, test } from "bun:test";
import { Segredo } from "../cofre";
import {
  PREDEFINICOES_DE_EMAIL,
  configDoProvedor,
  problemaDaFalha,
  textoExterno,
  transicionarEmail,
  type ConfigEmail,
  type EfeitoEmail,
  type EnderecoEmail,
  type EstadoEmail,
  type EventoEmail,
  type Instante,
} from "./index";

const AGORA = "2026-11-11T12:00:00.000Z" as Instante;
const EM_30_S = "2026-11-11T12:00:30.000Z" as Instante;
const DEPOIS_DE_1_MIN = "2026-11-11T12:01:00.000Z" as Instante;
const ANTES = "2026-11-10T09:00:00.000Z" as Instante;
const SENHA = Segredo.de("CANARIO-SENHA-EMAIL");
const CONFIG: ConfigEmail = {
  endereco: "vendedor@exemplo.com.br" as EnderecoEmail,
  servidor: "imap.exemplo.com.br",
  porta: 993,
  seguranca: "tls",
};
const DETALHE = textoExterno("AUTHENTICATIONFAILED");

const desconectado: EstadoEmail = { fase: "desconectado" };
const testando: EstadoEmail = { fase: "testando", config: CONFIG, expiraEm: EM_30_S, anterior: desconectado };
const conectado: EstadoEmail = {
  fase: "conectado",
  verificadoEm: ANTES,
  caixaDeEntrada: { mensagens: 7, naoLidas: 2 },
};
const conectadoAgora: EstadoEmail = { ...conectado, verificadoEm: AGORA, caixaDeEntrada: { mensagens: 9, naoLidas: 1 } };
const senhaRecusada: EstadoEmail = {
  fase: "atencao",
  problema: { codigo: "email_senha_recusada", desde: AGORA, detalhe: DETALHE },
};

const sondagem = (resultado: Extract<EventoEmail, { tipo: "sondagem" }>["resultado"]): EventoEmail => ({
  tipo: "sondagem",
  resultado,
});

interface Linha {
  readonly nome: string;
  readonly de: EstadoEmail;
  readonly evento: EventoEmail;
  readonly agora?: Instante;
  readonly para: EstadoEmail;
  readonly efeitos: readonly EfeitoEmail[];
}

const TABELA: readonly Linha[] = [
  {
    nome: "conectar testa a credencial antes de guardar",
    de: desconectado,
    evento: { tipo: "pedido_conectar", entrada: { config: CONFIG, senha: SENHA } },
    para: testando,
    efeitos: [{ tipo: "testar", config: CONFIG, senha: SENHA }, { tipo: "armar_prazo", ate: EM_30_S }],
  },
  {
    nome: "teste aprovado guarda a senha antes de gravar a linha",
    de: testando,
    evento: { tipo: "teste_ok", mensagens: 9, naoLidas: 1, senha: SENHA },
    para: conectadoAgora,
    efeitos: [{ tipo: "guardar_senha", senha: SENHA }, { tipo: "gravar", estado: conectadoAgora, config: CONFIG }],
  },
  {
    nome: "teste reprovado vira atenção sem gravar nada",
    de: testando,
    evento: { tipo: "teste_falhou", motivo: "senha_recusada", detalhe: DETALHE },
    para: senhaRecusada,
    efeitos: [],
  },
  {
    nome: "certificado inválido no teste vira atenção",
    de: testando,
    evento: { tipo: "teste_falhou", motivo: "certificado_invalido", detalhe: DETALHE },
    para: { fase: "atencao", problema: { codigo: "email_certificado_invalido", desde: AGORA, detalhe: DETALHE } },
    efeitos: [],
  },
  {
    nome: "cancelar volta à fase anterior",
    de: { ...testando, anterior: senhaRecusada },
    evento: { tipo: "pedido_cancelar" },
    para: senhaRecusada,
    efeitos: [],
  },
  {
    nome: "prazo vencido volta à fase anterior",
    de: testando,
    evento: { tipo: "prazo_vencido" },
    agora: DEPOIS_DE_1_MIN,
    para: desconectado,
    efeitos: [],
  },
  {
    nome: "sondagem aprovada renova a verificação",
    de: conectado,
    evento: sondagem({ senha: "presente", resultado: { ok: true, mensagens: 9, naoLidas: 1 } }),
    para: conectadoAgora,
    efeitos: [{ tipo: "gravar", estado: conectadoAgora }],
  },
  {
    nome: "senha recusada na sondagem vira atenção gravada",
    de: conectado,
    evento: sondagem({ senha: "presente", resultado: { ok: false, motivo: "senha_recusada", detalhe: DETALHE } }),
    para: senhaRecusada,
    efeitos: [{ tipo: "gravar", estado: senhaRecusada }],
  },
  {
    nome: "servidor fora do ar na sondagem não muda nada",
    de: conectado,
    evento: sondagem({ senha: "presente", resultado: { ok: false, motivo: "servidor_inacessivel", detalhe: DETALHE } }),
    para: conectado,
    efeitos: [],
  },
  {
    nome: "linha conectada sem senha no cofre desconecta",
    de: conectado,
    evento: sondagem({ senha: "ausente" }),
    para: desconectado,
    efeitos: [{ tipo: "gravar", estado: desconectado }, { tipo: "apagar_senha" }],
  },
  {
    nome: "senha órfã sem linha é apagada",
    de: desconectado,
    evento: sondagem({ senha: "presente", resultado: { ok: true, mensagens: 1, naoLidas: 0 } }),
    para: desconectado,
    efeitos: [{ tipo: "apagar_senha" }],
  },
  {
    nome: "desconectar grava a linha antes de apagar a senha",
    de: conectado,
    evento: { tipo: "pedido_desconectar" },
    para: desconectado,
    efeitos: [{ tipo: "gravar", estado: desconectado }, { tipo: "apagar_senha" }],
  },
];

describe("transicionarEmail", () => {
  test.each(TABELA.map((linha) => [linha.nome, linha] as const))("%s", (_nome, linha) => {
    expect(transicionarEmail(linha.de, linha.evento, linha.agora ?? AGORA, "outro")).toEqual({
      estado: linha.para,
      efeitos: linha.efeitos,
    });
  });

  const foraDeHora: readonly (readonly [string, EstadoEmail, EventoEmail])[] = [
    ["segundo conectar durante o teste não testa de novo", testando, { tipo: "pedido_conectar", entrada: { config: CONFIG, senha: SENHA } }],
    ["teste que termina depois do cancelamento é ignorado", desconectado, { tipo: "teste_ok", mensagens: 1, naoLidas: 0, senha: SENHA }],
    ["prazo velho não muda o teste", testando, { tipo: "prazo_vencido" }],
  ];
  test.each(foraDeHora)("%s", (_nome, estado, evento) => {
    expect(transicionarEmail(estado, evento, AGORA, "outro")).toEqual({ estado, efeitos: [] });
  });

  test("o estado nunca carrega a senha", () => {
    const { estado } = transicionarEmail(desconectado, { tipo: "pedido_conectar", entrada: { config: CONFIG, senha: SENHA } }, AGORA, "outro");
    expect(Object.values(estado).some((valor) => valor instanceof Segredo)).toBe(false);
    expect(JSON.stringify(estado)).not.toContain("CANARIO");
  });
});

describe("provedor da conta", () => {
  const gmail: EstadoEmail = { fase: "atencao", problema: { codigo: "email_gmail_senha_de_app", desde: AGORA, detalhe: DETALHE } };

  test.each(["senha_recusada", "senha_de_app_exigida"] as const)("no Gmail, %s vira o problema da senha de app", (motivo) => {
    expect(transicionarEmail(testando, { tipo: "teste_falhou", motivo, detalhe: DETALHE }, AGORA, "gmail")).toEqual({ estado: gmail, efeitos: [] });
    const naSondagem = transicionarEmail(conectado, sondagem({ senha: "presente", resultado: { ok: false, motivo, detalhe: DETALHE } }), AGORA, "gmail");
    expect(naSondagem).toEqual({ estado: gmail, efeitos: [{ tipo: "gravar", estado: gmail }] });
  });

  test("fora do Gmail, a mesma recusa é senha recusada", () => {
    for (const provedor of ["profills", "outro"] as const) {
      expect(problemaDaFalha(provedor, "senha_de_app_exigida")).toBe("email_senha_recusada");
      expect(problemaDaFalha(provedor, "senha_recusada")).toBe("email_senha_recusada");
    }
    expect(problemaDaFalha("gmail", "certificado_invalido")).toBe("email_certificado_invalido");
    expect(problemaDaFalha("gmail", "servidor_inacessivel")).toBe("email_servidor_inacessivel");
  });

  test("a predefinição preenche só o que faltou; outro exige tudo", () => {
    const endereco = "nome@gmail.com" as EnderecoEmail;
    expect(configDoProvedor("gmail", endereco, {})).toEqual({ endereco, servidor: "imap.gmail.com", porta: 993, seguranca: "tls" });
    expect(configDoProvedor("profills", endereco, {})).toEqual({ endereco, servidor: "imap.kinghost.net", porta: 993, seguranca: "tls" });
    expect(configDoProvedor("profills", endereco, { servidor: "imap.outro.test", porta: 143, seguranca: "starttls" })).toEqual({
      endereco,
      servidor: "imap.outro.test",
      porta: 143,
      seguranca: "starttls",
    });
    expect(configDoProvedor("outro", endereco, { servidor: "imap.outro.test", porta: 993 })).toBeNull();
    expect(configDoProvedor("outro", endereco, { servidor: "imap.outro.test", porta: 993, seguranca: "tls" })).not.toBeNull();
  });

  test("o Gmail exige senha de app e aponta onde criá-la; o IMAP da Profills segue marcado como não conferido", () => {
    expect(PREDEFINICOES_DE_EMAIL.gmail).toMatchObject({ senhaDeApp: true, ajuda: "https://myaccount.google.com/apppasswords" });
    expect(PREDEFINICOES_DE_EMAIL.profills).toMatchObject({ conferida: false, senhaDeApp: false });
    expect(PREDEFINICOES_DE_EMAIL.outro).toBeNull();
  });
});
