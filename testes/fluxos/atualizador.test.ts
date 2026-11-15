/**
 * O atualizador em processos de verdade, numa instalação mínima em pasta temporária com a própria
 * pasta de dados: o `main.ts` da versão nova troca a pasta, roda o `instalar` e sobe o servidor.
 * Na queda, quem volta é o `abrir` de verdade.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolverAmbiente } from "../../nucleo/ambiente";
import { atualizar, caminhosDoAtualizador, efeitosReais, lerAndamento, type Andamento } from "../../nucleo/atualizador";
import { COMANDOS, type ContextoDoCli } from "../../nucleo/cli/comandos";
import type { Resultado } from "../../nucleo/dominio";
import { montarInstalacao, retratoDaPasta, type InstalacaoMinima } from "../falsos/instalacao-minima";

const REPO = join(import.meta.dir, "..", "..");
const PRAZO_DO_TESTE_MS = 60_000;

let instalacao: InstalacaoMinima;
afterEach(() => instalacao.limpar());

function rodarProcesso(argv: string[]): { readonly codigo: number | null; readonly stdout: string; readonly stderr: string } {
  const feito = Bun.spawnSync(argv, { cwd: instalacao.raiz, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return { codigo: feito.exitCode, stdout: feito.stdout.toString(), stderr: feito.stderr.toString() };
}

/** O atualizador como o servidor o sobe: o arquivo que veio na versão nova, com a raiz e a pasta de dados. */
function atualizarPelaNova() {
  return rodarProcesso([process.execPath, join(instalacao.nova, "nucleo", "atualizador", "main.ts"), "--repo", instalacao.raiz, "--dados", instalacao.dirDados]);
}

function andamentoNoDisco(): Andamento {
  const lido = lerAndamento(caminhosDoAtualizador(instalacao.raiz, instalacao.dirDados).andamento);
  if (lido.tipo !== "lido") throw new Error(`o andamento está ${lido.tipo}`);
  return lido.andamento;
}

const abrir = COMANDOS.find((comando) => comando.nome === "abrir");

/** O `abrir` de verdade apontado para a instalação mínima: é ele que acha o andamento e termina a volta. */
function rodarAbrir(): Promise<Resultado<unknown>> {
  if (abrir === undefined) throw new Error("o comando abrir sumiu");
  const { raiz, dirDados } = instalacao;
  const ctx: ContextoDoCli = {
    ambiente: () => resolverAmbiente({ plataforma: process.platform, env: { SECRETARIA_DADOS: dirDados }, home: dirDados }, raiz),
    raizDoRepo: raiz,
    subida: { argv: [process.execPath, join(raiz, "nucleo", "cli", "main.ts"), "servidor", "--json", "--dados", dirDados], prazoMs: 20_000 },
    manterVivo: () => {},
  };
  return abrir.executar({ semNavegador: true }, ctx, null);
}

describe("o atualizador num processo próprio", () => {
  test(
    "a 0.1.0 vira a 0.2.0: o servidor novo responde, a migração nova rodou e o que é do vendedor fica igual byte a byte",
    async () => {
      instalacao = montarInstalacao();
      const doVendedor = instalacao.doVendedor();
      const daNova = retratoDaPasta(instalacao.nova);

      const saida = atualizarPelaNova();

      if (saida.codigo !== 0) throw new Error(`o atualizador saiu com ${saida.codigo}: ${saida.stderr}${saida.stdout}`);
      expect(JSON.parse(saida.stdout)).toMatchObject({ tipo: "concluida", andamento: { de: "0.1.0", para: "0.2.0", fase: "concluido" } });
      expect(saida.codigo).toBe(0);
      expect(await instalacao.versaoNoAr()).toBe("0.2.0");
      expect(instalacao.pidDoServidor()).not.toBeNull();
      expect(instalacao.doVendedor()).toEqual(doVendedor);
      const depois = retratoDaPasta(instalacao.raiz);
      expect(Object.fromEntries(Object.entries(depois).filter(([caminho]) => !(caminho in doVendedor)))).toEqual(daNova);

      await instalacao.pararServidor();
      expect(instalacao.retratoDosBancos()).toMatchObject({
        nucleo: { migracoes: [{ tag: "0001_base" }, { tag: "0002_nova" }], notas: [{ texto: "anotado antes da atualização" }] },
        meu: { visitas: [{ cliente: "cliente do vendedor" }] },
      });
    },
    PRAZO_DO_TESTE_MS,
  );

  test(
    "o instalar da versão nova falha depois de migrar: a 0.1.0 volta ao ar com o banco de antes",
    async () => {
      instalacao = montarInstalacao({ naNova: { "instalar-falha": "" } });
      const pasta = retratoDaPasta(instalacao.raiz);
      const daNova = retratoDaPasta(instalacao.nova);
      const bancos = instalacao.retratoDosBancos();

      const saida = atualizarPelaNova();

      expect(JSON.parse(saida.stdout)).toMatchObject({
        tipo: "desfeita",
        servidorNoAr: true,
        andamento: { fase: "desfeito", falha: { passo: "instalar", motivo: "instalar_falhou" } },
      });
      expect(saida.codigo).toBe(1);
      expect(await instalacao.versaoNoAr()).toBe("0.1.0");
      expect(retratoDaPasta(instalacao.raiz)).toEqual(pasta);
      expect(retratoDaPasta(instalacao.nova)).toEqual(daNova);
      await instalacao.pararServidor();
      expect(instalacao.retratoDosBancos()).toEqual(bancos);
    },
    PRAZO_DO_TESTE_MS,
  );
});

