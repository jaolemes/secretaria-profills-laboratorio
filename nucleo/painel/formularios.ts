import { lerEnderecoEmail, lerRotulo, lerTelefone, type ConfigEmail, type IdContaEmail, type JanelaDias, type ProvedorEmail, type Telefone } from "../dominio";
import type { CorpoDaAcaoDoEmail, CorpoDeAdicionarEmail } from "./api";

export type CampoDoEmail = "endereco" | "rotulo" | "servidor" | "porta" | "senha";

export type Erros = Partial<Record<CampoDoEmail, string>>;

/** O que o vendedor digitou, menos a senha, que é lida do campo só na hora do envio. */
export interface CamposDaConta {
  readonly endereco: string;
  readonly rotulo: string;
  readonly servidor: string;
  readonly porta: string;
  readonly seguranca: ConfigEmail["seguranca"];
  readonly janelaDias: JanelaDias;
  /** O vendedor abriu as opções avançadas. Fechadas, o servidor sai da predefinição do provedor. */
  readonly avancadas: boolean;
}

/** Nome com domínio, `localhost` ou IPv4: há provedor que entrega o IMAP por IP. */
function ehServidor(texto: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(texto) || texto === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(texto);
}

function lerServidor(campos: Pick<CamposDaConta, "servidor" | "porta" | "seguranca">, erros: Erros) {
  const servidor = campos.servidor.trim();
  if (!ehServidor(servidor)) erros.servidor = "Digite o endereço do servidor, sem espaços.";
  const porta = Number(campos.porta.trim());
  if (!Number.isInteger(porta) || porta < 1 || porta > 65_535) erros.porta = "Digite um número de 1 a 65535.";
  return { servidor, porta, seguranca: campos.seguranca };
}

/** Servidor, porta e segurança vão no corpo só quando o provedor não tem predefinição ou o vendedor os abriu. */
const comServidor = (provedor: ProvedorEmail, campos: CamposDaConta) => provedor === "outro" || campos.avancadas;

export function lerContaNova(
  provedor: ProvedorEmail,
  id: IdContaEmail,
  campos: CamposDaConta,
  senha: string,
): { readonly ok: true; readonly corpo: CorpoDeAdicionarEmail } | { readonly ok: false; readonly erros: Erros } {
  const erros: Erros = {};
  const endereco = lerEnderecoEmail(campos.endereco.trim());
  if (endereco === null) erros.endereco = "Digite o e-mail completo, como nome@empresa.com.br.";
  const rotulo = lerRotulo(campos.rotulo);
  if (rotulo === null) erros.rotulo = "Dê um nome curto para esta conta, como Profills ou Pessoal.";
  if (senha === "") erros.senha = "Digite a senha.";
  const servidor = comServidor(provedor, campos) ? lerServidor(campos, erros) : {};
  if (endereco === null || rotulo === null || Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, corpo: { id, rotulo, provedor, endereco, janelaDias: campos.janelaDias, senha, ...servidor } };
}

/** Conectar de novo uma conta que já existe: a senha e, se o vendedor abriu, o servidor. */
export function lerReconexao(
  campos: Pick<CamposDaConta, "servidor" | "porta" | "seguranca" | "avancadas">,
  senha: string,
): { readonly ok: true; readonly corpo: CorpoDaAcaoDoEmail["conectar"] } | { readonly ok: false; readonly erros: Erros } {
  const erros: Erros = {};
  if (senha === "") erros.senha = "Digite a senha.";
  const servidor = campos.avancadas ? lerServidor(campos, erros) : {};
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, corpo: { senha, ...servidor } };
}

/** Aceita o número como o vendedor digita: "(11) 98765-4321" vira "+5511987654321". */
export function lerTelefoneDigitado(texto: string): Telefone | null {
  const limpo = texto.trim();
  const digitos = limpo.replace(/\D/g, "");
  if (limpo.startsWith("+")) return lerTelefone(`+${digitos}`);
  if (digitos.length === 10 || digitos.length === 11) return lerTelefone(`+55${digitos}`);
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return lerTelefone(`+${digitos}`);
  return null;
}
