/** Só valores planos: objeto inteiro no log é o caminho comum por onde um segredo vaza. */
export type ValorDeRegistro = string | number | boolean;
export type CamposDoRegistro = Readonly<Record<string, ValorDeRegistro>>;
export type Nivel = "info" | "aviso" | "erro";

export interface Registro {
  info(evento: string, campos?: CamposDoRegistro): void;
  aviso(evento: string, campos?: CamposDoRegistro): void;
  erro(evento: string, campos?: CamposDoRegistro): void;
}

const RECUSADO = "[recusado]";

function aplanar(campos: CamposDoRegistro): Record<string, ValorDeRegistro> {
  const planos: Record<string, ValorDeRegistro> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    // O tipo já recusa objeto; esta conferência cobre `as any` e código JavaScript.
    const tipo = typeof valor;
    planos[chave] = tipo === "string" || tipo === "number" || tipo === "boolean" ? valor : RECUSADO;
  }
  return planos;
}

/** Uma linha JSON por evento. O destino é de quem cria: stderr no CLI, arquivo no servidor. */
export function criarRegistro(opcoes: { readonly escrever: (linha: string) => void; readonly agora: () => string }): Registro {
  const emitir = (nivel: Nivel, evento: string, campos: CamposDoRegistro = {}) => {
    opcoes.escrever(JSON.stringify({ em: opcoes.agora(), nivel, evento: String(evento), campos: aplanar(campos) }));
  };
  return {
    info: (evento, campos) => emitir("info", evento, campos),
    aviso: (evento, campos) => emitir("aviso", evento, campos),
    erro: (evento, campos) => emitir("erro", evento, campos),
  };
}

/** Registro padrão em stderr, para stdout ficar livre para o envelope `--json` do CLI. */
export const registro: Registro = criarRegistro({
  escrever: (linha) => console.error(linha),
  agora: () => new Date().toISOString(),
});
