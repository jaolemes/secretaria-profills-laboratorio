import { z } from "zod";
import { lerDia, lerEnderecoEmail } from "../dominio";
import {
  ESTADOS_DA_ESCRITA,
  STATUS_DO_ATENDIMENTO,
  TIPOS_DE_COMPROMISSO,
  TOOLS_DE_ESCRITA,
  type Escrita,
  type ToolDeEscrita,
} from "./tipos";

/** O id do CRM é um inteiro de 1 a 2147483647. */
const ID_MAXIMO = 2_147_483_647;

/** C0 e C1 sem `\n` e `\t`. O `\r\n` já virou `\n` antes. */
const CONTROLE_DE_VARIAS_LINHAS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
const CONTROLE_DE_UMA_LINHA = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

function tamanho(texto: string): number {
  return [...texto].length;
}

/**
 * Texto aparado nas pontas, com `\r\n` como `\n`. Caractere invisível de formato passa: ele acende o
 * sinal de injeção e o vendedor o vê marcado. A mensagem cita o campo (pelo caminho) e nunca o valor.
 */
function texto(maximo: number, umaLinha: boolean) {
  return z
    .string({ error: "precisa ser texto" })
    .transform((valor) => valor.replaceAll("\r\n", "\n").trim())
    .pipe(
      z.string().superRefine((valor, ctx) => {
        if (valor === "") ctx.addIssue({ code: "custom", message: "não pode ficar vazio" });
        else if (tamanho(valor) > maximo) ctx.addIssue({ code: "custom", message: `passa de ${maximo} caracteres` });
        else if (umaLinha && /[\n\u2028\u2029]/.test(valor)) ctx.addIssue({ code: "custom", message: "precisa ter uma linha só" });
        else if ((umaLinha ? CONTROLE_DE_UMA_LINHA : CONTROLE_DE_VARIAS_LINHAS).test(valor)) {
          ctx.addIssue({ code: "custom", message: "tem caractere de controle" });
        }
      }),
    );
}

const idNoCrm = z
  .number({ error: "precisa ser um número inteiro" })
  .int({ error: "precisa ser um número inteiro" })
  .min(1, { error: "precisa ser de 1 a 2147483647" })
  .max(ID_MAXIMO, { error: "precisa ser de 1 a 2147483647" });

const FORMATO_DO_MOMENTO = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;

/** `AAAA-MM-DD HH:MM`, dia que existe, hora de 00 a 23 e minuto de 00 a 59: um dos formatos que o CRM aceita. */
export function momentoValido(valor: string): boolean {
  const achado = FORMATO_DO_MOMENTO.exec(valor);
  if (achado === null) return false;
  return lerDia(achado[1] ?? "") !== null && Number(achado[2]) <= 23 && Number(achado[3]) <= 59;
}

const momento = z
  .string({ error: "precisa ser texto" })
  .transform((valor) => valor.trim())
  .pipe(z.string().refine(momentoValido, { error: "precisa ser AAAA-MM-DD HH:MM, um dia que existe, hora de 00 a 23 e minuto de 00 a 59" }));

/** Tirando o que não é dígito e um `0` ou `55` da frente, sobram 10 ou 11 dígitos. O valor guardado é o que veio. */
export function telefoneValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "");
  const candidatos = [digitos, digitos.startsWith("0") ? digitos.slice(1) : null, digitos.startsWith("55") ? digitos.slice(2) : null];
  return candidatos.some((candidato) => candidato !== null && (candidato.length === 10 || candidato.length === 11));
}

const telefone = texto(45, true).refine(telefoneValido, { error: "precisa ser um número brasileiro com DDD, de 10 ou 11 dígitos" });
const email = texto(255, true).refine((valor) => lerEnderecoEmail(valor) !== null, { error: "precisa ser um endereço de e-mail sem espaços" });

const registrarAtendimento = z.strictObject({
  cliente_id: idNoCrm,
  assunto: texto(255, true),
  status: z.enum(STATUS_DO_ATENDIMENTO, { error: `precisa ser um de: ${STATUS_DO_ATENDIMENTO.join(", ")}` }),
  descricao: texto(5000, false).optional(),
  contato_id: idNoCrm.optional(),
});

