import { createHash, timingSafeEqual } from "node:crypto";

const REDIGIDO = "[segredo]";

/**
 * Igualdade que não vaza, pelo tempo de resposta, em que byte os dois textos divergem.
 * O sha256 dos dois lados dá entradas do mesmo tamanho ao `timingSafeEqual`.
 */
export function mesmoTexto(a: string, b: string): boolean {
  const resumo = (texto: string) => createHash("sha256").update(texto).digest();
  return timingSafeEqual(resumo(a), resumo(b));
}

/**
 * Valor secreto em memória. `JSON.stringify`, template string, concatenação, `console.log`
 * e `Bun.inspect` devolvem "[segredo]". O valor só sai por `revelar`, que a conferência de
 * fronteiras permite apenas no cofre e nos arquivos que falam com a rede.
 */
export class Segredo {
  readonly #valor: string;

  private constructor(valor: string) {
    this.#valor = valor;
  }

  /** Borda de entrada: corpo do formulário, resposta do token endpoint, backend do cofre. */
  static de(valor: string): Segredo {
    return new Segredo(valor);
  }

  revelar(): string {
    return this.#valor;
  }

  igual(outro: Segredo): boolean {
    return mesmoTexto(this.#valor, outro.#valor);
  }

  toJSON(): string {
    return REDIGIDO;
  }

  toString(): string {
    return REDIGIDO;
  }

  [Symbol.toPrimitive](): string {
    return REDIGIDO;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDIGIDO;
  }
}
