import { PROVEDORES_DE_EMAIL, lerIdContaEmail, type EstadoPainel, type IdContaEmail, type ProvedorEmail } from "../dominio";
import { lerListaDoDia, type ListaDoDia } from "./meu-dia";

/**
 * A gaveta do e-mail, aberta sobre Conexões: o detalhe de uma conta, a escolha do provedor
 * (`provedor: null`) ou o formulário de um provedor. Fica no hash para cada estado ter endereço.
 */
export type GavetaDoEmail = { readonly tipo: "conta"; readonly id: IdContaEmail } | { readonly tipo: "nova"; readonly provedor: ProvedorEmail | null };

/**
 * As telas do painel. `tarefa` é o detalhe de uma; `nova` é a tela Tarefas com o formulário aberto.
 * No Meu dia, `lista` é o bloco escolhido ou os ignorados pelo agente; sem ela, a tela escolhe e grava no hash.
 */
export type Rota =
  | { readonly tela: "meu-dia"; readonly lista?: ListaDoDia }
  | { readonly tela: "tarefas" }
  | { readonly tela: "nova" }
  | { readonly tela: "tarefa"; readonly id: string }
  | { readonly tela: "conexoes"; readonly gaveta?: GavetaDoEmail };

export type Secao = "meu-dia" | "tarefas" | "conexoes";

/** Item da navegação que fica marcado em cada tela. */
export function secaoDaRota(rota: Rota): Secao {
  return rota.tela === "nova" || rota.tela === "tarefa" ? "tarefas" : rota.tela;
}

export function hashDaRota(rota: Rota): string {
  switch (rota.tela) {
    case "tarefa":
      return `#/tarefas/${encodeURIComponent(rota.id)}`;
    case "nova":
      return "#/tarefas/nova";
    case "conexoes": {
      const gaveta = rota.gaveta;
      if (gaveta === undefined) return "#/conexoes";
      if (gaveta.tipo === "conta") return `#/conexoes/email/${gaveta.id}`;
      return gaveta.provedor === null ? "#/conexoes/email/nova" : `#/conexoes/email/nova/${gaveta.provedor}`;
    }
    case "meu-dia":
      return rota.lista === undefined ? "#/meu-dia" : `#/meu-dia/${rota.lista}`;
    default:
      return `#/${rota.tela}`;
  }
}

/** Hash vazio ou desconhecido dá `null`: quem chama escolhe a tela inicial. */
export function lerRota(hash: string): Rota | null {
  const partes = hash.replace(/^#\/?/, "").split("/").filter((parte) => parte !== "");
  const [primeira, segunda, ...resto] = partes;
  if (primeira === "conexoes") return lerConexoes(partes.slice(1));
  if (resto.length > 0) return null;
  if (primeira === "meu-dia") {
    if (segunda === undefined) return { tela: "meu-dia" };
    const lista = lerListaDoDia(segunda);
    return lista === null ? null : { tela: "meu-dia", lista };
  }
  if (primeira !== "tarefas") return null;
  if (segunda === undefined) return { tela: "tarefas" };
  if (segunda === "nova") return { tela: "nova" };
  try {
    return { tela: "tarefa", id: decodeURIComponent(segunda) };
  } catch {
    return null;
  }
}

function lerConexoes(partes: readonly string[]): Rota | null {
  const [email, alvo, provedor, ...resto] = partes;
  if (email === undefined) return { tela: "conexoes" };
  if (email !== "email" || alvo === undefined || resto.length > 0) return null;
  if (alvo === "nova") {
    if (provedor === undefined) return { tela: "conexoes", gaveta: { tipo: "nova", provedor: null } };
    const lido = PROVEDORES_DE_EMAIL.find((nome) => nome === provedor);
    return lido === undefined ? null : { tela: "conexoes", gaveta: { tipo: "nova", provedor: lido } };
  }
  const id = lerIdContaEmail(alvo);
  return id === null || provedor !== undefined ? null : { tela: "conexoes", gaveta: { tipo: "conta", id } };
}

/**
 * O dia já serve quando o WhatsApp e o CRM estão de pé. O CRM em `crm_app_nao_liberado` conta como
 * pronto: a liberação depende da Profills, e o vendedor não tem o que fazer em Conexões.
 */
export function prontoParaODia(estado: EstadoPainel): boolean {
  const { whatsapp, crm } = estado.conectores;
  const crmPronto = crm.estado.fase === "conectado" || (crm.estado.fase === "atencao" && crm.estado.problema.codigo === "crm_app_nao_liberado");
  return whatsapp.estado.fase === "conectado" && crmPronto;
}

export function rotaInicial(estado: EstadoPainel): Rota {
  return prontoParaODia(estado) ? { tela: "meu-dia" } : { tela: "conexoes" };
}
