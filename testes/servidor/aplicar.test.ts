/**
 * `POST /api/atualizacao/aplicar` contra a release falsa: quem pode, o que segura o botão e o que
 * acontece quando o download ou o pacote falham. Nenhum caso aqui chega a parar o servidor: a troca
 * de ponta a ponta está em `testes/fluxos/aplicar-atualizacao.test.ts`.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EstadoDaAtualizacao } from "../../nucleo/atualizacao";
import type { EstadoPainel } from "../../nucleo/dominio";
import { VERSAO_DO_NUCLEO } from "../../nucleo/servidor";
import { cadastrarClientes } from "../falsos/conversas";
import { iniciarCrmFalso, type CrmFalso } from "../falsos/crm";
import { pacoteCom, subirReleaseFalsa, type OpcoesDaPublicacao, type ReleaseFalsa } from "../falsos/release";
import { NAVEGACAO_DE_TOPO, PAREAR, ESPELHAR, subirPalco, type Palco } from "./palco";

setDefaultTimeout(30_000);

const [MAIOR] = VERSAO_DO_NUCLEO.split(".").map(Number) as [number];
const MAIS_NOVA = `${MAIOR + 1}.0.0`;
const PACOTE = pacoteCom(MAIS_NOVA, { "package.json": JSON.stringify({ name: "secretaria-profills", version: MAIS_NOVA }), "nucleo/marca.txt": `${MAIS_NOVA}\n` });

let palco: Palco | null = null;
let release: ReleaseFalsa | null = null;
let crm: CrmFalso | null = null;
let repo: string | null = null;

afterEach(async () => {
  await palco?.limpar();
  await release?.parar();
  await crm?.parar();
  if (repo !== null) rmSync(repo, { recursive: true, force: true });
  palco = release = crm = repo = null;
});

interface Montado {
  readonly p: Palco;
  readonly r: ReleaseFalsa;
  readonly repo: string;
}

async function subir(opcoes: { readonly publicar?: OpcoesDaPublicacao | null; readonly desenvolvimento?: boolean; readonly crm?: CrmFalso } = {}): Promise<Montado> {
  const r = (release = await subirReleaseFalsa());
  const dirRepo = (repo = mkdtempSync(join(tmpdir(), "secretaria-repo-")));
  if (opcoes.desenvolvimento) mkdirSync(join(dirRepo, ".git"));
  const alvos = opcoes.crm === undefined ? { dirRepo } : { dirRepo, crmRecurso: opcoes.crm.recurso, crmClientId: opcoes.crm.clientId };
  const p = (palco = await subirPalco(alvos, { versoes: r.fonte(2_000) }));
  if (opcoes.publicar !== null) await r.publicar(MAIS_NOVA, { pacote: PACOTE, ...opcoes.publicar });
  return { p, r, repo: dirRepo };
}

type Envelope = { status: number } & ({ ok: true; dados: EstadoDaAtualizacao } | { ok: false; erro: { codigo: string; mensagem: string; acao: string; atual?: EstadoDaAtualizacao } });

async function envelope(resposta: Promise<Response>): Promise<Envelope> {
  const feita = await resposta;
  return { status: feita.status, ...((await feita.json()) as object) } as Envelope;
}

const estado = async (p: Palco) => {
  const lido = await envelope(p.painel("/api/atualizacao"));
  if (!lido.ok) throw new Error(`a API recusou: ${JSON.stringify(lido.erro)}`);
  return lido.dados;
};
const aplicar = (p: Palco, init: RequestInit = {}) => envelope(p.painel("/api/atualizacao/aplicar", { method: "POST", ...init }));
const JSON_NO_CORPO = { "Content-Type": "application/json" };

/** Outra aba: outra entrada pelo bilhete, com cookie próprio. */
async function outraAba(p: Palco): Promise<string> {
  const bilhete = (await (await p.agente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } };
  const entrada = await fetch(bilhete.dados.url, { redirect: "manual", headers: NAVEGACAO_DE_TOPO });
  return (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function esperarFase(p: Palco, fase: EstadoDaAtualizacao["fase"]): Promise<EstadoDaAtualizacao> {
  const eventos = await p.eventosDoPainel();
  try {
    await eventos.ateTexto(`"fase":"${fase}"`, `a atualização em ${fase}`);
  } finally {
    eventos.fechar();
  }
  return estado(p);
}

describe("quem aplica", () => {
  test("o agente recebe so_no_painel e nada é baixado", async () => {
    const { p, r } = await subir();
    await estado(p);
    const lido = await envelope(p.agente("/api/atualizacao/aplicar", { method: "POST" }));
    expect(lido.status).toBe(403);
    expect(lido.ok ? null : lido.erro.codigo).toBe("so_no_painel");
    expect(r.pedidosDoPacote()).toBe(0);
    expect(await estado(p)).toMatchObject({ fase: "versao_nova", bloqueio: null });
  });

  test("sem versão nova conferida, aplicar responde sem_versao_nova", async () => {
    const { p } = await subir({ publicar: null });
    const lido = await aplicar(p);
    expect(lido.status).toBe(409);
    expect(lido.ok ? null : lido.erro.codigo).toBe("sem_versao_nova");
  });
});

describe("o que segura o botão", () => {
  async function bloqueado(p: Palco, motivo: string): Promise<void> {
    const atual = await estado(p);
    expect(atual).toMatchObject({ fase: "versao_nova", bloqueio: { motivo } });
    const lido = await aplicar(p);
    expect(lido.status).toBe(409);
    expect(lido.ok ? null : { codigo: lido.erro.codigo, atual: lido.erro.atual?.fase }).toEqual({ codigo: "atualizacao_bloqueada", atual: "versao_nova" });
    expect(release?.pedidosDoPacote()).toBe(0);
  }

  test("pasta com .git: bloqueada como de desenvolvimento", async () => {
    const { p } = await subir({ desenvolvimento: true });
    await bloqueado(p, "instalacao_de_desenvolvimento");
  });

  test("versão que pede um Bun mais novo: bloqueada, pedindo o instalador", async () => {
    const { p } = await subir({ publicar: { bunMinimo: "99.0.0" } });
    const atual = await estado(p);
    expect(atual.fase === "versao_nova" ? atual.bloqueio?.explicacao : null).toBe("Esta versão pede uma atualização do instalador. Peça ao seu agente.");
    await bloqueado(p, "bun_antigo");
  });

  test("WhatsApp pareando: bloqueada até a conexão terminar ou ser cancelada", async () => {
    const { p } = await subir();
    p.bancada.roteiro({ auth: PAREAR, sync: ESPELHAR });
    const eventos = await p.eventosDoPainel();
    await p.painel("/api/conectores/whatsapp/conectar", { method: "POST", headers: JSON_NO_CORPO, body: JSON.stringify({ meio: "qr" }) });
    await eventos.ate((e: EstadoPainel) => e.conectores.whatsapp.estado.fase === "pareando", "pareando");
    await bloqueado(p, "whatsapp_conectando");
    await p.painel("/api/conectores/whatsapp/cancelar", { method: "POST" });
    await eventos.ate((e: EstadoPainel) => e.conectores.whatsapp.estado.fase === "desconectado", "cancelado");
    eventos.fechar();
    expect(await estado(p)).toMatchObject({ fase: "versao_nova", bloqueio: null });
  });

  describe("com o CRM conectado", () => {
    async function subirComCrm(publicar: OpcoesDaPublicacao = {}): Promise<Montado & { readonly crm: CrmFalso }> {
      let montado: Montado | null = null;
      const falso = (crm = iniciarCrmFalso({ agora: () => Date.parse(montado === null ? new Date().toISOString() : montado.p.bancada.ambiente.agora()) }));
      montado = await subir({ crm: falso, publicar });
      cadastrarClientes(falso);
      const { p } = montado;
      const eventos = await p.eventosDoPainel();
      const destino = (await p.painel("/oauth/crm/iniciar")).headers.get("location");
      if (destino === null) throw new Error("o painel não abriu o login do CRM");
      await p.cru(`/oauth/crm/retorno?${await falso.autorizar(destino)}`, { headers: { "Sec-Fetch-Site": "cross-site" } });
      await eventos.ate((e: EstadoPainel) => e.conectores.crm.estado.fase === "conectado", "CRM conectado");
      eventos.fechar();
      return { ...montado, crm: falso };
    }

    function segurarOCrm(falso: CrmFalso, ferramenta: string | null): { readonly chegou: Promise<void>; soltar(): void } {
      let soltar = () => {};
      falso.botoes.segurar = new Promise<void>((resolver) => (soltar = resolver));
      const chegou = new Promise<void>((resolver) => (falso.botoes.aoChamar = (nome) => (ferramenta === null || nome === ferramenta) && resolver()));
      return { chegou, soltar };
    }

    async function propor(p: Palco): Promise<{ readonly id: string; readonly hash: string; readonly versao: number }> {
      const proposto = (await (
        await p.agente("/api/escritas", {
          method: "POST",
          headers: JSON_NO_CORPO,
          body: JSON.stringify({ tool: "registrar_atendimento", dados: { cliente_id: 9201, assunto: "Ligação sobre o pedido", status: "Pendente", descricao: "Combinou retorno na sexta." } }),
        })
      ).json()) as { dados: { id: string; hash: string; versao: number } };
      return proposto.dados;
    }

    const aprovar = (p: Palco, { id, hash, versao }: { readonly id: string; readonly hash: string; readonly versao: number }) =>
      p.painel(`/api/escritas/${id}/aprovar`, { method: "POST", headers: JSON_NO_CORPO, body: JSON.stringify({ hash, versao }) });

    test("cartão em gravando: bloqueada até o CRM responder", async () => {
      const { p, crm: falso } = await subirComCrm();
      const cartao = await propor(p);
      const crmSegurado = segurarOCrm(falso, "registrar_atendimento");
      const aprovado = aprovar(p, cartao);
      await crmSegurado.chegou;
      await bloqueado(p, "gravando_no_crm");
      crmSegurado.soltar();
      expect((await aprovado).status).toBe(200);
      expect(await estado(p)).toMatchObject({ fase: "versao_nova", bloqueio: null });
    });

    test("sincronização rodando: bloqueada até a leitura terminar", async () => {
      const { p, crm: falso } = await subirComCrm();
      const crmSegurado = segurarOCrm(falso, null);
      const sincronizando = p.painel("/api/sincronizar", { method: "POST" });
      await crmSegurado.chegou;
      await bloqueado(p, "sincronizando");
      falso.botoes.segurar = null;
      crmSegurado.soltar();
      expect((await sincronizando).status).toBe(200);
      expect(await estado(p)).toMatchObject({ fase: "versao_nova", bloqueio: null });
    });

    test("com a atualização em curso, aprovar, sincronizar e conectar esperam ela acabar", async () => {
      let soltar = () => {};
      const segurar = new Promise<void>((resolver) => (soltar = resolver));
      const { p, crm: falso } = await subirComCrm({ pacoteAdulterado: new Uint8Array([1, 2, 3]), segurarPacote: segurar });
      const cartao = await propor(p);
      p.bancada.roteiro({ auth: PAREAR, sync: ESPELHAR });
      await estado(p);
      expect(await aplicar(p)).toMatchObject({ status: 200, dados: { fase: "atualizando", passo: "baixando" } });
      const chamadas: string[] = [];
      falso.botoes.aoChamar = (nome) => void chamadas.push(nome);
      const recusas = await Promise.all([
        envelope(aprovar(p, cartao)),
        envelope(p.painel("/api/sincronizar", { method: "POST" })),
        envelope(p.agente("/api/sincronizar", { method: "POST" })),
        envelope(p.painel("/api/conectores/whatsapp/conectar", { method: "POST", headers: JSON_NO_CORPO, body: JSON.stringify({ meio: "qr" }) })),
      ]);
      expect(recusas.map((lido) => [lido.status, lido.ok ? null : lido.erro.codigo])).toEqual(Array(4).fill([409, "atualizacao_em_andamento"]));
      expect(chamadas).toEqual([]);
      const visto = (await (await p.agente(`/api/escritas/${cartao.id}`)).json()) as { dados: { estado: string } };
      expect(visto.dados.estado).toBe("rascunho");
      const painel = (await (await p.painel("/api/estado")).json()) as { dados: EstadoPainel };
      expect(painel.dados.conectores.whatsapp.estado.fase).toBe("desconectado");
      const eventos = await p.eventosDoPainel();
      soltar();
      await eventos.ateTexto('"fase":"falhou"', "a falha pelo SSE");
      eventos.fechar();
      expect((await aprovar(p, cartao)).status).toBe(200);
    });
  });
});

describe("antes de parar", () => {
  test("o pacote não chega: falhou sem internet, nada extraído, e a versão nova continua para tentar de novo", async () => {
    const { p, r, repo: dirRepo } = await subir({ publicar: null });
    await r.publicar(MAIS_NOVA);
    await estado(p);
    const lido = await aplicar(p);
    expect(lido).toMatchObject({ status: 200, ok: true, dados: { fase: "atualizando", para: MAIS_NOVA, passo: "baixando" } });
    expect(await esperarFase(p, "falhou")).toMatchObject({ fase: "falhou", para: MAIS_NOVA, motivo: "sem_internet", nova: { versao: MAIS_NOVA }, bloqueio: null });
    expect(existsSync(join(dirRepo, ".atualizacao", "nova"))).toBe(false);
  });

  test("pacote adulterado: recusado antes de extrair qualquer arquivo", async () => {
    const { p, r, repo: dirRepo } = await subir({ publicar: { pacoteAdulterado: pacoteCom(MAIS_NOVA, { "package.json": "{}", "nucleo/marca.txt": "outro\n" }) } });
    await estado(p);
    expect(await aplicar(p)).toMatchObject({ status: 200, ok: true });
    expect(await esperarFase(p, "falhou")).toMatchObject({ motivo: "pacote_recusado" });
    expect(r.pedidosDoPacote()).toBe(1);
    expect(existsSync(join(dirRepo, ".atualizacao", "nova"))).toBe(false);
  });

  test("as dependências não instalam: falhou, e o servidor segue no ar na versão de antes", async () => {
    const quebrado = pacoteCom(MAIS_NOVA, { "package.json": '{"name":"secretaria-profills","version":', "nucleo/marca.txt": `${MAIS_NOVA}\n` });
    const { p } = await subir({ publicar: { pacote: quebrado } });
    await estado(p);
    expect(await aplicar(p)).toMatchObject({ status: 200, ok: true });
    expect(await esperarFase(p, "falhou")).toMatchObject({ motivo: "dependencias_falharam", explicacao: "Não deu para preparar a versão nova. Confira a internet e tente de novo." });
    expect((await (await p.cru("/api/info")).json()) as unknown).toMatchObject({ dados: { versaoNucleo: VERSAO_DO_NUCLEO } });
  });

  test("o atualizador não começa: o servidor segue no ar e apaga o aviso de preparado", async () => {
    const { p, repo: dirRepo } = await subir();
    await estado(p);
    expect(await aplicar(p)).toMatchObject({ status: 200, ok: true });
    expect(await esperarFase(p, "falhou")).toMatchObject({ motivo: "atualizador_nao_comecou", nova: { versao: MAIS_NOVA } });
    expect(existsSync(join(dirRepo, ".atualizacao", "andamento.json"))).toBe(false);
    expect(existsSync(join(dirRepo, ".atualizacao", "nova", "node_modules"))).toBe(true);
    expect((await p.cru("/api/info")).status).toBe(200);
  });

  test("dois cliques e duas abas: uma atualização só, e o passo sai pelo SSE", async () => {
    let soltar = () => {};
    const segurar = new Promise<void>((resolver) => (soltar = resolver));
    const { p, r } = await subir({ publicar: { pacoteAdulterado: new Uint8Array([1, 2, 3]), segurarPacote: segurar } });
    await estado(p);
    const eventos = await p.eventosDoPainel();
    const outra = await outraAba(p);
    const [primeiro, segundo, daOutraAba] = await Promise.all([aplicar(p), aplicar(p), aplicar(p, { headers: { Cookie: outra } })]);
    for (const lido of [primeiro, segundo, daOutraAba]) expect(lido).toMatchObject({ status: 200, ok: true, dados: { fase: "atualizando", passo: "baixando" } });
    await eventos.ateTexto('"fase":"atualizando"', "o passo pelo SSE");
    soltar();
    await eventos.ateTexto('"fase":"falhou"', "a falha pelo SSE");
    eventos.fechar();
    expect(r.pedidosDoPacote()).toBe(1);
    expect(eventos.textos.join("")).toContain("event: atualizacao");
  });
});

describe("depois do restart", () => {
  function gravarAndamento(dirRepo: string, andamento: Record<string, unknown>): void {
    const pasta = join(dirRepo, ".atualizacao");
    mkdirSync(pasta, { recursive: true });
    const agora = new Date().toISOString();
    const base = { v: 1, de: VERSAO_DO_NUCLEO, para: MAIS_NOVA, iniciadoEm: agora, atualizadoEm: agora, trocas: [], restaurarDados: true, mudados: null };
    writeFileSync(join(pasta, "andamento.json"), JSON.stringify({ ...base, ...andamento }));
  }

  test("a volta que o atualizador gravou vira falhou com o motivo dele, e a versão nova continua para tentar de novo", async () => {
    const { p, repo: dirRepo } = await subir();
    await estado(p);
    gravarAndamento(dirRepo, { fase: "desfeito", falha: { passo: "trocar", motivo: "troca_falhou", detalhe: "EBUSY" } });
    await p.reiniciar();
    expect(await estado(p)).toMatchObject({
      fase: "falhou",
      para: MAIS_NOVA,
      motivo: "troca_falhou",
      explicacao: "Um arquivo da Secretária estava em uso na hora da troca. Feche o que estiver aberto na pasta dela e tente de novo.",
      nova: { versao: MAIS_NOVA },
    });
  });

  test("um resultado de mais de 10 minutos antes da subida não aparece", async () => {
    const { p, repo: dirRepo } = await subir();
    await estado(p);
    const antigo = new Date(Date.now() - 11 * 60_000).toISOString();
    gravarAndamento(dirRepo, { fase: "desfeito", atualizadoEm: antigo, falha: { passo: "trocar", motivo: "troca_falhou", detalhe: "" } });
    await p.reiniciar();
    expect(await estado(p)).toMatchObject({ fase: "versao_nova" });
  });

  test("o agente lê o estado novo, e o diagnóstico traz a fase e a versão", async () => {
    const { p, repo: dirRepo } = await subir();
    await estado(p);
    gravarAndamento(dirRepo, { fase: "desfeito", falha: { passo: "instalar", motivo: "instalar_falhou", detalhe: "" } });
    await p.reiniciar();
    const lido = (await (await p.agente("/api/atualizacao")).json()) as { dados: EstadoDaAtualizacao };
    expect(lido.dados).toMatchObject({ fase: "falhou", motivo: "instalar_falhou" });
    expect(lido.dados.fase === "falhou" ? lido.dados.nova?.oQueMuda[0] : null).toStartWith("Texto que veio de fora");
    const diagnostico = (await (await p.agente("/api/diagnostico")).json()) as { dados: { atualizacao: unknown } };
    expect(diagnostico.dados.atualizacao).toMatchObject({ fase: "falhou", versaoNova: MAIS_NOVA, impedimento: null });
  });
});
