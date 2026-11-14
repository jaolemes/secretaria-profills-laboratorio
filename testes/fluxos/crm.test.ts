import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRM_CLIENT_ID_PADRAO } from "../../nucleo/ambiente";
import { historico, lerConector } from "../../nucleo/banco";
import { Segredo } from "../../nucleo/cofre";
import { CAMINHO_DE_RETORNO, type Conectores, type Temporizador } from "../../nucleo/conectores";
import { PRAZOS_MS, acoesPossiveis, type EstadoCrm } from "../../nucleo/dominio";
import { efeitosAssentados, esperar, montarBancada, type Bancada } from "../falsos/bancada";
import { iniciarCrmFalso, type CrmFalso } from "../falsos/crm";

const PORTA = 47_115;
const DUAS_HORAS = 2 * 3_600_000;

// Cada passo abre processos de verdade; num runner lento de CI os 5 s padrão não bastam.
setDefaultTimeout(30_000);

let bancada: Bancada;
let crm: CrmFalso;

function nova(opcoes: { readonly semClientId?: boolean; readonly clientId?: URL } = {}): Bancada {
  crm = iniciarCrmFalso({ agora: () => Date.parse(bancada.ambiente.agora()) });
  bancada = montarBancada({ crmRecurso: crm.recurso, crmClientId: opcoes.semClientId ? null : (opcoes.clientId ?? crm.clientId), porta: PORTA });
  return bancada;
}

afterEach(async () => {
  await bancada.limpar();
  await crm.parar();
  // Token, refresh, código e `code_verifier` não aparecem em log, banco nem em arquivo fora do cofre.
  const registro = bancada.linhasDoRegistro.join("\n");
  for (const segredo of crm.registro().segredos) expect(registro).not.toContain(segredo);
});

function estadoDoCrm(conectores: Conectores): EstadoCrm {
  return conectores.estado().crm;
}

async function pedirUrl(conectores: Conectores): Promise<string> {
  const pedido = await conectores.agir("crm", "conectar");
  if (!pedido.ok || pedido.dados.urlAutorizacao === null) throw new Error(`conectar não devolveu URL: ${JSON.stringify(pedido)}`);
  expect(pedido.dados.estado.fase).toBe("autorizando");
  return pedido.dados.urlAutorizacao;
}

async function conectar(conectores: Conectores): Promise<void> {
  const retorno = await conectores.retornoDoCrm(await crm.autorizar(await pedirUrl(conectores)));
  expect(retorno.ok && retorno.dados.fase).toBe("conectado");
}

async function refreshNoCofre(b: Bancada): Promise<Segredo | null> {
  return b.cofre.ler("crm.refresh_token");
}

