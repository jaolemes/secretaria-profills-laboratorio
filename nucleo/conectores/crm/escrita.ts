import { z } from "zod";
import type { CodigoDeErroDaEscrita, DesfechoDaGravacao, Escrita, ToolDeEscrita } from "../../escritas";
import { sinaisDeInjecao, textoExterno, type TextoExterno } from "../../dominio";
import { id, link, resultadoDaFerramenta, soDasTelas, textoDoConteudo } from "./leitura";
import type { RespostaMcp, SessaoMcp } from "./mcp";
import { criarCorredor, type AcessoAoCrm, type Repetir } from "./sessao";

/**
 * Escrita no CRM pelo servidor da Secretária, só do que o vendedor aprovou no cartão. `ESCRITAS` é a única
 * lista de tools que ele grava, separada de `FERRAMENTAS` de `leitura.ts`, que só tem leitura.
 * Tool que cria grava outro registro a cada chamada (`docs/agentes.md`): por isso nada aqui repete uma chamada
 * que pode ter chegado ao CRM. A doc não promete `link` na resposta das três; ele só passa se vier, e pela mesma
 * regra da leitura.
 */

/** Campo desconhecido é ignorado. O link que não passa vira `null` e a gravação continua gravada. */
const respostaDaEscrita = z.object({ id, link: link.catch(null) });

/** A tabela fechada: cada tool que grava, com o schema do que ela responde. */
const ESCRITAS = {
  registrar_atendimento: { resposta: respostaDaEscrita },
  criar_compromisso: { resposta: respostaDaEscrita },
  criar_contato: { resposta: respostaDaEscrita },
} as const satisfies Record<ToolDeEscrita, { readonly resposta: z.ZodType }>;

function ehEscritaDoCrm(nome: string): nome is ToolDeEscrita {
  return Object.hasOwn(ESCRITAS, nome);
}

export interface EscritorDoCrm {
  /** Nunca rejeita. O tipo só aceita as três tools; em tempo de execução, outro nome é `recusou` antes de abrir a rede. */
  gravar(escrita: Escrita): Promise<DesfechoDaGravacao>;
}

const incerta = (detalhe: TextoExterno | null): DesfechoDaGravacao => ({ tipo: "incerto", erro: { codigo: "crm_escrita_incerta", detalhe } });
const recusada = (codigo: CodigoDeErroDaEscrita, detalhe: TextoExterno | null = null): DesfechoDaGravacao => ({ tipo: "recusou", erro: { codigo, detalhe } });

/**
 * A tabela única do desfecho de uma mensagem de erro da tool, na ordem. O que ela não conhece é incerto:
 * na dúvida, o vendedor confere no CRM. As mensagens são as de `docs/agentes.md`, "Como reagir a cada erro".
 * "Confira com" vem antes de "Não encontrado": a segunda mensagem de não encontrado, a que fala de uma
 * primeira tentativa, é incerta.
 */
const MENSAGENS_DA_ESCRITA: readonly (readonly [RegExp, "incerto" | CodigoDeErroDaEscrita])[] = [
  [/Confira com|indisponível agora|Avise o administrador/i, "incerto"],
  [/limitou as chamadas|Sessão sem usuário do CRM|não tem acesso ao CRM agora/i, "crm_nao_executou"],
  [/não tem permissão/i, "crm_sem_permissao"],
  [/^Não encontrado/i, "crm_nao_encontrado"],
  [/O CRM recusou o campo|O fim precisa ser depois do início|Data inválida/i, "crm_recusou_a_escrita"],
];

/** O texto que o MCP mandou, saneado. `null` quando está vazio, acende sinal de injeção ou leva o token. */
function detalheDoMcp(texto: string | null, sessao: SessaoMcp | null): TextoExterno | null {
  if (texto === null || texto.trim() === "" || sessao?.levaOToken(texto) === true || sinaisDeInjecao(texto).length > 0) return null;
  const limpo = textoExterno(texto);
  return limpo === "" ? null : limpo;
}

export function criarEscritor(recurso: URL, acesso: AcessoAoCrm, sinal: AbortSignal): EscritorDoCrm {
  const executar = criarCorredor<DesfechoDaGravacao>(recurso, acesso, sinal, {
    semToken: () => recusada("crm_nao_executou"),
    // O `initialize` falhou antes de qualquer `tools/call`: nada foi gravado. Só 401 e 404 abrem outra sessão.
    aoFalharAAbertura(falha) {
      const status = falha.tipo === "http" ? falha.resposta.status : null;
      if (status === 401) return "token_recusado";
      if (status === 404) return "sessao_expirada";
      return recusada("crm_nao_executou");
    },
    esgotou(motivo) {
      if (motivo === "sessao_expirada") return incerta(null);
      acesso.vencido();
      return recusada("crm_nao_executou");
    },
  });

  /** O que o HTTP já diz, antes do corpo. `null` é o 200 com `result`. */
  function desfechoDoTransporte(resposta: RespostaMcp | null, sessao: SessaoMcp | null): DesfechoDaGravacao | Repetir | null {
    if (resposta === null) return incerta(null);
    if (resposta.status === 401) return "token_recusado";
    if (resposta.status === 404) return "sessao_expirada";
    if (resposta.status === 403 || resposta.status === 429) return recusada("crm_nao_executou");
    if (resposta.status !== 200) return incerta(null);
    if (resposta.resultado === undefined) return incerta(detalheDoMcp(resposta.erroRpc, sessao));
    return null;
  }

  function desfechoDoResultado(tool: ToolDeEscrita, resultado: unknown, sessao: SessaoMcp, origemDasTelas: string | null): DesfechoDaGravacao {
    const lido = resultadoDaFerramenta.safeParse(resultado);
    if (!lido.success) return incerta(null);
    if (lido.data.isError === true) {
      const texto = textoDoConteudo(lido.data.content);
      const decidido = MENSAGENS_DA_ESCRITA.find(([padrao]) => padrao.test(texto))?.[1] ?? "incerto";
      const detalhe = detalheDoMcp(texto, sessao);
      if (decidido === "crm_nao_executou" && /Sessão sem usuário do CRM/i.test(texto)) acesso.vencido();
      return decidido === "incerto" ? incerta(detalhe) : recusada(decidido, detalhe);
    }
    let dados = lido.data.structuredContent;
    if (dados === undefined) {
      try {
        dados = JSON.parse(textoDoConteudo(lido.data.content));
      } catch {
        return incerta(null);
      }
    }
    const gravado = ESCRITAS[tool].resposta.safeParse(dados);
    if (!gravado.success) return incerta(null);
    const { id: crmId, link: linkDoCrm } = soDasTelas(gravado.data, origemDasTelas);
    return { tipo: "gravou", recibo: { id: crmId, link: linkDoCrm } };
  }

  return {
    async gravar(escrita) {
      const nome: string = escrita.tool;
      if (!ehEscritaDoCrm(nome)) return recusada("crm_ferramenta_recusada");
      return executar(async ({ sessao, origemDasTelas }) => {
        const resposta = await sessao.chamar("tools/call", { name: nome, arguments: escrita.dados });
        const doTransporte = desfechoDoTransporte(resposta, sessao);
        if (doTransporte !== null) return doTransporte;
        return desfechoDoResultado(nome, resposta?.resultado, sessao, origemDasTelas);
      });
    },
  };
}