describe("matar o atualizador e rodar abrir volta à 0.1.0", () => {
  const quedas: readonly (readonly [string, { readonly fase: string; readonly renames?: number; readonly naNova?: Record<string, string>; readonly passo: string; readonly motivo: string }])[] = [
    ["ao esperar o banco", { fase: "esperar_banco", passo: "esperar_banco", motivo: "interrompida" }],
    ["ao preparar", { fase: "preparar", passo: "preparar", motivo: "interrompida" }],
    ["ao copiar", { fase: "copiar", passo: "copiar", motivo: "interrompida" }],
    ["ao começar a troca", { fase: "trocar", passo: "trocar", motivo: "interrompida" }],
    ["com as dependências antigas já fora e as novas ainda não no lugar", { fase: "trocar", renames: 1, passo: "trocar", motivo: "interrompida" }],
    ["no meio da troca", { fase: "trocar", renames: 8, passo: "trocar", motivo: "interrompida" }],
    ["antes do instalar", { fase: "instalar", passo: "instalar", motivo: "interrompida" }],
    ["depois de migrar o banco, antes de subir", { fase: "subir", passo: "subir", motivo: "interrompida" }],
    ["no meio da volta de um instalar que falhou", { fase: "desfazer", naNova: { "instalar-falha": "" }, passo: "instalar", motivo: "instalar_falhou" }],
  ];

  test.each(quedas)(
    "queda %s",
    async (_nome, queda) => {
      instalacao = montarInstalacao({ naNova: queda.naNova });
      const pasta = retratoDaPasta(instalacao.raiz);
      const daNova = retratoDaPasta(instalacao.nova);
      const bancos = instalacao.retratoDosBancos();

      rodarProcesso([process.execPath, join(REPO, "testes", "falsos", "atualizador-que-cai.ts"), instalacao.raiz, instalacao.dirDados, queda.fase, String(queda.renames ?? "")]);
      expect(andamentoNoDisco().fase).toBe(queda.fase as Andamento["fase"]);
      expect(instalacao.pidDoServidor()).toBeNull();

      const aberto = await rodarAbrir();

      expect(aberto).toMatchObject({ ok: true, dados: { subiu: true, atualizacaoDesfeita: { de: "0.1.0", para: "0.2.0" } } });
      expect(abrir?.descrever(aberto.ok ? aberto.dados : null)).toStartWith("Uma atualização da Secretária parou no meio e foi desfeita: ela segue na versão 0.1.0.");
      expect(await instalacao.versaoNoAr()).toBe("0.1.0");
      expect(andamentoNoDisco()).toMatchObject({ fase: "desfeito", falha: { passo: queda.passo, motivo: queda.motivo } });
      expect(retratoDaPasta(instalacao.raiz)).toEqual(pasta);
      expect(retratoDaPasta(instalacao.nova)).toEqual(daNova);

      const deNovo = await rodarAbrir();
      expect(deNovo).toMatchObject({ ok: true, dados: { subiu: false } });
      expect(deNovo.ok && (deNovo.dados as { atualizacaoDesfeita?: unknown }).atualizacaoDesfeita).toBeUndefined();

      await instalacao.pararServidor();
      expect(instalacao.retratoDosBancos()).toEqual(bancos);
    },
    PRAZO_DO_TESTE_MS,
  );

  test(
    "abrir com o atualizador vivo responde atualizacao_em_andamento e não mexe em nada",
    async () => {
      instalacao = montarInstalacao();
      let chegou = () => {};
      let soltar = () => {};
      const noInstalar = new Promise<void>((resolver) => (chegou = resolver));
      const segurando = new Promise<void>((resolver) => (soltar = resolver));
      const reais = efeitosReais();
      const atualizando = atualizar(
        { raizDoRepo: instalacao.raiz, dirDados: instalacao.dirDados },
        {
          ...reais,
          async instalar(raizDoRepo, dirDados, prazoMs) {
            chegou();
            await segurando;
            return reais.instalar(raizDoRepo, dirDados, prazoMs);
          },
        },
      );
      await noInstalar;

      const aberto = await rodarAbrir();
      expect(aberto).toMatchObject({ ok: false, erro: { codigo: "atualizacao_em_andamento" } });
      expect(instalacao.pidDoServidor()).toBeNull();

      soltar();
      expect((await atualizando).tipo).toBe("concluida");
      expect(await instalacao.versaoNoAr()).toBe("0.2.0");
    },
    PRAZO_DO_TESTE_MS,
  );

  test(
    "abrir com o servidor da versão nova já no ar só grava o fim da atualização",
    async () => {
      instalacao = montarInstalacao();
      rodarProcesso([process.execPath, join(REPO, "testes", "falsos", "atualizador-que-cai.ts"), instalacao.raiz, instalacao.dirDados, "concluido-nunca"]);
      expect(andamentoNoDisco().fase).toBe("subir");
      expect(await instalacao.versaoNoAr()).toBe("0.2.0");

      const aberto = await rodarAbrir();

      expect(aberto).toMatchObject({ ok: true, dados: { subiu: false } });
      expect(andamentoNoDisco()).toMatchObject({ fase: "concluido", falha: null });
      expect(await instalacao.versaoNoAr()).toBe("0.2.0");
    },
    PRAZO_DO_TESTE_MS,
  );
});
