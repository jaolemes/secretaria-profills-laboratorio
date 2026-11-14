/**
 * Servidor que ficou preso no boot: abriu o banco, anunciou o pid e nunca chegou a atender.
 * Roda como `[process.execPath, "testes/falsos/servidor-preso.ts", <pasta de dados>]` e escreve
 * "preso" em stdout quando já segura o banco.
 */
import { caminhosDosDados } from "../../nucleo/ambiente";
import { abrirBanco } from "../../nucleo/banco";
import { assumirPid } from "../../nucleo/servidor/arquivo";

if (import.meta.main) {
  const caminhos = caminhosDosDados({ dirDados: process.argv[2] ?? "", plataforma: process.platform });
  const banco = abrirBanco(caminhos.banco);
  assumirPid(caminhos.pid);
  process.stdout.write("preso\n");
  // Um servidor travado também não atende sinal educado.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
  // O intervalo segura a referência: banco sem dono é fechado pelo coletor e solta o lock.
  setInterval(() => banco.caminho, 60_000);
}
