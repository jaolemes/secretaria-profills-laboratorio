import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { guardarLeitura, useCarga } from "./comum";

function Tela({ chave }: { chave: string }) {
  const carga = useCarga(chave, () => new Promise<never>(() => {}), 0);
  return <p>{carga.dados === null ? "vazia" : String(carga.dados)}</p>;
}

describe("useCarga", () => {
  test("a tela que volta mostra a última leitura da chave no primeiro quadro, enquanto lê de novo", () => {
    expect(renderToStaticMarkup(<Tela chave="teste:volta" />)).toBe("<p>vazia</p>");
    guardarLeitura("teste:volta", "lida antes");
    expect(renderToStaticMarkup(<Tela chave="teste:volta" />)).toBe("<p>lida antes</p>");
  });

  test("a leitura de outra chave não aparece", () => {
    guardarLeitura("teste:outra", "de outra chave");
    expect(renderToStaticMarkup(<Tela chave="teste:nunca-lida" />)).toBe("<p>vazia</p>");
  });
});