describe("CRM: fluxo feliz", () => {
  test("descobre, autoriza com PKCE, troca o código, guarda o refresh e conta as ferramentas", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    expect(estadoDoCrm(conectores)).toEqual({ fase: "desconectado" });

    const url = new URL(await pedirUrl(conectores));
    expect(`${url.origin}${url.pathname}`).toBe(`${crm.origem}/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: crm.clientId.href,
      redirect_uri: `http://127.0.0.1:${PORTA}/oauth/crm/retorno`,
      code_challenge_method: "S256",
      resource: crm.recurso.href,
      scope: "crm.leitura",
    });
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["cancelar"]);
    expect(await refreshNoCofre(b)).toBeNull();

    const query = await crm.autorizar(url.href);
    const retorno = await conectores.retornoDoCrm(query);
    expect(retorno.ok && retorno.dados).toMatchObject({ fase: "conectado", ferramentas: 18 });
    const conectado = estadoDoCrm(conectores);
    if (conectado.fase !== "conectado") throw new Error("não conectou");
    const dias = (Date.parse(conectado.conexaoExpiraEm) - Date.now()) / 86_400_000;
    expect(Math.round(dias)).toBe(90);
    expect(lerConector(b.banco, "crm")).toMatchObject({ fase: "conectado", conexaoExpiraEm: conectado.conexaoExpiraEm });
    expect(await refreshNoCofre(b)).not.toBeNull();
    expect(crm.registro()).toMatchObject({ consultas: 1, consentimentos: 1, trocasDeCodigo: 1, refreshes: 0 });

    // `state` de uso único: o mesmo retorno não abre segunda troca.
    expect(await conectores.retornoDoCrm(query)).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(crm.registro().trocasDeCodigo).toBe(1);
    expect(estadoDoCrm(conectores).fase).toBe("conectado");

    const token = await conectores.tokenValidoDoCrm();
    expect(token).toBeInstanceOf(Segredo);
    expect(`${token}`).toBe("[segredo]");
    expect(JSON.stringify(conectores.estado())).not.toContain("CANARIO");

    crm.botoes.mcpEmSse = true;
    const teste = await conectores.agir("crm", "testar");
    expect(teste.ok && teste.dados.estado).toMatchObject({ fase: "conectado", ferramentas: 18 });
    expect(crm.registro().refreshes).toBe(0);

    const cofre = readFileSync(join(b.dirDados, "cofre.json"), "utf8");
    const { segredos } = crm.registro();
    expect(segredos.filter((segredo) => cofre.includes(segredo))).toHaveLength(1);
    const fora = b.textoDaPastaDeDados();
    for (const segredo of segredos) expect(fora).not.toContain(segredo);

    const fim = await conectores.agir("crm", "desconectar");
    expect(fim.ok && fim.dados.estado).toEqual({ fase: "desconectado" });
    expect(await refreshNoCofre(b)).toBeNull();
    expect(await conectores.tokenValidoDoCrm()).toBeNull();
    expect(lerConector(b.banco, "crm")).toEqual({ fase: "desconectado" });
    expect(historico(b.banco, "crm", 10).map((evento) => evento.tipo)).toEqual(["desconectado", "conectado", "conectado"]);
  });

  test("o documento CIMD do repo atende às regras do CRM", () => {
    const texto = readFileSync(join(import.meta.dir, "..", "..", "nucleo", "conectores", "crm", "cliente-oauth.json"), "utf8");
    const documento = JSON.parse(texto) as Record<string, unknown>;
    expect(Buffer.byteLength(texto)).toBeLessThan(5 * 1024);
    expect(documento.redirect_uris).toEqual([`http://127.0.0.1${CAMINHO_DE_RETORNO}`]);
    expect(documento.token_endpoint_auth_method).toBe("none");
    expect(documento).not.toHaveProperty("client_secret");
    expect(documento.client_id).toBe("https://www.crmprofills.com.br/oauth/apps/secretaria.json");
    expect(CRM_CLIENT_ID_PADRAO).toBe(String(documento.client_id));
  });
});

