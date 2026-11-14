import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gravarConversasLidas, gravarVinculoConsultado, prepararBanco, type BancoAberto } from "../banco";
import { falha, montarMensagem, ok, textoExterno, vinculoDe, type ConversaLida, type EstadoWhatsapp, type Instante, type Mensagem, type Resultado, type Telefone } from "../dominio";
import { criarRegistro } from "../registro";
import { criarSincronizador, type LeitorDeConversas } from "./sincronizacao";

const AGORA = "2026-11-13T15:00:00.000Z" as Instante;
const pastas: string[] = [];
const abertos: BancoAberto[] = [];

afterEach(() => {
  for (const aberto of abertos.splice(0)) aberto.fechar();
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function banco(): BancoAberto {
  const pasta = mkdtempSync(join(tmpdir(), "secretaria-sincronizacao-"));
  pastas.push(pasta);
  const aberto = prepararBanco({ caminho: join(pasta, "secretaria.db"), caminhoDoVendedor: join(pasta, "meu.db"), dirBackups: join(pasta, "backups"), pastaDoVendedor: join(pasta, "meu"), agora: AGORA });
  abertos.push(aberto);
  return aberto;
}

const telefone = (n: number) => `+5541999990${String(n).padStart(3, "0")}` as Telefone;
const jid = (n: number) => `${telefone(n).slice(1)}@s.whatsapp.net`;
const minutosAntes = (m: number) => new Date(Date.parse(AGORA) - m * 60_000).toISOString() as Instante;

function doCliente(n: number, em: Instante): Mensagem {
  return montarMensagem({ id: `3EB0CANARIO${n}`, conversa: jid(n), daConta: false, em, apagada: false, reacaoA: "", emoji: "", tipoDeMidia: "", legenda: "", textoDeExibicao: "qual o prazo?", textoCru: "qual o prazo?", arquivo: "", botoes: [], trecho: "", remetente: "", nomeDoRemetente: "" });
}

const lidaAntes = (n: number): ConversaLida => ({
  conversa: jid(n),
  telefone: telefone(n),
  nome: null,
  ultimaMensagemEm: minutosAntes(600),
  contaFalouEm: null,
  situacao: { tipo: "responder", desde: minutosAntes(600), novas: 1, em_quarentena: false, mensagens_em_quarentena: [], sinais: [], tem_ilegiveis: false, mais_que_o_lido: false },
});

describe("fonte conversas: prazo da rodada", () => {
  test("da mais recente para a mais antiga; o prazo corta a leitura em voo, e o que não deu tempo fica com a leitura anterior e cortado", async () => {
    const b = banco();
    for (const n of [1, 2, 3]) gravarVinculoConsultado(b, vinculoDe("whatsapp", telefone(n), { estado: "auto", cliente: { id: n, nome: textoExterno(`Cliente ${n}`), cidade: null, uf: null } }, AGORA));
    gravarConversasLidas(b, { cortado: false, itens: [lidaAntes(2), lidaAntes(3)] }, minutosAntes(600));

    const pedidas: string[] = [];
    const sinais: (AbortSignal | undefined)[] = [];
    const whatsapp: LeitorDeConversas = {
      estado: () => ({ fase: "conectado" }) as EstadoWhatsapp,
      // A conversa 1 é a mais recente; a 3, a mais antiga.
      listarConversas: async () => ok([1, 2, 3].map((n) => ({ jid: jid(n), tipo: "direta" as const, nome: textoExterno(""), sinaisDoNome: [], ultimaMensagemEm: minutosAntes(n), naoLida: false, naoLidas: 0 })) as never),
      resolverIdentidades: async () => ok([]),
      async ultimasMensagens(conversa, _limite, sinal): Promise<Resultado<{ readonly mensagens: readonly Mensagem[]; readonly ilegiveis: number }>> {
        pedidas.push(conversa);
        sinais.push(sinal);
        if (conversa === jid(1)) return ok({ mensagens: [doCliente(1, minutosAntes(1))], ilegiveis: 0 });
        // A conversa 2 trava até o prazo cortar; sem sinal, solta sozinha e o teste falha pela situação.
        await new Promise<void>((resolver) => {
          if (sinal === undefined) setTimeout(resolver, 500);
          else sinal.addEventListener("abort", () => resolver(), { once: true });
        });
        return sinal?.aborted === true ? falha("prazo_esgotado") : ok({ mensagens: [], ilegiveis: 0 });
      },
    };
    const sincronizador = criarSincronizador({
      banco: b,
      registro: criarRegistro({ escrever: () => {}, agora: () => AGORA }),
      whatsapp,
      email: { estado: () => ({ pulado: false, contas: [] }), coletar: async () => falha("interno") },
      agora: () => AGORA,
      estadoDoCrm: () => ({ fase: "desconectado" }) as never,
      leitor: () => {
        throw new Error("o CRM está desconectado");
      },
      aoAndar: () => {},
      prazoDaRodadaMs: 200,
    });

    const rodada = await sincronizador.sincronizar();
    expect(rodada.fontes.find((f) => f.fonte === "conversas")).toMatchObject({ situacao: "leu", cortado: true });
    expect(pedidas).toEqual([jid(1), jid(2)]);
    expect(sinais[1]?.aborted).toBe(true);
    const itens = sincronizador.conversas()?.itens ?? [];
    expect(itens.map((item) => item.telefone)).toEqual([telefone(1), telefone(2), telefone(3)]);
    expect(itens[0]?.situacao).toMatchObject({ tipo: "responder", desde: minutosAntes(1) });
    expect(itens[1]).toEqual(lidaAntes(2));
    expect(itens[2]).toEqual(lidaAntes(3));
  });
});
