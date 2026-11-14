import { expect, test } from "bun:test";
import { Segredo } from "../cofre";
import { criarRegistro } from "./index";

function capturar() {
  const linhas: string[] = [];
  const registro = criarRegistro({ escrever: (linha) => linhas.push(linha), agora: () => "2026-11-11T12:00:00.000Z" });
  return { registro, linhas, ultima: () => JSON.parse(linhas.at(-1) ?? "null") };
}

test("cada evento vira uma linha JSON com nível e campos planos", () => {
  const { registro, ultima } = capturar();
  registro.aviso("espelho_reiniciado", { tentativa: 2, papel: "whatsapp.espelho", desistiu: false });
  expect(ultima()).toEqual({
    em: "2026-11-11T12:00:00.000Z",
    nivel: "aviso",
    evento: "espelho_reiniciado",
    campos: { tentativa: 2, papel: "whatsapp.espelho", desistiu: false },
  });
});

test("objeto, lista e Segredo são recusados pelo tipo e pela execução", () => {
  const { registro, linhas, ultima } = capturar();
  // @ts-expect-error o registro só aceita string, número e booleano
  registro.erro("falha", { segredo: Segredo.de("CANARIO-REGISTRO") });
  // @ts-expect-error objeto inteiro não entra no registro
  registro.erro("falha", { corpo: { senha: "CANARIO-REGISTRO" } });
  // @ts-expect-error lista também não
  registro.info("lista", { itens: ["CANARIO-REGISTRO"] });
  expect(linhas.join("\n")).not.toContain("CANARIO");
  expect(ultima().campos).toEqual({ itens: "[recusado]" });
});