describe("CRM: renovação do acesso", () => {
  test("dez tokenValido simultâneos fazem um refresh só e a conexão segue viva", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    const refreshInicial = await refreshNoCofre(b);

    b.avancar(DUAS_HORAS);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => conectores.tokenValidoDoCrm()));
    const [primeiro] = tokens;
    expect(primeiro).toBeInstanceOf(Segredo);
    expect(tokens.every((token) => token !== null && primeiro != null && token.igual(primeiro))).toBe(true);
    expect(crm.registro()).toMatchObject({ refreshes: 1, familiasRevogadas: 0 });

    // O refresh rotacionado foi para o cofre antes de o access ser entregue.
    const refreshNovo = await refreshNoCofre(b);
    expect(refreshNovo !== null && refreshInicial !== null && !refreshNovo.igual(refreshInicial)).toBe(true);

    await Promise.all(Array.from({ length: 10 }, () => conectores.tokenValidoDoCrm()));
    expect(crm.registro().refreshes).toBe(1);

    b.avancar(DUAS_HORAS);
    const rodada = await Promise.all([conectores.tokenValidoDoCrm(), conectores.agir("crm", "testar"), conectores.tokenValidoDoCrm()]);
    expect(rodada[0]).toBeInstanceOf(Segredo);
    expect(rodada[1].ok && rodada[1].dados.estado.fase).toBe("conectado");
    expect(crm.registro()).toMatchObject({ refreshes: 2, familiasRevogadas: 0 });
  });

  test("resposta de refresh perdida: repete dentro da janela e não derruba a conexão", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);

    b.avancar(DUAS_HORAS);
    crm.botoes.perderRespostasDoRefresh = 1;
    expect(await conectores.tokenValidoDoCrm()).toBeInstanceOf(Segredo);
    expect(crm.registro()).toMatchObject({ refreshes: 2, familiasRevogadas: 0 });

    const teste = await conectores.agir("crm", "testar");
    expect(teste.ok && teste.dados.estado).toMatchObject({ fase: "conectado", ferramentas: 18 });
    b.avancar(DUAS_HORAS);
    expect(await conectores.tokenValidoDoCrm()).toBeInstanceOf(Segredo);
    expect(crm.registro().familiasRevogadas).toBe(0);
  });

  test("refresh recusado leva a atenção, apaga o refresh e deixa a saída Conectar", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);

    crm.revogarConexoes();
    b.avancar(DUAS_HORAS);
    const tokens = await Promise.all(Array.from({ length: 5 }, () => conectores.tokenValidoDoCrm()));
    expect(tokens).toEqual([null, null, null, null, null]);
    const atencao = await esperar(conectores, (e) => e.crm.fase === "atencao", "atenção");
    expect(atencao.crm).toMatchObject({ problema: { codigo: "crm_conexao_vencida" } });
    expect(acoesPossiveis(atencao.crm)).toEqual(["conectar"]);
    await efeitosAssentados(conectores, "crm");
    expect(await refreshNoCofre(b)).toBeNull();
    expect(historico(b.banco, "crm", 1).map((evento) => evento.tipo)).toEqual(["crm_conexao_vencida"]);

    await conectar(conectores);
    expect(estadoDoCrm(conectores).fase).toBe("conectado");
  });

  test("CRM fora do ar no teste não derruba a conexão", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);

    crm.botoes.foraDoAr = true;
    b.avancar(DUAS_HORAS);
    const teste = await conectores.agir("crm", "testar");
    expect(teste.ok && teste.dados.estado.fase).toBe("conectado");
    expect(await conectores.tokenValidoDoCrm()).toBeNull();
    expect(await refreshNoCofre(b)).not.toBeNull();

    crm.botoes.foraDoAr = false;
    expect(await conectores.tokenValidoDoCrm()).toBeInstanceOf(Segredo);
    expect(crm.registro().familiasRevogadas).toBe(0);
  });

  test("MCP que recusa o token mesmo depois de renovar vira conexão vencida", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    crm.botoes.mcpRecusa = true;
    const teste = await conectores.agir("crm", "testar");
    expect(teste).toMatchObject({ ok: false, erro: { codigo: "crm_conexao_vencida" } });
    expect(crm.registro().refreshes).toBe(1);
    expect(await refreshNoCofre(b)).toBeNull();
  });
});

