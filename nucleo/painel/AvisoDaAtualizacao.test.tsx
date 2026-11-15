import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { EstadoDaAtualizacao, VersaoPublicada } from "../atualizacao";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AvisoNoCartao, type ControleDaAtualizacao } from "./AvisoDaAtualizacao";
import { vistaDaAtualizacao } from "./atualizacao";
import { montarCena } from "./dev/cenas";
import { modeloDoMenu } from "./lateral";
import { Lateral, MenuDoCelular } from "./Navegacao";

const agora = new Date("2026-11-15T12:00:00Z");
const EM = agora.toISOString();
const ATAQUE = `<img src=x onerror="alert(1)"> veja https://golpe.example/pagar <a href="https://golpe.example">aqui</a>`;
const NOVA: VersaoPublicada = { versao: "0.2.0", data: "2026-11-20", bunMinimo: "1.4.4", oQueMuda: ["O painel avisa quando tem versão nova da Secretária.", ATAQUE] };
const VERSAO_NOVA: EstadoDaAtualizacao = { fase: "versao_nova", instalada: "0.1.0", conferidaEm: EM, nova: NOVA, impedimento: null, bloqueio: null };
const GRAVANDO = { motivo: "gravando_no_crm", explicacao: "A Secretária está gravando um cartão no CRM. Atualize depois que a gravação terminar." } as const;

const ESTADOS: { readonly [nome: string]: EstadoDaAtualizacao } = {
  em_dia: { fase: "em_dia", instalada: "0.1.0", conferidaEm: EM },
  versao_nova: VERSAO_NOVA,
  bloqueado: { ...VERSAO_NOVA, bloqueio: GRAVANDO },
  desenvolvimento: {
    ...VERSAO_NOVA,
    impedimento: "instalacao_de_desenvolvimento",
    bloqueio: { motivo: "instalacao_de_desenvolvimento", explicacao: "Esta pasta é de desenvolvimento e não se atualiza pelo painel. Peça ao seu agente para instalar a Secretária de novo pelo instalador." },
  },
  bun_antigo: { ...VERSAO_NOVA, impedimento: "bun_antigo", bloqueio: { motivo: "bun_antigo", explicacao: "Esta versão pede uma atualização do instalador. Peça ao seu agente." } },
  atualizando: { fase: "atualizando", instalada: "0.1.0", para: "0.2.0", passo: "reiniciando" },
  atualizado: { fase: "atualizado", instalada: "0.2.0", de: "0.1.0", nucleoMudado: 2, em: EM },
  falhou: { fase: "falhou", instalada: "0.1.0", para: "0.2.0", motivo: "pacote_recusado", explicacao: "O arquivo baixado não é o que a Profills publicou, e a Secretária o descartou.", em: EM, nova: NOVA, bloqueio: null },
  sem_internet: { fase: "sem_internet", instalada: "0.1.0", tentadaEm: EM },
};

function controle(nome: string, ocupado = false): ControleDaAtualizacao {
  return { vista: vistaDaAtualizacao(ESTADOS[nome] ?? null, false), ocupado, esperandoAVolta: false, agir: () => {} };
}

const estadoDoPainel = montarCena("tudo-conectado", agora)!;
const modelo = modeloDoMenu({ tela: "conexoes" }, null, estadoDoPainel, null, agora);

function lateral(nome: string): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Lateral modelo={modelo} quem={null} atualizacao={controle(nome)} />
    </TooltipProvider>,
  );
}

function aviso(nome: string, ocupado = false): string {
  const vista = controle(nome).vista;
  if (vista?.aviso === undefined || vista.aviso === null) throw new Error(`${nome} não tem aviso`);
  return renderToStaticMarkup(<AvisoNoCartao aviso={vista.aviso} ocupado={ocupado} agir={() => {}} />);
}

/** Os botões na ordem em que aparecem, com o rótulo e se estão apagados. */
function botoes(html: string): { rotulo: string; apagado: boolean }[] {
  return [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, atributos = "", miolo = ""]) => ({ rotulo: miolo.replace(/<[^>]+>/g, ""), apagado: /\sdisabled=""/.test(atributos) }));
}

/** Onde o texto aparece no HTML, para conferir a ordem. */
const posicao = (html: string, trecho: string) => {
  const onde = html.indexOf(trecho);
  if (onde < 0) throw new Error(`"${trecho}" não aparece`);
  return onde;
};

