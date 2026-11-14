import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerEnderecoEmail, type ContaEmail, type IdContaEmail, type Instante } from "../dominio";
import {
  MigracaoRecusada,
  PASTA_DO_NUCLEO,
  abrirBanco,
  garantirInstalacao,
  gravarContaEmail,
  gravarEmailPulado,
  historicoDaConta,
  inserirContaEmail,
  lerEmailPulado,
  listarContasEmail,
  migrar,
  mudarContaEmail,
  prepararBanco,
  removerContaEmail,
  type BancoAberto,
} from "./index";

const AGORA = "2026-11-11T12:00:00.000Z" as Instante;
const DEPOIS = "2026-11-11T12:05:00.000Z" as Instante;
const pastas: string[] = [];
const abertos: BancoAberto[] = [];

afterEach(() => {
  for (const banco of abertos.splice(0)) banco.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function pastaTemporaria(): string {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-email-banco-"));
  pastas.push(pasta);
  return pasta;
}

function preparar(pasta: string): BancoAberto {
  const banco = prepararBanco({
    caminho: join(pasta, "secretaria.db"),
    caminhoDoVendedor: join(pasta, "meu.db"),
    dirBackups: join(pasta, "backups"),
    pastaDoVendedor: join(pasta, "meu"),
    agora: AGORA,
  });
  abertos.push(banco);
  garantirInstalacao(banco, AGORA);
  return banco;
}

function fechar(banco: BancoAberto): void {
  banco.fechar();
  abertos.splice(abertos.indexOf(banco), 1);
}

function conta(rotulo: string, endereco: string, extra: Partial<ContaEmail> = {}): ContaEmail {
  return {
    id: crypto.randomUUID() as IdContaEmail,
    rotulo,
    provedor: "outro",
    config: { endereco: lerEnderecoEmail(endereco)!, servidor: "imap.exemplo.test", porta: 993, seguranca: "tls" },
    janelaDias: 30,
    ...extra,
  };
}

/** Um banco como o desta versão antes das contas: migrações até a 0003, com a conta única na linha `email`. */
function bancoDaContaUnica(pasta: string, linha: { fase: string; identidade: string | null; config: string | null; codigo?: string; verificado?: string }) {
  const antigas = join(pasta, "migracoes-antigas");
  mkdirSync(antigas, { recursive: true });
  for (const nome of readdirSync(PASTA_DO_NUCLEO).filter((nome) => nome.endsWith(".sql") && nome < "0004")) {
    copyFileSync(join(PASTA_DO_NUCLEO, nome), join(antigas, nome));
  }
  const banco = abrirBanco(join(pasta, "secretaria.db"));
  migrar(banco.sqlite, { trilha: "nucleo", pasta: antigas, dirBackups: join(pasta, "backups"), agora: AGORA });
  banco.sqlite.run(
    "UPDATE conector SET fase = ?, identidade = ?, config = ?, codigo_problema = ?, verificado_em = ?, atualizado_em = ? WHERE id = 'email'",
    [linha.fase, linha.identidade, linha.config, linha.codigo ?? null, linha.verificado ?? null, AGORA],
  );
  banco.sqlite.run("INSERT INTO evento_conector (conector, tipo, detalhe, em) VALUES ('email', 'conectado', '{\"causa\":\"teste_ok\"}', ?)", [AGORA]);
  banco.fechar();
}

const CONFIG_ANTIGA = JSON.stringify({ servidor: "imap.kinghost.net", porta: 993, seguranca: "tls" });

describe("migração da conta única", () => {
  test("a conta conectada vira a conta Profills, com estado, configuração, trilha e a marca da senha antiga", () => {
    const pasta = pastaTemporaria();
    bancoDaContaUnica(pasta, { fase: "conectado", identidade: "vendedor@empresa.test", config: CONFIG_ANTIGA, verificado: AGORA });
    const banco = preparar(pasta);
    const [migrada, ...outras] = listarContasEmail(banco);
    expect(outras).toEqual([]);
    expect(migrada).toMatchObject({
      conta: {
        rotulo: "Profills",
        provedor: "profills",
        janelaDias: 30,
        config: { endereco: "vendedor@empresa.test", servidor: "imap.kinghost.net", porta: 993, seguranca: "tls" },
      },
      estado: { fase: "conectado", verificadoEm: AGORA, caixaDeEntrada: null },
      senhaLegada: true,
    });
    expect(migrada?.conta.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(historicoDaConta(banco, migrada!.conta.id, 10).map((evento) => evento.tipo)).toEqual(["conectado"]);
    expect(banco.sqlite.query("SELECT id FROM conector ORDER BY id").all()).toEqual([{ id: "crm" }, { id: "whatsapp" }]);
    expect(banco.sqlite.query("SELECT count(*) AS n FROM evento_conector WHERE conector = 'email'").get()).toEqual({ n: 0 });
  });

  test("a conta em atenção leva o problema; Gmail é reconhecido pelo servidor", () => {
    const pasta = pastaTemporaria();
    const gmail = JSON.stringify({ servidor: "imap.gmail.com", porta: 993, seguranca: "tls" });
    bancoDaContaUnica(pasta, { fase: "atencao", identidade: "nome@gmail.com", config: gmail, codigo: "email_senha_recusada" });
    const [migrada] = listarContasEmail(preparar(pasta));
    expect(migrada).toMatchObject({ conta: { provedor: "gmail" }, estado: { fase: "atencao", problema: { codigo: "email_senha_recusada" } } });
  });

  test.each([
    ["desconectada", { fase: "desconectado", identidade: null, config: null }],
    ["em atenção sem endereço", { fase: "atencao", identidade: null, config: null, codigo: "email_servidor_inacessivel" }],
    ["com config torta", { fase: "conectado", identidade: "v@empresa.test", config: '{"servidor":"x","porta":"993","seguranca":"tls"}', verificado: AGORA }],
  ])("sem conta de verdade (%s), nada vai para a lista", (_nome, linha) => {
    const pasta = pastaTemporaria();
    bancoDaContaUnica(pasta, linha);
    const banco = preparar(pasta);
    expect(listarContasEmail(banco)).toEqual([]);
    expect(banco.sqlite.query("SELECT count(*) AS n FROM conector WHERE id = 'email'").get()).toEqual({ n: 0 });
  });

  test("rodar duas vezes não cria segunda conta", () => {
    const pasta = pastaTemporaria();
    bancoDaContaUnica(pasta, { fase: "conectado", identidade: "vendedor@empresa.test", config: CONFIG_ANTIGA, verificado: AGORA });
    const primeira = listarContasEmail(preparar(pasta));
    fechar(abertos[0]!);
    const segunda = listarContasEmail(preparar(pasta));
    expect(segunda).toEqual(primeira);
    expect(segunda).toHaveLength(1);
  });

  test("queda no meio da migração não deixa nada pela metade, e a próxima subida termina", () => {
    const pasta = pastaTemporaria();
    bancoDaContaUnica(pasta, { fase: "conectado", identidade: "vendedor@empresa.test", config: CONFIG_ANTIGA, verificado: AGORA });
    // O último comando da migração falha: tudo o que veio antes nela precisa voltar atrás.
    const sabotado = abrirBanco(join(pasta, "secretaria.db"));
    sabotado.sqlite.run("CREATE TRIGGER sabotagem BEFORE DELETE ON conector BEGIN SELECT RAISE(ABORT, 'queda simulada'); END");
    sabotado.fechar();
    expect(() => preparar(pasta)).toThrow(MigracaoRecusada);
    abertos.splice(0);

    const conferir = abrirBanco(join(pasta, "secretaria.db"));
    expect(conferir.sqlite.query("SELECT tag FROM __migracoes_nucleo WHERE tag = '0005_email_conta_unica'").all()).toEqual([]);
    expect(conferir.sqlite.query("SELECT count(*) AS n FROM email_conta").get()).toEqual({ n: 0 });
    expect(conferir.sqlite.query("SELECT count(*) AS n FROM evento_email").get()).toEqual({ n: 0 });
    expect(conferir.sqlite.query("SELECT identidade FROM conector WHERE id = 'email'").get()).toEqual({ identidade: "vendedor@empresa.test" });
    conferir.sqlite.run("DROP TRIGGER sabotagem");
    conferir.fechar();

    const [migrada] = listarContasEmail(preparar(pasta));
    expect(migrada).toMatchObject({ conta: { rotulo: "Profills" }, estado: { fase: "conectado" }, senhaLegada: true });
  });

  test("instalação nova não cria conta e não pula o e-mail", () => {
    const banco = preparar(pastaTemporaria());
    expect(listarContasEmail(banco)).toEqual([]);
    expect(lerEmailPulado(banco)).toBe(false);
  });
});

describe("contas de e-mail no banco", () => {
  test("rótulo e endereço não se repetem, sem diferença de maiúscula", () => {
    const banco = preparar(pastaTemporaria());
    expect(inserirContaEmail(banco, conta("Profills", "vendedor@empresa.test"), AGORA).ok).toBe(true);
    expect(inserirContaEmail(banco, conta("profills", "outro@empresa.test"), AGORA)).toMatchObject({ ok: false, erro: { codigo: "email_rotulo_repetido" } });
    expect(inserirContaEmail(banco, conta("Pessoal", "Vendedor@Empresa.test"), AGORA)).toMatchObject({ ok: false, erro: { codigo: "email_endereco_repetido" } });
    expect(listarContasEmail(banco)).toHaveLength(1);
    // A conferência do código é a primeira barreira; o índice único segura quem escrever direto.
    expect(() =>
      banco.sqlite.run(
        "INSERT INTO email_conta (id, rotulo, provedor, endereco, servidor, porta, seguranca, criada_em, atualizado_em) VALUES (?, 'PROFILLS', 'outro', 'x@y.test', 's', 993, 'tls', 'a', 'a')",
        [crypto.randomUUID()],
      ),
    ).toThrow(/UNIQUE/);
  });

  test("teto de 5 contas", () => {
    const banco = preparar(pastaTemporaria());
    for (let i = 1; i <= 5; i++) expect(inserirContaEmail(banco, conta(`Conta ${i}`, `c${i}@empresa.test`), AGORA).ok).toBe(true);
    expect(inserirContaEmail(banco, conta("Sexta", "c6@empresa.test"), AGORA)).toMatchObject({ ok: false, erro: { codigo: "email_limite_de_contas" } });
    expect(listarContasEmail(banco).map((linha) => linha.conta.rotulo)).toEqual(["Conta 1", "Conta 2", "Conta 3", "Conta 4", "Conta 5"]);
  });

  test("estado, configuração nova, rótulo e janela sobrevivem a fechar e abrir; cada conta é independente", () => {
    const pasta = pastaTemporaria();
    const banco = preparar(pasta);
    const a = conta("Profills", "vendedor@empresa.test");
    const b = conta("Pessoal", "nome@pessoal.test", { janelaDias: 90 });
    inserirContaEmail(banco, a, AGORA);
    inserirContaEmail(banco, b, AGORA);
    const nova = { ...a.config, servidor: "imap.novo.test", porta: 143, seguranca: "starttls" as const };
    gravarContaEmail(banco, a.id, { fase: "conectado", verificadoEm: DEPOIS, caixaDeEntrada: null }, nova, "teste_ok", DEPOIS);
    gravarContaEmail(banco, b.id, { fase: "atencao", problema: { codigo: "email_gmail_senha_de_app", desde: DEPOIS } }, undefined, "sondagem", DEPOIS);
    expect(mudarContaEmail(banco, a.id, { rotulo: "Trabalho", janelaDias: 60 }, DEPOIS).ok).toBe(true);
    fechar(banco);

    const [lidaA, lidaB] = listarContasEmail(preparar(pasta));
    expect(lidaA).toEqual({
      conta: { ...a, rotulo: "Trabalho", janelaDias: 60, config: nova },
      estado: { fase: "conectado", verificadoEm: DEPOIS, caixaDeEntrada: null },
      senhaLegada: false,
    });
    expect(lidaB).toMatchObject({ conta: { ...b }, estado: { fase: "atencao", problema: { codigo: "email_gmail_senha_de_app" } } });
  });

  test("mudar rótulo para um repetido é recusado; a própria conta pode trocar maiúscula", () => {
    const banco = preparar(pastaTemporaria());
    const a = conta("Profills", "a@empresa.test");
    inserirContaEmail(banco, a, AGORA);
    inserirContaEmail(banco, conta("Pessoal", "b@empresa.test"), AGORA);
    expect(mudarContaEmail(banco, a.id, { rotulo: "PESSOAL" }, AGORA)).toMatchObject({ ok: false, erro: { codigo: "email_rotulo_repetido" } });
    expect(mudarContaEmail(banco, a.id, { rotulo: "PROFILLS" }, AGORA).ok).toBe(true);
    expect(mudarContaEmail(banco, crypto.randomUUID() as IdContaEmail, { janelaDias: 60 }, AGORA)).toMatchObject({ ok: false, erro: { codigo: "nao_encontrado" } });
  });

  test("CHECKs recusam janela, fase e provedor fora da lista", () => {
    const banco = preparar(pastaTemporaria());
    const a = conta("Profills", "a@empresa.test");
    inserirContaEmail(banco, a, AGORA);
    for (const sql of [
      "UPDATE email_conta SET janela_dias = 45",
      "UPDATE email_conta SET fase = 'testando'",
      "UPDATE email_conta SET provedor = 'yahoo'",
      "UPDATE email_conta SET fase = 'atencao'",
      "UPDATE email_conta SET fase = 'conectado'",
      "UPDATE email_conta SET rotulo = '   '",
    ]) {
      expect(() => banco.sqlite.run(sql)).toThrow(/CHECK constraint failed/);
    }
  });

  test("remover apaga a conta e a trilha dela, sem tocar na outra", () => {
    const banco = preparar(pastaTemporaria());
    const a = conta("Profills", "a@empresa.test");
    const b = conta("Pessoal", "b@empresa.test");
    inserirContaEmail(banco, a, AGORA);
    inserirContaEmail(banco, b, AGORA);
    removerContaEmail(banco, a.id);
    expect(listarContasEmail(banco).map((linha) => linha.conta.id)).toEqual([b.id]);
    expect(historicoDaConta(banco, a.id, 10)).toEqual([]);
    expect(historicoDaConta(banco, b.id, 10).map((evento) => evento.tipo)).toEqual(["adicionada"]);
  });

  test("pular é persistido e reversível, só sem conta; adicionar uma conta desfaz o pular", () => {
    const pasta = pastaTemporaria();
    const banco = preparar(pasta);
    expect(gravarEmailPulado(banco, true, AGORA).ok).toBe(true);
    fechar(banco);
    const reaberto = preparar(pasta);
    expect(lerEmailPulado(reaberto)).toBe(true);
    expect(gravarEmailPulado(reaberto, false, AGORA).ok).toBe(true);
    expect(lerEmailPulado(reaberto)).toBe(false);

    gravarEmailPulado(reaberto, true, AGORA);
    inserirContaEmail(reaberto, conta("Profills", "a@empresa.test"), AGORA);
    expect(lerEmailPulado(reaberto)).toBe(false);
    expect(gravarEmailPulado(reaberto, true, AGORA)).toMatchObject({ ok: false, erro: { codigo: "email_pular_com_contas" } });
    expect(lerEmailPulado(reaberto)).toBe(false);
  });
});
