import { describe, expect, test } from "bun:test";
import {
  textoExterno,
  transicionarCrm,
  type EfeitoCrm,
  type EstadoCrm,
  type EstadoDuravel,
  type EventoCrm,
  type Instante,
  type ProblemaDe,
} from "./index";

const AGORA = "2026-11-11T12:00:00.000Z" as Instante;
const EM_10_MIN = "2026-11-11T12:10:00.000Z" as Instante;
const DEPOIS_DE_1_HORA = "2026-11-11T13:00:00.000Z" as Instante;
const ANTES = "2026-11-10T09:00:00.000Z" as Instante;
const FIM_DA_CONEXAO = "2027-02-09T12:00:00.000Z" as Instante;
const DETALHE = textoExterno("invalid_client");

const desconectado: EstadoCrm = { fase: "desconectado" };
const naoLiberado: EstadoCrm = { fase: "atencao", problema: { codigo: "crm_app_nao_liberado", desde: ANTES } };
const autorizando: EstadoCrm = { fase: "autorizando", expiraEm: EM_10_MIN, anterior: desconectado };
const conectado: EstadoCrm = { fase: "conectado", conexaoExpiraEm: FIM_DA_CONEXAO, verificadoEm: ANTES, ferramentas: 18 };
const conectadoAgora: EstadoCrm = { ...conectado, verificadoEm: AGORA };
const vencida: EstadoCrm = { fase: "atencao", problema: { codigo: "crm_conexao_vencida", desde: AGORA } };

const recusa = (motivo: Extract<EventoCrm, { tipo: "autorizacao_recusada" }>["motivo"]): EventoCrm => ({
  tipo: "autorizacao_recusada",
  motivo,
  detalhe: DETALHE,
});
const atencaoAgora = (codigo: ProblemaDe<"crm">): EstadoDuravel<"crm"> => ({
  fase: "atencao",
  problema: { codigo, desde: AGORA, detalhe: DETALHE },
});

interface Linha {
  readonly nome: string;
  readonly de: EstadoCrm;
  readonly evento: EventoCrm;
  readonly agora?: Instante;
  readonly para: EstadoCrm;
  readonly efeitos: readonly EfeitoCrm[];
}

