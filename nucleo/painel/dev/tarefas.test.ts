import { describe, expect, test } from "bun:test";
import type { Tarefa } from "../../tarefas";
import { contador, montarBlocos } from "../meu-dia";
import { montarCena } from "./cenas";
import { criarLoja } from "./tarefas";

const agora = () => new Date("2026-11-11T15:00:00Z");
const cena = montarCena("tudo-conectado", agora())!;
const conectores = { whatsapp: cena.conectores.whatsapp.estado, crm: cena.conectores.crm.estado, email: cena.email };

describe("fixtures de tarefas do dev server", () => {
  const contagens = (dia: Parameters<typeof montarBlocos>[0]) => montarBlocos(dia).map(({ definicao, conteudo }) => [definicao.id, contador(conteudo).texto]);

  test("vazio tem os blocos de tarefa em zero", () => {
    expect(contagens(criarLoja("vazio", agora).meuDia(conectores)).slice(0, 2)).toEqual([
      ["fazer-hoje", "0"],
      ["sem-data", "0"],
    ]);
  });

  test("atrasadas tem as duas atrasadas antes da de hoje, e o bloco Sem data", () => {
    const dia = criarLoja("atrasadas", agora).meuDia(conectores);
    expect(dia.fazer_hoje.map((t) => t.situacao)).toEqual(["atrasada", "atrasada", "hoje"]);
    expect(contagens(dia).slice(0, 2)).toEqual([
      ["fazer-hoje", "3"],
      ["sem-data", "1"],
    ]);
  });

  test("agente tem tarefas sugeridas pelo agente no dia", () => {
    const dia = criarLoja("agente", agora).meuDia(conectores);
    expect([...dia.fazer_hoje, ...dia.sem_data].filter((t) => t.origem === "agente")).toHaveLength(2);
  });

  test("conflito recusa a primeira ação com a tarefa atual e aceita a repetição com a versão nova", () => {
    const loja = criarLoja("conflito", agora);
    const alvo = loja.meuDia(conectores).fazer_hoje[0]!;
    const primeira = loja.agir(alvo.id, "descartar", { versao: alvo.versao });
    expect(primeira.ok).toBe(false);
    if (primeira.ok) return;
    expect(primeira.erro.codigo).toBe("conflito_de_versao");
    const atual = primeira.erro.atual as Tarefa;
    expect(atual.versao).toBe(alvo.versao + 1);
    const segunda = loja.agir(alvo.id, "descartar", { versao: atual.versao });
    expect(segunda.ok && segunda.dados.tarefa.estado).toBe("descartada");
  });

  test("concluir com próximo passo cria a seguinte com o cliente herdado", () => {
    const loja = criarLoja("atrasadas", agora);
    const alvo = loja.meuDia(conectores).fazer_hoje[0]!;
    const feito = loja.agir(alvo.id, "concluir", { versao: alvo.versao, proximoPasso: "Ligar de novo" });
    expect(feito.ok && feito.dados.seguinte?.clienteNome).toBe(alvo.clienteNome!);
  });
});