describe("CRM: recusas", () => {
  test("client fora da allowlist vira crm_app_nao_liberado, com saída", async () => {
    const b = nova();
    crm.botoes.foraDaAllowlist = true;
    const conectores = b.ligar();
    await conectores.pronto;

    const pedido = await conectores.agir("crm", "conectar");
    expect(pedido).toMatchObject({ ok: false, erro: { codigo: "crm_app_nao_liberado" } });
    expect(pedido.ok ? "" : pedido.erro.acao).toContain("administrador do CRM");
    expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_app_nao_liberado" } });
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar"]);
    expect(lerConector(b.banco, "crm")).toMatchObject({ fase: "atencao" });

    crm.botoes.foraDaAllowlist = false;
    await conectar(conectores);
  });

  test.each([
    [401, "crm_app_nao_liberado", ["conectar"]],
    [403, "crm_app_nao_liberado", ["conectar"]],
    [404, "crm_app_nao_liberado", ["conectar"]],
    [500, "crm_inacessivel", ["conectar", "desconectar"]],
    [503, "crm_inacessivel", ["conectar", "desconectar"]],
  ] as const)("o pedido de autorização recebe HTTP %d: vira %s, e Conectar de novo funciona", async (status, codigo, saidas) => {
    const b = nova();
    crm.botoes.statusDoAuthorize = status;
    const conectores = b.ligar();
    await conectores.pronto;

    const pedido = await conectores.agir("crm", "conectar");
    expect(pedido).toMatchObject({ ok: false, erro: { codigo } });
    expect(pedido.ok ? "" : pedido.erro.acao).toContain("Conectar de novo");
    expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo } });
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual([...saidas]);

    crm.botoes.statusDoAuthorize = null;
    await conectar(conectores);
  });

  test("o client_id real, que o CRM ainda não aceita, leva a crm_app_nao_liberado, com Conectar de novo como saída", async () => {
    const b = nova({ clientId: new URL(String(CRM_CLIENT_ID_PADRAO)) });
    const conectores = b.ligar();
    await conectores.pronto;

    for (const tentativa of [1, 2]) {
      const pedido = await conectores.agir("crm", "conectar");
      expect({ tentativa, pedido }).toMatchObject({ tentativa, pedido: { ok: false, erro: { codigo: "crm_app_nao_liberado" } } });
      expect(pedido.ok ? "" : pedido.erro.acao).toContain("Conectar de novo");
      expect(crm.registro().clientesRecusados).toEqual(Array(tentativa).fill(CRM_CLIENT_ID_PADRAO));
      expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_app_nao_liberado" } });
      expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar"]);
      expect(lerConector(b.banco, "crm")).toMatchObject({ fase: "atencao", problema: { codigo: "crm_app_nao_liberado" } });
    }
  });

  test("sem a URL do aplicativo definida, nem chega a falar com o CRM", async () => {
    const b = nova({ semClientId: true });
    const conectores = b.ligar();
    await conectores.pronto;
    expect(await conectores.agir("crm", "conectar")).toMatchObject({ ok: false, erro: { codigo: "crm_app_nao_liberado" } });
    expect(crm.registro().consultas).toBe(0);
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar"]);
  });

  test("o vendedor nega o acesso", async () => {
    const b = nova();
    crm.botoes.usuarioNega = true;
    const conectores = b.ligar();
    await conectores.pronto;
    const retorno = await conectores.retornoDoCrm(await crm.autorizar(await pedirUrl(conectores)));
    expect(retorno).toMatchObject({ ok: false, erro: { codigo: "crm_acesso_negado" } });
    expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_acesso_negado" } });
    expect(crm.registro().trocasDeCodigo).toBe(0);
  });

  test("retorno com `iss` de outro servidor não troca o código", async () => {
    const b = nova();
    crm.botoes.issErrado = true;
    const conectores = b.ligar();
    await conectores.pronto;
    const retorno = await conectores.retornoDoCrm(await crm.autorizar(await pedirUrl(conectores)));
    expect(retorno).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_retorno_invalido" } });
    expect(crm.registro().trocasDeCodigo).toBe(0);
    expect(await refreshNoCofre(b)).toBeNull();
  });

  test("retorno com `state` errado é recusado sem derrubar o login em andamento", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    const url = await pedirUrl(conectores);
    const forjado = new URLSearchParams({ code: "qualquer", state: "state-de-outra-pessoa", iss: crm.origem });
    expect(await conectores.retornoDoCrm(forjado)).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(await conectores.retornoDoCrm(new URLSearchParams())).toMatchObject({ ok: false });
    expect(estadoDoCrm(conectores).fase).toBe("autorizando");

    const retorno = await conectores.retornoDoCrm(await crm.autorizar(url));
    expect(retorno.ok && retorno.dados.fase).toBe("conectado");
  });

  test("CRM fora do ar ao conectar vira crm_inacessivel", async () => {
    const b = nova();
    crm.botoes.foraDoAr = true;
    const conectores = b.ligar();
    await conectores.pronto;
    expect(await conectores.agir("crm", "conectar")).toMatchObject({ ok: false, erro: { codigo: "crm_inacessivel" } });
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar", "desconectar"]);
    crm.botoes.foraDoAr = false;
    await conectar(conectores);
  });

  test("MCP fora na hora do login não deixa refresh guardado", async () => {
    const b = nova();
    crm.botoes.mcpRecusa = true;
    const conectores = b.ligar();
    await conectores.pronto;
    const retorno = await conectores.retornoDoCrm(await crm.autorizar(await pedirUrl(conectores)));
    expect(retorno).toMatchObject({ ok: false, erro: { codigo: "crm_inacessivel" } });
    expect(await refreshNoCofre(b)).toBeNull();
    expect(estadoDoCrm(conectores).fase).toBe("atencao");
  });
});

describe("CRM: cofre com defeito", () => {
  test("se o refresh não pôde ser guardado, o retorno falha sem rejeitar e o cartão tem saída", async () => {
    const b = nova();
    const quebrado = {
      ...b.cofre,
      gravar: async () => {
        throw new Error("chaveiro fora do ar");
      },
    };
    const conectores = b.ligar({}, quebrado);
    await conectores.pronto;
    const retorno = await conectores.retornoDoCrm(await crm.autorizar(await pedirUrl(conectores)));
    expect(retorno).toMatchObject({ ok: false, erro: { codigo: "interno" } });
    expect(estadoDoCrm(conectores).fase).toBe("atencao");
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar"]);
    expect(await conectores.tokenValidoDoCrm()).toBeNull();
  });
});

