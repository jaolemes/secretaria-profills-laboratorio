/**
 * Roda antes de todo arquivo de teste. Um processo que herde o ambiente do teste sem trocar a
 * pasta de dados cairia na pasta de dados de quem roda os testes. Este caminho fica dentro do
 * checkout, que `conferirPastaDeDados` recusa: o engano falha na hora, sem criar nada.
 */
import { join } from "node:path";

process.env.SECRETARIA_DADOS = join(import.meta.dir, "..", "pasta-de-dados-nao-definida-pelo-teste");
