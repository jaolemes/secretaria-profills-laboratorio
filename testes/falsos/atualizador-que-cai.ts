/**
 * O atualizador de verdade, morto sem aviso num ponto escolhido, como numa queda de luz. Roda como
 * `[process.execPath, "testes/falsos/atualizador-que-cai.ts", <raiz>, <pasta de dados>, <fase>, <entrada>]`.
 * Sem `<entrada>`, morre ao entrar na fase. Com ela, morre dentro da fase logo depois do primeiro
 * rename que tira ou põe essa entrada da troca: é a queda no meio da troca. Com a fase
 * `concluido-nunca`, morre com o servidor da versão nova já respondendo, antes de gravar o fim. Com
 * `servidor-nascendo`, morre logo depois de subir o servidor da versão nova, antes de ele responder.
 */
import path from "node:path";
import { atualizar, caminhosDoAtualizador, efeitosReais, type Fase } from "../../nucleo/atualizador";

const [raizDoRepo = "", dirDados = "", alvo = "", entrada = ""] = process.argv.slice(2);
const reais = efeitosReais();
const { nova, anterior } = caminhosDoAtualizador(raizDoRepo, dirDados);
const lugaresDaEntrada = entrada === "" ? [] : [raizDoRepo, nova, anterior].map((base) => path.join(base, ...entrada.split("/")));
let fase: Fase | null = null;
let subiu = false;

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
      if (fase === alvo && (lugaresDaEntrada.includes(de) || lugaresDaEntrada.includes(para))) cair();
    },
    subirServidor(raiz, dados) {
      const servidor = reais.subirServidor(raiz, dados);
      subiu = true;
      return servidor;
    },
    async versaoNoAr(dados, pid) {
      if (alvo === "servidor-nascendo") cair();
      const versao = await reais.versaoNoAr(dados, pid);
      if (alvo === "concluido-nunca" && versao !== null) cair();
      return versao;
    },
    observar(andamento) {
      fase = andamento.fase;
      if (alvo === "servidor-nascendo" && subiu) cair();
      if (entrada === "" && fase === alvo) cair();
    },
  },
);
