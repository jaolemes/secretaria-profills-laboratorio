import { release } from "node:os";
import { resolverAmbiente } from "../ambiente";
import { sondarCofreDoSistema } from "../cofre";
import { criarSupervisor } from "../processos";
import { lerTrava } from "./ferramentas";
import { executarPassos, PASSOS, type RelatorioDeInstalacao } from "./passos";

export { PASSOS, executarPassos, type ContextoDaInstalacao, type Passo, type RelatorioDeInstalacao, type ResultadoDoPasso } from "./passos";
export { diferencasDoEspelho, espelharSkills } from "./skills";

/**
 * Prepara esta máquina: confere o Bun e as dependências, cria a pasta de dados, baixa o wacli
 * da trava, migra o banco, escolhe o cofre e gera o espelho das skills. Rodar de novo devolve
 * `ja_estava` em tudo. `SECRETARIA_DADOS` troca a pasta de dados.
 */
export async function instalar(opcoes: { raizDoRepo: string }): Promise<RelatorioDeInstalacao> {
  const ambiente = resolverAmbiente(undefined, opcoes.raizDoRepo);
  const supervisor = criarSupervisor({ plataforma: ambiente.plataforma });
  try {
    return await executarPassos(PASSOS, {
      raizDoRepo: opcoes.raizDoRepo,
      dirDados: ambiente.dirDados,
      plataforma: ambiente.plataforma,
      arquitetura: process.arch,
      versaoDoSistema: release(),
      versaoDoBun: Bun.version,
      trava: lerTrava(opcoes.raizDoRepo),
      supervisor,
      sondarCofre: sondarCofreDoSistema,
      agora: ambiente.agora,
    });
  } finally {
    await supervisor.encerrar();
  }
}