const lembrado: Record<string, string> = {};
beforeAll(() => {
  Object.assign(globalThis, { localStorage: { getItem: (chave: string) => lembrado[chave] ?? null, setItem: (chave: string, valor: string) => (lembrado[chave] = valor) } });
});
afterEach(() => {
  for (const chave of Object.keys(lembrado)) delete lembrado[chave];
});
afterAll(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("o aviso no cartão do pé", () => {
  test("em dia: o cartão não ganha linha, e a versão fica na lista das conexões", () => {
    const html = lateral("em_dia");
    expect(html).toContain("Secretária 0.1.0 · em dia");
    expect(html).not.toContain("Tem versão nova");
    expect(html).not.toContain('data-ponto="novidade"');
  });

  test.each(["em_dia", "versao_nova"])("%s: a região que anuncia o aviso já está no cartão antes de ele chegar", (nome) => {
    // Leitor de tela costuma não anunciar uma região que entra no DOM já com o texto.
    expect(lateral(nome)).toMatch(/<div aria-live="polite" data-regiao="atualizacao">/);
    expect(aviso("versao_nova")).not.toContain("aria-live");
  });

  test("versão nova: Tem versão nova antes do Atualizar, em destaque e à direita; a versão nova na lista", () => {
    const html = lateral("versao_nova");
    expect(html).toContain("Secretária 0.1.0 · tem a 0.2.0");
    expect(posicao(html, "Tem versão nova")).toBeLessThan(posicao(html, ">Atualizar<"));
    // O aviso fica acima do resumo das conexões, como no protótipo.
    expect(posicao(html, ">Atualizar<")).toBeLessThan(posicao(html, "Conexões:"));
    expect(botoes(aviso("versao_nova"))).toEqual([{ rotulo: "Atualizar", apagado: false }]);
    expect(aviso("versao_nova")).toContain('data-variant="default"');
    expect(aviso("versao_nova")).toContain("ml-auto");
  });

  test("o O que muda sai como texto, sem marcação nem link", () => {
    const html = lateral("versao_nova");
    expect(html).toContain('aria-label="O que muda"');
    expect(html).toContain("O painel avisa quando tem versão nova da Secretária.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="https://golpe');
    expect(html).toContain("&lt;img");
  });

  test("bloqueado: o Atualizar apagado, apontando para a explicação com o cadeado", () => {
    const html = aviso("bloqueado");
    expect(botoes(html)).toEqual([{ rotulo: "Atualizar", apagado: true }]);
    expect(html).toContain(GRAVANDO.explicacao);
    const descrito = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${descrito}"`);
    expect(posicao(html, GRAVANDO.explicacao)).toBeLessThan(posicao(html, ">Atualizar<"));
  });

  test("pedido em curso ou canal caído: o botão apaga sem explicação", () => {
    expect(botoes(aviso("versao_nova", true))).toEqual([{ rotulo: "Atualizar", apagado: true }]);
  });

  test.each([
    ["desenvolvimento", "Esta pasta é de desenvolvimento e não se atualiza pelo painel. Peça ao seu agente para instalar a Secretária de novo pelo instalador."],
    ["bun_antigo", "Esta versão pede uma atualização do instalador. Peça ao seu agente."],
  ])("%s: Tem versão nova e a frase, sem botão", (nome, frase) => {
    const html = aviso(nome);
    expect(html).toContain("Tem versão nova");
    expect(html).toContain(frase);
    expect(botoes(html)).toEqual([]);
  });

  test("atualizando: o passo, a barra e nenhum botão", () => {
    const html = aviso("atualizando");
    expect(html).toContain("Atualizando para a 0.2.0");
    expect(html).toContain("Reiniciando a Secretária. Vai reiniciar; nada do que você aprovou se perde.");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="85"');
    expect(html).toContain("animate-spin");
    expect(botoes(html)).toEqual([]);
  });

  test("atualizado: a versão nova, a linha do agente e os arquivos guardados, sem botão", () => {
    const html = aviso("atualizado");
    expect(html).toContain("Atualizada para a 0.2.0");
    expect(html).toContain("O agente que já estava aberto segue com as regras antigas até você abrir uma conversa nova.");
    expect(html).toContain("2 arquivos da Secretária tinham sido mudados neste computador. A versão nova os trocou e guardou uma cópia.");
    expect(botoes(html)).toEqual([]);
  });

  test("falhou: o motivo, a versão que segue e Tentar de novo em destaque", () => {
    const html = aviso("falhou");
    expect(html).toContain("Não deu para atualizar");
    expect(html).toContain("O arquivo baixado não é o que a Profills publicou, e a Secretária o descartou. A Secretária continua na 0.1.0 e funciona normalmente.");
    expect(botoes(html)).toEqual([{ rotulo: "Tentar de novo", apagado: false }]);
    expect(html).toContain('data-variant="default"');
  });

  test("sem internet: a frase do desenho e Tentar agora com contorno", () => {
    const html = aviso("sem_internet");
    expect(html).toContain("Não deu para ver se tem versão nova");
    expect(html).toContain("Sem internet agora. A Secretária confere de novo quando você abrir o painel.");
    expect(botoes(html)).toEqual([{ rotulo: "Tentar agora", apagado: false }]);
    expect(html).toContain('data-variant="outline"');
  });
});

describe("a lateral recolhida", () => {
  test("com versão nova: o ícone com o ponto acima de quem usa, que abre a lateral", () => {
    lembrado["secretaria.navegacao-recolhida"] = "1";
    const html = lateral("versao_nova");
    expect(html).toContain('aria-label="Tem versão nova da Secretária"');
    expect(html).toContain('data-ponto="novidade"');
    expect(html).not.toContain(">Atualizar<");
  });

  test("atualizando: o ícone gira, sem ponto", () => {
    lembrado["secretaria.navegacao-recolhida"] = "1";
    const html = lateral("atualizando");
    expect(html).toContain('aria-label="Atualizando a Secretária"');
    expect(html).toContain("animate-spin");
    expect(html).not.toContain('data-ponto="novidade"');
  });

  test("em dia: nenhum ícone de atualização", () => {
    lembrado["secretaria.navegacao-recolhida"] = "1";
    expect(lateral("em_dia")).not.toContain("Secretária ·");
    expect(lateral("em_dia")).not.toContain('data-ponto="novidade"');
  });
});

describe("o Menu do celular", () => {
  const menu = (nome: string) =>
    renderToStaticMarkup(
      <TooltipProvider>
        <MenuDoCelular modelo={modelo} quem={null} atualizacao={controle(nome)} />
      </TooltipProvider>,
    );

  test.each(["versao_nova", "falhou", "atualizado"])("%s: o ponto no Menu e o nome que diz a novidade", (nome) => {
    expect(menu(nome)).toContain('aria-label="Menu, tem novidade"');
    expect(menu(nome)).toContain('data-ponto="novidade"');
  });

  test.each(["em_dia", "atualizando", "sem_internet"])("%s: o Menu sem ponto", (nome) => {
    expect(menu(nome)).not.toContain('data-ponto="novidade"');
    expect(menu(nome)).not.toContain("tem novidade");
  });
});
