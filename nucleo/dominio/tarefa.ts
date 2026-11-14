/** Tamanho máximo de cada texto de tarefa. Mora no domínio para o painel validar sem levar o zod da borda. */
export const LIMITES_DA_TAREFA = { titulo: 200, nota: 4000, proximoPasso: 500, clienteId: 64, clienteNome: 200, propostaCodigo: 64 } as const;
