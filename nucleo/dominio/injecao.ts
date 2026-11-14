/**
 * Sinais de prompt injection em texto que veio de fora. Puro: sem LLM, sem rede, sem I/O.
 * É sinal, não prova: a quarentena reduz o risco e não promete barrar todo ataque. Texto em
 * outro alfabeto parecido (homóglifo), em leetspeak ou em imagem passa.
 */

export const SINAIS = ["caractere_invisivel", "fala_com_o_agente", "marca_de_papel", "pede_comando", "pede_segredo"] as const;
export type Sinal = (typeof SINAIS)[number];

/** O que cada regra enxerga do texto. */
export interface EntradaDaRegra {
  readonly original: string;
  /** Sem acento, em minúsculas, com os invisíveis tirados e os espaços reduzidos a um. */
  readonly junto: string;
  /** Igual a `junto`, mas cada invisível vira espaço: pega a palavra que o invisível separava. */
  readonly separado: string;
  /** Igual a `separado`, sem aspas, colchetes, asteriscos e outros símbolos que embrulham a palavra: `[ignore] tudo` vira `ignore tudo`. */
  readonly limpo: string;
  /** Igual a `limpo`, mas o símbolo some sem deixar espaço: `ig-nore` vira `ignore`. */
  readonly colado: string;
}

export interface RegraDeSinal {
  /** Uma frase para quem lê a tabela na documentação. */
  readonly descricao: string;
  confere(entrada: EntradaDaRegra): boolean;
}

const VERBO_DE_ESQUECER = String.raw`(?:ignor\w*|desconsider\w*|esquec\w*|descart\w*|disregard|forget|overrid\w*|bypass\w*)`;
/** Só estas palavras podem ficar entre o verbo e o objeto: "ignore todas as instruções", não "descarte a proposta, mas as instruções". */
const PALAVRA_DE_LIGACAO = String.raw`(?:all|the|your|any|my|these|those|previous|prior|above|earlier|former|other|completely|totally|entirely|just|simply|now|toda|todas|todo|todos|a|as|o|os|sua|suas|seu|seus|minha|minhas|essa|essas|esse|esses|anterior|anteriores|acima|qualquer|outra|outras|outro|outros|demais|completamente|totalmente|inteiramente|simplesmente|agora)`;
/** Objeto que só um modelo recebe. "regras" e "orientações" são palavra de venda e não entram aqui. */
const OBJETO_DE_INSTRUCAO = String.raw`(?:instruc\w*|instructions?|prompts?|directions|directives?|commands)`;
/** Objeto comum em venda: só conta quando a frase diz que ele é do agente ("que você recebeu", "your rules"). */
const OBJETO_DE_VENDA = String.raw`(?:regras?|rules?|diretrizes|guidelines|orientac\w*|ordens)`;
const DO_AGENTE_DEPOIS = String.raw`(?:que (?:voce|te|lhe) |que foram (?:dadas|passadas) |that (?:you|were given)|you (?:were|have been|got) )`;
/** Alvo de uma frase que se dirige ao modelo, depois de "atenção", "mensagem para" e parecidos. */
const ALVO_MODELO = String.raw`(?:agente|agent|ia|ai|assistente virtual|assistente de ia|bot|robo|llm|chatgpt|claude|gpt|copilot|gemini|modelo|model)`;
const PAPEL = String.raw`(?:system|sistema|assistant|assistente|developer)`;
/** Depois de um rótulo de papel, o que só se diz a um modelo: "system: você deve obedecer". "Assistente: Maria vai te ligar" passa. */
const ORDEM_AO_MODELO = String.raw`(?:voce (?:deve|vai obedecer|precisa|tem que)|you (?:must|will|are|should|have to)|obedec\w*|obey\w*|entendido|understood|ignor\w*|a partir de agora|from now on)`;
/** "do sistema de pedidos" é o sistema do cliente, não o papel de um modelo. */
const NAO_QUALIFICADO = String.raw`(?!\s+(?:de|do|da|dos|das|of)\b)`;