const criarCompromisso = z
  .strictObject({
    titulo: texto(255, true),
    inicio: momento,
    fim: momento.optional(),
    descricao: texto(5000, false).optional(),
    cliente_id: idNoCrm.optional(),
    tipo: z.enum(TIPOS_DE_COMPROMISSO, { error: `precisa ser um de: ${TIPOS_DE_COMPROMISSO.join(", ")}` }).optional(),
  })
  .superRefine((dados, ctx) => {
    // Formato `AAAA-MM-DD HH:MM`: a ordem do texto é a ordem do tempo. Se um dos dois já falhou, o campo fala por si.
    if (dados.fim !== undefined && momentoValido(dados.inicio) && momentoValido(dados.fim) && dados.fim <= dados.inicio) {
      ctx.addIssue({ code: "custom", path: ["fim"], message: "precisa vir depois de inicio" });
    }
  });

const criarContato = z.strictObject({
  cliente_id: idNoCrm,
  nome: texto(45, true),
  telefone,
  email: email.optional(),
  cargo: texto(45, true).optional(),
  departamento: texto(45, true).optional(),
  observacoes: texto(5000, false).optional(),
});

export const SCHEMAS_DAS_TOOLS = {
  registrar_atendimento: registrarAtendimento,
  criar_compromisso: criarCompromisso,
  criar_contato: criarContato,
} as const satisfies { readonly [T in ToolDeEscrita]: z.ZodType };

export type Lido<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly mensagem: string };

const CORTE_DO_NOME_DE_CAMPO = 40;

export function mensagemDe(erro: z.ZodError): string {
  return erro.issues
    .map((issue) => {
      if (issue.code === "unrecognized_keys") {
        return `corpo: campo desconhecido: ${issue.keys.map((chave) => chave.slice(0, CORTE_DO_NOME_DE_CAMPO)).join(", ")}`;
      }
      return `${issue.path.join(".") || "corpo"}: ${issue.message}`;
    })
    .join("; ");
}

/** Os dados de uma tool já limpos: aparados, com o `undefined` dos campos ausentes fora do objeto. */
export function lerEscrita(tool: ToolDeEscrita, dados: unknown): Lido<Escrita> {
  const lido = SCHEMAS_DAS_TOOLS[tool].safeParse(dados);
  if (!lido.success) return { ok: false, mensagem: mensagemDe(lido.error) };
  const limpos = Object.fromEntries(Object.entries(lido.data).filter(([, valor]) => valor !== undefined));
  return { ok: true, valor: { tool, dados: limpos } as unknown as Escrita };
}

const hash = z.string({ error: "precisa ser texto" }).regex(/^[0-9a-f]{64}$/, { error: "precisa ter 64 hexadecimais" });
const versao = z.number({ error: "precisa ser um número inteiro" }).int({ error: "precisa ser um número inteiro" }).min(1, { error: "precisa ser 1 ou mais" });

/** `POST /api/escritas`. Sem `id`, o servidor gera um. */
export const corpoDePropor = z.strictObject({
  id: z.uuid().optional(),
  tool: z.enum(TOOLS_DE_ESCRITA, { error: `precisa ser um de: ${TOOLS_DE_ESCRITA.join(", ")}` }),
  dados: z.record(z.string(), z.unknown(), { error: "precisa ser um objeto" }),
});

export const corpoDeDecidir = z.strictObject({ hash, versao });

/** `campos` é validado pela regra: ela sabe a tool do cartão. */
export const corpoDeEditar = z.strictObject({ hash, versao, campos: z.record(z.string(), z.string({ error: "precisa ser texto" }), { error: "precisa ser um objeto" }) });

export const filtroDeEstado = z.enum(ESTADOS_DA_ESCRITA).optional();

export function lerPorSchema<T extends z.ZodType>(schema: T, corpo: unknown): Lido<z.output<T>> {
  const lido = schema.safeParse(corpo);
  return lido.success ? { ok: true, valor: lido.data } : { ok: false, mensagem: mensagemDe(lido.error) };
}
