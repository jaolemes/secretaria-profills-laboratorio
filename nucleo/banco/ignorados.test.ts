import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diaEm, textoExterno, voltaEm, type Dia, type Instante, type MarcaDeIgnorado, type TipoDeIgnorado } from "../dominio";
import { PASTA_DO_NUCLEO, abrirBanco, apagarCache, desfazerIgnorado, gravarCache, ignorarItem, ignoradosValendo, lerCache, migrar, prepararBanco, type BancoAberto } from "./index";

const pastas: string[] = [];
const abertos: BancoAberto[] = [];

function banco(): BancoAberto {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-ignorados-"));
  pastas.push(pasta);
  const aberto = prepararBanco({
    caminho: join(pasta, "secretaria.db"),
    caminhoDoVendedor: join(pasta, "meu.db"),
    dirBackups: join(pasta, "backups"),
    pastaDoVendedor: join(pasta, "meu"),
    agora: "2026-11-13T12:00:00.000Z" as Instante,
  });
  abertos.push(aberto);
  return aberto;
}

afterEach(() => {
  for (const aberto of abertos.splice(0)) aberto.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

const ids = (b: BancoAberto, hoje: Dia) => {
  const valendo = ignoradosValendo(b, hoje);
  const doTipo = (tipo: TipoDeIgnorado) => valendo.filter((marca) => marca.tipo === tipo).map((marca) => marca.id);
  return { proposta: doTipo("proposta"), cliente: doTipo("cliente") };
};

const marca = (tipo: TipoDeIgnorado, id: number, ate: Dia, extra: Partial<MarcaDeIgnorado> = {}): MarcaDeIgnorado => ({
  tipo,
  id,
  ate,
  nome: textoExterno(`CANARIO ${id}`),
  codigo: null,
  quem: "vendedor",
  motivo: null,
  ...extra,
});

describe("item ignorado no Meu dia", () => {
  test("vale 7 dias de Brasília: ignorado às 23h30 de 13/11 volta à meia-noite de 20/11", () => {
    const b = banco();
    // 23h30 de 13/11 em Brasília já é 14/11 em UTC.
    const ignoradoEm = "2026-11-14T02:30:00.000Z" as Instante;
    expect(diaEm(ignoradoEm)).toBe("2026-11-13" as Dia);
    const ate = voltaEm(ignoradoEm);
    expect(ate).toBe("2026-11-20" as Dia);
    ignorarItem(b, marca("proposta", 7004, ate), ignoradoEm);

    expect(ids(b, diaEm("2026-11-20T02:59:00.000Z" as Instante))).toEqual({ proposta: [7004], cliente: [] });
    expect(ids(b, diaEm("2026-11-20T03:00:00.000Z" as Instante))).toEqual({ proposta: [], cliente: [] });
    // A marca vencida saiu do banco: voltar o relógio não a traz de novo.
    expect(ids(b, "2026-11-14" as Dia)).toEqual({ proposta: [], cliente: [] });
  });

  test("desfazer tira a marca e diz se havia uma", () => {
    const b = banco();
    ignorarItem(b, marca("cliente", 8002, "2026-11-20" as Dia), "2026-11-13T12:00:00.000Z" as Instante);
    expect(desfazerIgnorado(b, "proposta", 8002)).toBe(false);
    expect(desfazerIgnorado(b, "cliente", 8002)).toBe(true);
    expect(desfazerIgnorado(b, "cliente", 8002)).toBe(false);
    expect(ids(b, "2026-11-13" as Dia)).toEqual({ proposta: [], cliente: [] });
  });

  test("apagar o cache do CRM não apaga a marca", () => {
    const b = banco();
    const agora = "2026-11-13T12:00:00.000Z" as Instante;
    gravarCache(b, "carteira", "atual", { itens: [] }, agora);
    ignorarItem(b, marca("cliente", 8001, "2026-11-20" as Dia, { quem: "agente", motivo: "Está de férias até dezembro." }), agora);
    apagarCache(b);
    expect(lerCache(b, "carteira", "atual")).toBeNull();
    expect(ignoradosValendo(b, "2026-11-13" as Dia)).toEqual([
      { tipo: "cliente", id: 8001, nome: textoExterno("CANARIO 8001"), codigo: null, quem: "agente", motivo: "Está de férias até dezembro.", ate: "2026-11-20" as Dia },
    ]);
  });

  test("o banco recusa marca do agente sem motivo e motivo fora do tamanho", () => {
    const b = banco();
    const agora = "2026-11-13T12:00:00.000Z" as Instante;
    expect(() => ignorarItem(b, marca("cliente", 8001, "2026-11-20" as Dia, { quem: "agente" }), agora)).toThrow(/item_ignorado_motivo_do_agente/);
    expect(() => ignorarItem(b, marca("cliente", 8001, "2026-11-20" as Dia, { motivo: "nao" }), agora)).toThrow(/item_ignorado_motivo/);
    expect(ids(b, "2026-11-13" as Dia)).toEqual({ proposta: [], cliente: [] });
  });

  test("o vendedor ignorar de novo o que o agente ignorou troca quem e apaga o motivo", () => {
    const b = banco();
    const agora = "2026-11-13T12:00:00.000Z" as Instante;
    ignorarItem(b, marca("proposta", 7003, "2026-11-20" as Dia, { quem: "agente", motivo: "Cliente pediu uma semana." }), agora);
    ignorarItem(b, marca("proposta", 7003, "2026-11-20" as Dia), agora);
    expect(ignoradosValendo(b, "2026-11-13" as Dia)).toMatchObject([{ id: 7003, quem: "vendedor", motivo: null }]);
  });

  test("a migração 0008 guarda a marca que já existia, como do vendedor", () => {
    const pasta = mkdtempSync(join(tmpdir(), "secretaria-ignorados-"));
    pastas.push(pasta);
    const migracoes = join(pasta, "migracoes");
    cpSync(PASTA_DO_NUCLEO, migracoes, { recursive: true });
    rmSync(join(migracoes, "0008_quem_ignorou.sql"));
    rmSync(join(migracoes, "0009_vinculo_de_conversa.sql"));
    const antigo = abrirBanco(join(pasta, "secretaria.db"));
    abertos.push(antigo);
    const opcoes = { trilha: "nucleo" as const, pasta: migracoes, dirBackups: join(pasta, "backups"), agora: "2026-11-13T12:00:00.000Z" as Instante };
    migrar(antigo.sqlite, opcoes);
    antigo.sqlite.run("INSERT INTO item_ignorado (tipo, crm_id, ate, criado_em) VALUES ('proposta', 7004, '2026-11-20', '2026-11-13T12:00:00.000Z')");

    expect(migrar(antigo.sqlite, { ...opcoes, pasta: PASTA_DO_NUCLEO }).aplicadas).toEqual(["0008_quem_ignorou", "0009_vinculo_de_conversa"]);
    expect(ignoradosValendo(antigo, "2026-11-13" as Dia)).toEqual([
      { tipo: "proposta", id: 7004, nome: textoExterno(""), codigo: null, quem: "vendedor", motivo: null, ate: "2026-11-20" as Dia },
    ]);
  });

  test("ignorar de novo empurra a data, sem linha repetida", () => {
    const b = banco();
    ignorarItem(b, marca("proposta", 1, "2026-11-15" as Dia), "2026-11-08T12:00:00.000Z" as Instante);
    ignorarItem(b, marca("proposta", 1, "2026-11-20" as Dia), "2026-11-13T12:00:00.000Z" as Instante);
    expect(ids(b, "2026-11-16" as Dia)).toEqual({ proposta: [1], cliente: [] });
    expect(b.sqlite.query("SELECT count(*) AS n FROM item_ignorado").get()).toEqual({ n: 1 });
  });
});
