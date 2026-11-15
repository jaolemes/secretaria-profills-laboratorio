/**
 * O atualizador de verdade, morto sem aviso num ponto escolhido, como numa queda de luz. Roda como
 * `[process.execPath, "testes/falsos/atualizador-que-cai.ts", <raiz>, <pasta de dados>, <fase>, <renames>]`.
 * Sem `<renames>`, morre ao entrar na fase. Com ele, morre logo depois desse tanto de renames
 * dentro da fase: é a queda no meio da troca. Com a fase `concluido-nunca`, morre com o servidor
 * da versão nova já respondendo, antes de gravar o fim.
 */
import { atualizar, efeitosReais, type Fase } from "../../nucleo/atualizador";

const [raizDoRepo = "", dirDados = "", alvo = "", renames = ""] = process.argv.slice(2);
const reais = efeitosReais();
let fase: Fase | null = null;
let feitos = 0;

function cair(): never {
  process.kill(process.pid, "SIGKILL");
  process.exit(137);
}

await atualizar(
  { raizDoRepo, dirDados },
  {
    ...reais,
    renomear(de, para) {
      reais.renomear(de, para);
      feitos += 1;
      if (renames !== "" && fase === alvo && feitos === Number(renames)) cair();
    },
    async versaoNoAr(dados, pid) {
      const versao = await reais.versaoNoAr(dados, pid);
      if (alvo === "concluido-nunca" && versao !== null) cair();
      return versao;
    },
    observar(andamento) {
      if (andamento.fase !== fase) feitos = 0;
      fase = andamento.fase;
      if (renames === "" && fase === alvo) cair();
    },
  },
);