describe("CRM: cada ação duas vezes e em paralelo", () => {
  test("converge com um pedido de autorização e uma troca de código", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;

    const pedidos = await Promise.all([conectores.agir("crm", "conectar"), conectores.agir("crm", "conectar")]);
    const urls = pedidos.map((pedido) => (pedido.ok ? pedido.dados.urlAutorizacao : null));
    expect(urls[0]).toStartWith(crm.origem);
    expect(urls[1]).toBe(urls[0] ?? "");
    expect(crm.registro().consultas).toBe(1);

    const cancelados = await Promise.all([conectores.agir("crm", "cancelar"), conectores.agir("crm", "cancelar")]);
    expect(cancelados.map((r) => r.ok && r.dados.estado.fase)).toEqual(["desconectado", "desconectado"]);
    // O retorno de um login cancelado não conecta nem guarda nada.
    const atrasado = await conectores.retornoDoCrm(await crm.autorizar(urls[0] ?? ""));
    expect(atrasado).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(await refreshNoCofre(b)).toBeNull();
    expect(estadoDoCrm(conectores)).toEqual({ fase: "desconectado" });

    const query = await crm.autorizar(await pedirUrl(conectores));
    const retornos = await Promise.all([conectores.retornoDoCrm(query), conectores.retornoDoCrm(query)]);
    expect(retornos.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(crm.registro()).toMatchObject({ trocasDeCodigo: 1, familiasRevogadas: 0 });
    expect(estadoDoCrm(conectores).fase).toBe("conectado");

    expect(await conectores.agir("crm", "conectar")).toMatchObject({ ok: false, erro: { codigo: "acao_indisponivel" } });
    const testes = await Promise.all([conectores.agir("crm", "testar"), conectores.agir("crm", "testar")]);
    expect(testes.map((r) => r.ok && r.dados.estado.fase)).toEqual(["conectado", "conectado"]);

    const saidas = await Promise.all([conectores.agir("crm", "desconectar"), conectores.agir("crm", "desconectar")]);
    expect(saidas.map((r) => r.ok && r.dados.estado.fase)).toEqual(["desconectado", "desconectado"]);
    expect(await refreshNoCofre(b)).toBeNull();
  });

  test("desconectar no meio de uma renovação não deixa refresh para trás", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    b.avancar(DUAS_HORAS);
    const [token, saida] = await Promise.all([conectores.tokenValidoDoCrm(), conectores.agir("crm", "desconectar")]);
    expect(saida.ok && saida.dados.estado.fase).toBe("desconectado");
    expect(token).toBeNull();
    expect(await refreshNoCofre(b)).toBeNull();
  });
});