/** Frases que falam com um assistente ou modelo. Aplicadas ao texto normalizado. */
const FALA_COM_O_AGENTE: readonly RegExp[] = [
  new RegExp(String.raw`\b${VERBO_DE_ESQUECER}\b\s+(?:${PALAVRA_DE_LIGACAO}\s+){0,4}${OBJETO_DE_INSTRUCAO}\b`),
  new RegExp(String.raw`\b${VERBO_DE_ESQUECER}\b\s+(?:${PALAVRA_DE_LIGACAO}\s+){0,4}${OBJETO_DE_VENDA}\s+${DO_AGENTE_DEPOIS}`),
  new RegExp(String.raw`\b${VERBO_DE_ESQUECER}\b\s+(?:${PALAVRA_DE_LIGACAO}\s+){0,3}(?:your|suas|seus|tuas|teus)\s+(?:${PALAVRA_DE_LIGACAO}\s+){0,2}${OBJETO_DE_VENDA}\b`),
  /\b(?:ignor\w*|desconsider\w*|esquec\w*|disregard|forget)\s+(?:tudo|todo|everything|all)\b[^.!?\n]{0,30}?\b(?:acima|above|previous|prior|antes|anteriormente|before|earlier)\b/,
  /\b(?:voce e agora|voce agora e|voce passa a ser|voce sera agora|you are now|you're now|you will now be)\b/,
  /\bagora voce e (?:um |uma )?(?:assistente|ia|bot|robo|modelo|agente|ai|llm)\b/,
  new RegExp(String.raw`\bsystem prompt\b|\bprompt (?:do |de )?sistema\b${NAO_QUALIFICADO}|\b(?:instrucoes|instructions) (?:do |de |of the |for the )?(?:sistema|system)\b${NAO_QUALIFICADO}`),
  new RegExp(String.raw`\b${PAPEL}\s*:[^\n]{0,40}?\b${ORDEM_AO_MODELO}\b`),
  /\bcomo (?:uma )?(?:inteligencia artificial|modelo de linguagem|assistente virtual)\b|\bas an? (?:ai|artificial intelligence|language model|assistant)\b/,
  /\b(?:new instructions?|novas? instrucao|novas? instrucoes|updated instructions|instrucoes atualizadas)\s*:/,
  /\b(?:caro|prezado|ola|oi|ei|hey|hi|hello|dear)\W+(?:chatgpt|claude|gpt|llm|copilot|gemini)\b/,
  new RegExp(String.raw`\b(?:atencao|attention|caro|prezado|ola|oi|ei|hey|hi|hello|dear|(?:mensagem|recado|nota|aviso) (?:para|pra|ao|a)|(?:message|note) (?:to|for))\W+(?:(?:o|a|the) )?${ALVO_MODELO}\s*:`),
  /\b(?:se|if)\s+(?:voce|you)\s+(?:e|for|are)\s+(?:um |uma |an? )?(?:ia|ai|assistente|assistant|llm|bot|robo|modelo)\b/,
  /\bmodelo de linguagem\b|\blanguage model\b|\bjailbreak\b|\bdeveloper mode\b|\bmodo desenvolvedor\b/,
  /\b(?:nao|don't|do not|never|nunca)\s+(?:diga|conte|avise|informe|mencione|fale|tell|inform|mention|notify)\s+(?:ao |para o |pro |a |the )?(?:vendedor|usuario|dono|user|owner|seller|humano|human)\b/,
];

/** "como IA" em minúsculas é o verbo "ir" ("como ia fazer"): só a sigla em maiúsculas conta, no texto original. */
const COMO_IA = /\b(?:[Cc]omo|COMO) (?:[Uu]ma |UMA )?IA\b/;

const MARCA_DE_PAPEL: readonly RegExp[] = [
  /<\/?\s*(?:system|assistant|user|human|developer|sistema|instructions?|instrucoes)\s*>/,
  /<\|[a-z0-9_ ]{1,30}\|>/,
  /\[\s*\/?\s*(?:inst|sys|system)\s*\]/,
  /<<\s*\/?\s*sys\s*>>/,
  // Sem o `(?<!#)`, cada `#` de uma fileira longa recomeça a busca e o tempo cresce com o quadrado.
  /(?<!#)#{2,}\s*(?:system|sistema|assistant|human|instruction|developer)\b/,
  /\b(?:begin|end)\s+(?:of\s+)?(?:the\s+)?(?:system|prompt)\b/,
];

const NOMES_DE_TOOL_DO_CRM = String.raw`(?:ver_cliente|ver_proposta|buscar_clientes|minha_agenda|minha_carteira|listar_propostas|ver_desempenho)`;
const TOOL_DE_ESCRITA = String.raw`(?:registrar|enviar|excluir|aprovar|editar|criar|atualizar|cancelar|apagar|deletar|remover|rejeitar|reabrir)_[a-z_]{3,}`;
const SEGREDO_NA_URL = String.raw`(?:\{|\}|<|>|\$|%7b|%3c|\b(?:dados|data|conversa|chat|contexto|context|historico|history|token|chave|key|senha|password|secret|segredo|conteudo|content|prompt|mensagem|message|texto|text)=)`;
const COISA_QUE_VAZA = String.raw`(?:dados|conversas?|historico|mensagens|contatos|contexto|chaves?|senhas?|tokens?|segredos?|data|conversations?|history|messages|contacts|context|keys?|passwords?|secrets?)`;

/** "comando de compra", "terminal de autoatendimento": o nome qualificado é coisa de venda, não de shell. */
const PEDE_COMANDO: readonly RegExp[] = [
  /\b(?:curl|wget)\s+\S/,
  /\b(?:bash|sh|zsh|powershell|pwsh)(?:\.exe)?\s+-[a-z]*c\b|\bcmd(?:\.exe)?\s+\/c\b/,
  /\brm\s+-[a-z]*[rf]|\bsudo\s+\S|\bchmod\s+\S|\b(?:del|rmdir|rd)\s+\/[sq]\b/,
  /\bpip3? install\b|\bnpm (?:i|install|run|exec)\b|\bnpx\s+\S|\bbun (?:run|x|install|secretaria)\b|\bwacli\b|\bpython3?\s+-c\b|\bnode\s+-e\b|\bos\.system\b|\bsubprocess\b|\beval\(/,
  new RegExp(
    String.raw`\b(?:rode|rodar|roda|execute|executar|executa|run|exec|launch|lance)\s+(?:o |a |os |as |um |uma |este |esse |esta |essa |the |this |that )?(?:seguinte |following )?(?:comando|command|script|shell|terminal)\b${NAO_QUALIFICADO}`,
  ),
  new RegExp(String.raw`\b(?:abra|abrir|abre|open)\s+(?:o |um |the |a )?(?:terminal|shell|powershell|prompt de comando|command line)\b${NAO_QUALIFICADO}`),
  /\b(?:chame|chamar|chama|invoque|invocar|acione|acionar|call|invoke|trigger)\s+(?:a |o |the |uma |um |essa |esta |this )?(?:ferramenta|tool|mcp)\b/,
  /\b(?:use|usar|utilize)\s+(?:a |o |the |uma |um |essa |esta |this )?(?:tool|mcp)\b/,
  new RegExp(String.raw`\b${NOMES_DE_TOOL_DO_CRM}\b|\b${TOOL_DE_ESCRITA}\b`),
  new RegExp(String.raw`\b(?:envie|enviar|mande|mandar|send|post|poste|encaminhe|forward|upload|exfiltre|leak)\b[^\n]{0,40}?\b${COISA_QUE_VAZA}\b[^\n]{0,40}?\b(?:para|to|pra)\s+\S*https?://`),
];

const VERBO_ANTES_DA_URL = /\b(?:abra|abrir|abre|open|visite|visit|acesse|acessar|access|navegue|browse|fetch|carregue|load|baixe|download)\b[^\n]{0,40}$/;
const INICIO_DE_URL = /https?:\/\//g;
const SEGREDO_NA_URL_GLOBAL = new RegExp(SEGREDO_NA_URL, "g");
const PARTE_DA_URL = /[?&#]/;
/** Cabe o verbo mais longo e os 40 caracteres que podem separá-lo da URL. */
const JANELA_ANTES_DA_URL = 60;

/**
 * Verbo de abrir, até 40 caracteres antes de uma URL que leva dado depois de `?`, `&` ou `#`.
 * Em código, e não numa regex, porque `https?://\S*[?&#]\S*` recomeça em cada URL de uma palavra
 * longa e fica quadrática: uma mensagem de 64 KB levava segundos.
 */
function abreUrlComDado(texto: string): boolean {
  let inicio = 0;
  for (const palavra of texto.split(" ")) {
    const urls = [...palavra.matchAll(INICIO_DE_URL)];
    if (urls.length > 0) {
      let ultimoSegredo = -1;
      for (const achado of palavra.matchAll(SEGREDO_NA_URL_GLOBAL)) ultimoSegredo = achado.index;
      const proximaParte = new Array<number>(palavra.length + 1).fill(-1);
      for (let i = palavra.length - 1; i >= 0; i--) proximaParte[i] = PARTE_DA_URL.test(palavra[i] ?? "") ? i : (proximaParte[i + 1] ?? -1);
      for (const url of urls) {
        const parte = proximaParte[url.index + url[0].length] ?? -1;
        const absoluto = inicio + url.index;
        if (parte !== -1 && parte < ultimoSegredo && VERBO_ANTES_DA_URL.test(texto.slice(Math.max(0, absoluto - JANELA_ANTES_DA_URL), absoluto))) return true;
      }
    }
    inicio += palavra.length + 1;
  }
  return false;
}

/** Arquivo da Secretária ou de chave: só conta pedido ("cat servidor.json"), não citado ("segue o arquivo meu.db"). */
const ARQUIVO_DE_SEGREDO = String.raw`(?:(?<![a-z0-9_])\.env(?![a-z0-9_])|\b(?:servidor|cofre)\.json\b|\b(?:secretaria|meu|wacli|session)\.db\b|\bid_rsa\b|\bauthorized_keys\b|\bcredentials\.json\b)`;
const SEGREDO_PELO_NOME =
  /\b(?:api[ _-]?key|apikey|chave de api|secret[ _-]?key|private key|chave privada|chave secreta|refresh[ _-]?token|bearer token|token de (?:api|autenticacao)|ssh key|chave ssh)\b/;
const VERBO_DE_PEDIR = String.raw`(?:passe|passa|mande|manda|envie|envia|diga|informe|revele|mostre|mostra|forneca|digite|cole|copie|exiba|imprima|leia|abra|abre|show|send|give|tell|reveal|print|paste|share|provide|dump|display|read|open|cat|echo|list|exfiltrate)`;
/** Segredo da máquina ou do agente. "senha" e "token" sozinhos são do dia a dia de venda ("a senha do wifi"). */
const SEGREDO_DA_MAQUINA = String.raw`(?:credenciais|credentials|cofre|vault|keychain|chaveiro|cookies? de sessao|session cookies?)`;
const SEGREDO_COMUM = String.raw`(?:senhas?|passwords?|passwd|tokens?|segredos?|secrets?|credenciais|credentials|chaves?)`;
const PEDE_SEGREDO: readonly RegExp[] = [
  SEGREDO_PELO_NOME,
  new RegExp(String.raw`\b${VERBO_DE_PEDIR}\b[^\n.!?]{0,40}?${ARQUIVO_DE_SEGREDO}`),
  new RegExp(String.raw`\b${VERBO_DE_PEDIR}\b[^\n.!?]{0,40}?\b${SEGREDO_DA_MAQUINA}\b`),
  new RegExp(String.raw`\b(?:${VERBO_DE_PEDIR}|qual(?: e)?)\b[^\n.!?]{0,40}?\b(?:seu|sua|seus|suas|teu|tua|your)\s+${SEGREDO_COMUM}\b`),
];

const tem = (padroes: readonly RegExp[], texto: string) => padroes.some((padrao) => padrao.test(texto));
const variantes = (entrada: EntradaDaRegra) => [entrada.junto, entrada.separado, entrada.limpo, entrada.colado];
const emQualquer = (padroes: readonly RegExp[]) => (entrada: EntradaDaRegra) => variantes(entrada).some((texto) => tem(padroes, texto));

/** Tabela única: cada sinal e a regra dele. `docs/arquitetura.md` descreve a mesma lista. */
export const REGRAS_DE_SINAL: { readonly [S in Sinal]: RegraDeSinal } = {
  caractere_invisivel: {
    descricao: "Caractere de formato, bidi, largura zero, seletor de variação solto ou do bloco de tags (U+E0000 a U+E007F). Emoji com U+FE0F ou ZWJ dentro da sequência não conta.",
    confere: ({ original }) => posicoesInvisiveis(original).length > 0,
  },
  fala_com_o_agente: {
    descricao:
      "Texto que se dirige a um assistente ou modelo: \"ignore as instruções\", \"you are now\", \"system prompt\", \"system: você deve\", \"atenção agente:\", \"como IA\", \"novas instruções:\".",
    confere: (entrada) => COMO_IA.test(entrada.original) || emQualquer(FALA_COM_O_AGENTE)(entrada),
  },
  marca_de_papel: {
    descricao: "Marca de turno ou de sistema de um modelo: `<system>`, `[INST]`, `### system`, `<|im_start|>`, `BEGIN SYSTEM`.",
    confere: emQualquer(MARCA_DE_PAPEL),
  },
  pede_comando: {
    descricao: "Pede para rodar comando, abrir URL com dado, ou usar ferramenta: `curl `, `bash -c`, `rm -rf`, \"rode o comando\", \"chame a ferramenta\", nome de tool do CRM como `registrar_atendimento`.",
    confere: (entrada) => emQualquer(PEDE_COMANDO)(entrada) || variantes(entrada).some(abreUrlComDado),
  },
  pede_segredo: {
    descricao: "Pede a senha ou o token do agente (\"sua senha\"), chave de API, cofre, `.env` ou `servidor.json`.",
    confere: emQualquer(PEDE_SEGREDO),
  },
};

const CONTROLE_QUE_NAO_E_ESPACO = /[\p{Cc}]/u;
const FORMATO_OU_IGNORAVEL = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
const PICTOGRAFICO = /\p{Extended_Pictographic}/u;
const MODIFICADOR_DE_EMOJI = /\p{Emoji_Modifier}/u;
const BASE_DE_TECLA = /[0-9#*]/;
const ZWJ = 0x200d;
const SELETOR_DE_EMOJI = 0xfe0f;
const SELETOR_DE_TEXTO = 0xfe0e;
const CHAVEIRO_DE_QUEBRA = new Set([0x09, 0x0a, 0x0d]);

function ehTag(codigo: number): boolean {
  return codigo >= 0xe0000 && codigo <= 0xe007f;
}

function ehEmoji(texto: string | undefined): boolean {
  return texto !== undefined && PICTOGRAFICO.test(texto);
}

/** Índice, em pontos de código, de cada caractere invisível. Emoji legítimo (VS16, ZWJ, tecla) fica de fora. */
export function posicoesInvisiveis(texto: string): readonly number[] {
  const pontos = Array.from(texto);
  const achados: number[] = [];
  for (const [i, ponto] of pontos.entries()) {
    const codigo = ponto.codePointAt(0) ?? 0;
    if (ehTag(codigo)) {
      achados.push(i);
    } else if (codigo === SELETOR_DE_EMOJI || codigo === SELETOR_DE_TEXTO) {
      const anterior = pontos[i - 1];
      const legitimo = ehEmoji(anterior) || (anterior !== undefined && BASE_DE_TECLA.test(anterior) && codigo === SELETOR_DE_EMOJI);
      if (!legitimo) achados.push(i);
    } else if (codigo === ZWJ) {
      const anterior = pontos[i - 1];
      const seguinte = pontos[i + 1];
      const depoisDeEmoji =
        ehEmoji(anterior) || anterior?.codePointAt(0) === SELETOR_DE_EMOJI || (anterior !== undefined && MODIFICADOR_DE_EMOJI.test(anterior));
      if (!(depoisDeEmoji && ehEmoji(seguinte))) achados.push(i);
    } else if (CONTROLE_QUE_NAO_E_ESPACO.test(ponto) ? !CHAVEIRO_DE_QUEBRA.has(codigo) : FORMATO_OU_IGNORAVEL.test(ponto)) {
      achados.push(i);
    }
  }
  return achados;
}

const ABRE_MARCA = "⟦";

/**
 * O texto com cada caractere invisível trocado por uma marca visível, `⟦U+200B⟧`. Para o vendedor ler no painel.
 * Um `⟦` do próprio texto também vira marca, para quem escreveu `⟦U+200B⟧` não imitar a marca da Secretária.
 */
export function mostrarInvisiveis(texto: string): string {
  const posicoes = new Set(posicoesInvisiveis(texto));
  if (posicoes.size === 0 && !texto.includes(ABRE_MARCA)) return texto;
  return Array.from(texto)
    .map((ponto, i) =>
      posicoes.has(i) || ponto === ABRE_MARCA ? `⟦U+${(ponto.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟧` : ponto,
    )
    .join("");
}

/** Tudo que não é letra, número, espaço nem pontuação de frase. */
const EMBRULHO = /[^\p{L}\p{N}\s.,!?;:]+/gu;

const TUDO_QUE_NAO_E_VISIVEL = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\p{Cc}]/gu;

function normalizar(texto: string, aoTirarInvisivel: "" | " "): string {
  return texto
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(TUDO_QUE_NAO_E_VISIVEL, (ponto) => (/[\t\n\r]/.test(ponto) ? " " : aoTirarInvisivel))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Os sinais que o texto acende, na ordem de `SINAIS`. Vazio é "nada suspeito", não "seguro". */
export function sinaisDeInjecao(texto: string): readonly Sinal[] {
  if (texto === "") return [];
  const separado = normalizar(texto, " ");
  const entrada: EntradaDaRegra = {
    original: texto,
    junto: normalizar(texto, ""),
    separado,
    limpo: separado.replace(EMBRULHO, " ").replace(/\s+/g, " ").trim(),
    colado: separado.replace(EMBRULHO, "").replace(/\s+/g, " ").trim(),
  };
  return SINAIS.filter((sinal) => REGRAS_DE_SINAL[sinal].confere(entrada));
}

/** A união dos sinais de vários textos, na ordem de `SINAIS`. */
export function sinaisDe(textos: readonly string[]): readonly Sinal[] {
  const acesos = new Set(textos.flatMap((texto) => sinaisDeInjecao(texto)));
  return SINAIS.filter((sinal) => acesos.has(sinal));
}