const TABELA: readonly Linha[] = [
  {
    nome: "conectar abre a autorização com prazo de 10 minutos",
    de: desconectado,
    evento: { tipo: "pedido_conectar" },
    para: autorizando,
    efeitos: [{ tipo: "iniciar_autorizacao" }, { tipo: "armar_prazo", ate: EM_10_MIN }],
  },
  {
    nome: "conectar a partir de uma atenção guarda a atenção como anterior",
    de: naoLiberado,
    evento: { tipo: "pedido_conectar" },
    para: { fase: "autorizando", expiraEm: EM_10_MIN, anterior: naoLiberado },
    efeitos: [{ tipo: "iniciar_autorizacao" }, { tipo: "armar_prazo", ate: EM_10_MIN }],
  },
  {
    nome: "retorno aceito conecta e grava",
    de: autorizando,
    evento: { tipo: "retorno_ok", conexaoExpiraEm: FIM_DA_CONEXAO, ferramentas: 18 },
    para: conectadoAgora,
    efeitos: [{ tipo: "esquecer_pendente" }, { tipo: "gravar", estado: conectadoAgora }],
  },
  ...(
    [
      ["app fora da allowlist vira crm_app_nao_liberado", "app_nao_liberado", "crm_app_nao_liberado"],
      ["usuário que nega vira crm_acesso_negado", "acesso_negado", "crm_acesso_negado"],
      ["state ou iss errados viram crm_retorno_invalido", "retorno_invalido", "crm_retorno_invalido"],
      ["descoberta sem resposta vira crm_inacessivel", "inacessivel", "crm_inacessivel"],
    ] as const
  ).map(
    ([nome, motivo, codigo]): Linha => ({
      nome,
      de: autorizando,
      evento: recusa(motivo),
      para: atencaoAgora(codigo),
      efeitos: [{ tipo: "esquecer_pendente" }, { tipo: "gravar", estado: atencaoAgora(codigo) }],
    }),
  ),
  {
    nome: "cancelar volta à fase durável anterior",
    de: { fase: "autorizando", expiraEm: EM_10_MIN, anterior: naoLiberado },
    evento: { tipo: "pedido_cancelar" },
    para: naoLiberado,
    efeitos: [{ tipo: "esquecer_pendente" }],
  },
  {
    nome: "prazo vencido volta à fase durável anterior",
    de: autorizando,
    evento: { tipo: "prazo_vencido" },
    agora: DEPOIS_DE_1_HORA,
    para: desconectado,
    efeitos: [{ tipo: "esquecer_pendente" }],
  },
  {
    nome: "prazo velho não muda a autorização",
    de: autorizando,
    evento: { tipo: "prazo_vencido" },
    para: autorizando,
    efeitos: [],
  },
  {
    nome: "sondagem com token válido renova a verificação",
    de: conectado,
    evento: { tipo: "sondagem", resultado: { token: "ok", ferramentas: 18, conexaoExpiraEm: FIM_DA_CONEXAO } },
    para: conectadoAgora,
    efeitos: [{ tipo: "gravar", estado: conectadoAgora }],
  },
  {
    nome: "refresh recusado vira conexão vencida e apaga o refresh depois da linha",
    de: conectado,
    evento: { tipo: "sondagem", resultado: { token: "recusado" } },
    para: vencida,
    efeitos: [{ tipo: "gravar", estado: vencida }, { tipo: "apagar_refresh" }],
  },
  {
    nome: "linha conectada sem refresh vira conexão vencida",
    de: conectado,
    evento: { tipo: "sondagem", resultado: { token: "ausente" } },
    para: vencida,
    efeitos: [{ tipo: "gravar", estado: vencida }],
  },
  {
    nome: "rede fora não muda a fase durável",
    de: conectado,
    evento: { tipo: "sondagem", resultado: { token: "indeterminado", detalhe: textoExterno("ECONNREFUSED") } },
    para: conectado,
    efeitos: [],
  },
  {
    nome: "refresh órfão sem linha é apagado",
    de: desconectado,
    evento: { tipo: "sondagem", resultado: { token: "ok", ferramentas: 18, conexaoExpiraEm: FIM_DA_CONEXAO } },
    para: desconectado,
    efeitos: [{ tipo: "apagar_refresh" }],
  },
  {
    nome: "desconectar grava a linha antes de apagar o refresh",
    de: conectado,
    evento: { tipo: "pedido_desconectar" },
    para: desconectado,
    efeitos: [{ tipo: "gravar", estado: desconectado }, { tipo: "apagar_refresh" }],
  },
  {
    nome: "testar pede sondagem",
    de: conectado,
    evento: { tipo: "pedido_testar" },
    para: conectado,
    efeitos: [{ tipo: "sondar" }],
  },
];

describe("transicionarCrm", () => {
  test.each(TABELA.map((linha) => [linha.nome, linha] as const))("%s", (_nome, linha) => {
    expect(transicionarCrm(linha.de, linha.evento, linha.agora ?? AGORA)).toEqual({
      estado: linha.para,
      efeitos: linha.efeitos,
    });
  });

  const foraDeHora: readonly (readonly [string, EstadoCrm, EventoCrm])[] = [
    ["segundo conectar não abre segundo fluxo", autorizando, { tipo: "pedido_conectar" }],
    ["retorno sem autorização pendente é ignorado", desconectado, { tipo: "retorno_ok", conexaoExpiraEm: FIM_DA_CONEXAO, ferramentas: 1 }],
    ["recusa sem autorização pendente é ignorada", conectado, recusa("acesso_negado")],
    ["testar em desconectado não faz nada", desconectado, { tipo: "pedido_testar" }],
  ];
  test.each(foraDeHora)("%s", (_nome, estado, evento) => {
    expect(transicionarCrm(estado, evento, AGORA)).toEqual({ estado, efeitos: [] });
  });
});