describe("CRM: prazo e queda do servidor", () => {
  test("o prazo da autorização devolve o conector à fase anterior", async () => {
    const b = nova();
    const prazos: (() => void)[] = [];
    const armar: Temporizador = (_ms, disparar) => {
      prazos.push(disparar);
      return () => {};
    };
    const conectores = b.ligar({ armar });
    await conectores.pronto;
    const url = await pedirUrl(conectores);
    b.avancar(PRAZOS_MS.autorizacao + 1_000);
    prazos.at(-1)?.();
    expect(estadoDoCrm(conectores)).toEqual({ fase: "desconectado" });
    expect(await conectores.retornoDoCrm(await crm.autorizar(url))).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(await refreshNoCofre(b)).toBeNull();
  });

  test("queda em autorizando: volta desconectado, o retorno antigo é recusado e Conectar funciona", async () => {
    const b = nova();
    await b.quedaEm([{ id: "crm", acao: "conectar" }], (e) => e.crm.fase === "autorizando");

    const conectores = b.ligar();
    await conectores.pronto;
    expect(estadoDoCrm(conectores)).toEqual({ fase: "desconectado" });
    const orfao = new URLSearchParams({ code: "x", state: "state-do-servidor-que-caiu", iss: crm.origem });
    expect(await conectores.retornoDoCrm(orfao)).toMatchObject({ ok: false, erro: { codigo: "crm_retorno_invalido" } });
    expect(acoesPossiveis(estadoDoCrm(conectores))).toEqual(["conectar"]);
    await conectar(conectores);
  });

  test("refresh no cofre sem linha de conexão é apagado no boot", async () => {
    const b = nova();
    await b.cofre.gravar("crm.refresh_token", Segredo.de("CANARIO-refresh-orfao"));
    const conectores = b.ligar();
    await conectores.pronto;
    expect(estadoDoCrm(conectores)).toEqual({ fase: "desconectado" });
    expect(await refreshNoCofre(b)).toBeNull();
    expect(crm.registro().refreshes).toBe(0);
  });

  test("servidor que sobe de novo conectado renova uma vez e confere o MCP", async () => {
    const b = nova();
    const primeiro = b.ligar();
    await primeiro.pronto;
    await conectar(primeiro);
    await primeiro.parar();

    const segundo = b.ligar();
    expect(estadoDoCrm(segundo)).toMatchObject({ fase: "conectado", ferramentas: null });
    await segundo.pronto;
    expect(estadoDoCrm(segundo)).toMatchObject({ fase: "conectado", ferramentas: 18 });
    expect(crm.registro()).toMatchObject({ refreshes: 1, familiasRevogadas: 0 });
  });

  test("linha conectada sem refresh no cofre vira conexão vencida no boot", async () => {
    const b = nova();
    const primeiro = b.ligar();
    await primeiro.pronto;
    await conectar(primeiro);
    await primeiro.parar();
    await b.cofre.apagar("crm.refresh_token");

    const segundo = b.ligar();
    await segundo.pronto;
    expect(estadoDoCrm(segundo)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_conexao_vencida" } });
    expect(acoesPossiveis(estadoDoCrm(segundo))).toEqual(["conectar"]);
  });
});

describe("CRM: gravar pela fachada", () => {
  const COMPROMISSO = { tool: "criar_compromisso", dados: { titulo: "CANARIO Reunião interna", inicio: "2026-11-16 09:00" } } as const;

  test("fora de conectado, recusa com crm_nao_executou sem abrir a rede", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    expect(estadoDoCrm(conectores).fase).toBe("desconectado");
    expect(await conectores.gravarNoCrm(COMPROMISSO)).toEqual({ tipo: "recusou", erro: { codigo: "crm_nao_executou", detalhe: null } });
    expect(crm.registro().chamadasAoMcp).toBe(0);

    crm.botoes.foraDaAllowlist = true;
    await conectores.agir("crm", "conectar");
    expect(estadoDoCrm(conectores)).toMatchObject({ fase: "atencao", problema: { codigo: "crm_app_nao_liberado" } });
    expect(await conectores.gravarNoCrm(COMPROMISSO)).toMatchObject({ tipo: "recusou", erro: { codigo: "crm_nao_executou" } });
    expect(crm.registro().chamadasAoMcp).toBe(0);
    expect(crm.dados.gravados).toEqual([]);
  });

  test("conectado, grava com o token da conexão e devolve o id do CRM", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    expect(await conectores.gravarNoCrm(COMPROMISSO)).toEqual({ tipo: "gravou", recibo: { id: 70_001, link: null } });
    expect(crm.dados.gravados).toEqual([{ tool: "criar_compromisso", id: 70_001, argumentos: COMPROMISSO.dados }]);
  });

  test("com os conectores parando, recusa sem abrir a rede", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    await conectores.parar();
    const antes = crm.registro().chamadasAoMcp;
    expect(await conectores.gravarNoCrm(COMPROMISSO)).toMatchObject({ tipo: "recusou", erro: { codigo: "crm_nao_executou" } });
    expect(crm.registro().chamadasAoMcp).toBe(antes);
  });

  test("parar no meio da chamada corta a espera: incerto, e o CRM não gravou", async () => {
    const b = nova();
    const conectores = b.ligar();
    await conectores.pronto;
    await conectar(conectores);
    crm.botoes.segurar = new Promise(() => {});
    const chegou = new Promise<void>((resolver) => (crm.botoes.aoChamar = () => resolver()));
    const gravando = conectores.gravarNoCrm(COMPROMISSO);
    await chegou;
    await conectores.parar();
    expect(await gravando).toEqual({ tipo: "incerto", erro: { codigo: "crm_escrita_incerta", detalhe: null } });
    expect(crm.dados.gravados).toEqual([]);
    expect(crm.registro().chamadasDeFerramenta).toHaveLength(1);
  });
});
