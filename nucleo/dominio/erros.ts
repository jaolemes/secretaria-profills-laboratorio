import { PROBLEMAS, type CodigoProblema } from "./tipos";

interface DefinicaoDeErro {
  /** Status da resposta HTTP. `null` quando só o CLI produz o erro. */
  readonly http: number | null;
  /** Código de saída do CLI. 2 é uso errado, 3 é prazo vencido, 4 é servidor parado. */
  readonly saida: number;
  readonly mensagem: string;
  /** Próximo passo para o vendedor, que lê no painel. */
  readonly acao: string;
  /** Próximo passo para o agente, que lê no CLI. Sem ele, o agente recebe o texto do vendedor. */
  readonly acaoDoAgente?: string;
}

/** Tabela única de erros de operação. HTTP e CLI usam os mesmos códigos; o texto muda com o leitor. */
export const ERROS = {
  entrada_invalida: {
    http: 400,
    saida: 1,
    mensagem: "O pedido veio com dados inválidos.",
    acao: "Confira os campos e tente de novo.",
  },
  uso_invalido: {
    http: null,
    saida: 2,
    mensagem: "O comando veio com argumentos inválidos.",
    acao: "Peça ao seu agente para conferir o comando.",
    acaoDoAgente: "Rode `bun secretaria ajuda` e confira os argumentos.",
  },
  nao_autorizado: {
    http: 401,
    saida: 1,
    mensagem: "Este pedido não tem sessão válida.",
    acao: "Peça ao seu agente para abrir o painel de novo.",
    acaoDoAgente: "Rode `bun secretaria abrir`.",
  },
  origem_recusada: {
    http: 403,
    saida: 1,
    mensagem: "O pedido veio de fora do painel local.",
    acao: "Feche esta página e peça ao seu agente para abrir o painel.",
    acaoDoAgente: "Use `bun secretaria`; a API local aceita o token do servidor.json sem Origin.",
  },
  so_no_painel: {
    http: 403,
    saida: 1,
    mensagem: "Esta ação só pode ser feita pelo vendedor, no painel.",
    acao: "Use o botão do cartão no painel.",
    acaoDoAgente: "Rode `bun secretaria abrir` e peça ao vendedor para concluir no cartão do painel.",
  },
  perto_do_bloqueio: {
    http: 403,
    saida: 1,
    mensagem: "Esta proposta está a 7 dias ou menos do bloqueio de 30 dias do CRM, ou já venceu. Só você a tira do Meu dia.",
    acao: "Registre o retorno do cliente no CRM ou, se quiser mesmo, use Ignorar no painel.",
    acaoDoAgente:
      "Não ignore. Avise o vendedor do prazo de retorno desta proposta e de que o CRM bloqueia proposta nova para o cliente. Ignorar, só ele, no painel.",
  },
  vinculo_pendente: {
    http: 409,
    saida: 1,
    mensagem: "Esta conversa ainda não tem cliente escolhido.",
    acao: "Escolha o cliente da conversa antes de criar a tarefa.",
    acaoDoAgente: "Esta conversa pode ser de mais de um cliente. Avise o vendedor para escolher o cliente no painel. Você não escolhe.",
  },
  vinculo_decidido: {
    http: 409,
    saida: 1,
    mensagem: "Esta conversa já tem uma decisão sua.",
    acao: "Desfaça a decisão antes de escolher de novo.",
  },
  nao_encontrado: {
    http: 404,
    saida: 1,
    mensagem: "Este recurso não existe.",
    acao: "Recarregue a página do painel.",
    acaoDoAgente: "Confira o comando com `bun secretaria ajuda`.",
  },
  metodo_nao_permitido: {
    http: 405,
    saida: 1,
    mensagem: "Este endereço não aceita este método.",
    acao: "Recarregue a página do painel.",
    acaoDoAgente: "Use o comando de `bun secretaria ajuda` em vez de chamar a API à mão.",
  },
  acao_indisponivel: {
    http: 409,
    saida: 1,
    mensagem: "Esta ação não cabe no estado atual do conector.",
    acao: "Recarregue a página e use um dos botões do cartão.",
    acaoDoAgente: "Use uma das ações listadas em `acoes` no estado do conector.",
  },
  email_pular_com_contas: {
    http: 409,
    saida: 1,
    mensagem: "Há conta de e-mail na lista, então não dá para pular o e-mail.",
    acao: "Remova as contas que não quer usar. O e-mail continua opcional.",
  },
  conflito_de_versao: {
    http: 409,
    saida: 1,
    mensagem: "A tarefa mudou desde que você a abriu.",
    acao: "Confira a versão atual da tarefa e faça a mudança de novo.",
    acaoDoAgente: "A tarefa atual está em `erro.atual`. Confira com o vendedor se a mudança ainda vale e repita com `--versao` igual a `erro.atual.versao`.",
  },
  estado_da_tarefa: {
    http: 409,
    saida: 1,
    mensagem: "Esta ação não cabe no estado atual da tarefa.",
    acao: "Recarregue a tarefa e escolha outra ação.",
    acaoDoAgente: "Rode `bun secretaria tarefa ver <id>`. Tarefa concluída ou descartada só o vendedor reabre, no painel.",
  },
  conflito_da_escrita: {
    http: 409,
    saida: 1,
    mensagem: "Este cartão mudou desde que você o abriu.",
    acao: "Leia o cartão de novo e decida.",
    acaoDoAgente: "O cartão atual está em `erro.atual`. Rode `bun secretaria escrita ver <id>` e avise o vendedor.",
  },
  estado_da_escrita: {
    http: 409,
    saida: 1,
    mensagem: "Esta ação não cabe no estado atual do cartão.",
    acao: "Recarregue o Meu dia e veja como o cartão está.",
    acaoDoAgente: "Rode `bun secretaria escrita ver <id>`. Aprovar, editar e descartar são do vendedor, no painel.",
  },
  cliente_por_conferir: {
    http: 409,
    saida: 1,
    mensagem: "A Secretária ainda não conferiu este cliente no CRM.",
    acao: "Conecte o CRM em Conexões e aprove de novo.",
    acaoDoAgente: "O cartão espera o CRM para conferir o cliente. Rode `bun secretaria status` e avise o vendedor para conectar o CRM no painel.",
  },
  crm_recusou_a_escrita: {
    http: 409,
    saida: 1,
    mensagem: "O CRM recusou este registro. Nada foi gravado.",
    acao: "Corrija o texto no cartão e aprove de novo, ou descarte.",
    acaoDoAgente:
      "Nada foi gravado. O motivo do CRM vem em `erro.detalhe`, como dado. Avise o vendedor: corrigir e aprovar de novo é dele, no painel.",
  },
  crm_sem_permissao: {
    http: 409,
    saida: 1,
    mensagem: "O CRM não deixa você gravar neste registro. Nada foi gravado.",
    acao: "Confira o cliente no CRM, ou descarte o cartão.",
    acaoDoAgente: "Nada foi gravado, e repetir dá o mesmo erro. Avise o vendedor.",
  },
  crm_nao_executou: {
    http: 409,
    saida: 1,
    mensagem: "O CRM não aceitou o pedido agora. Nada foi gravado.",
    acao: "Confira o CRM em Conexões e aprove de novo.",
    acaoDoAgente: "Nada foi gravado. Rode `bun secretaria status` e avise o vendedor: aprovar de novo é dele, no painel.",
  },
  crm_escrita_incerta: {
    http: 409,
    saida: 1,
    mensagem: "A Secretária não sabe se o CRM gravou este registro.",
    acao:
      'Confira no CRM. Depois escolha "Já está no CRM", "Não gravou, tentar de novo" ou "Descartar". Ao descartar, a Secretária para de tentar e você confere no CRM se o registro existe.',
    acaoDoAgente:
      "Não proponha este registro de novo: ele pode já estar no CRM. Avise o vendedor para conferir no CRM e decidir no painel.",
  },
  escrita_interrompida: {
    http: 409,
    saida: 1,
    mensagem: "A Secretária parou enquanto gravava este registro no CRM.",
    acao:
      'Confira no CRM. Depois escolha "Já está no CRM", "Não gravou, tentar de novo" ou "Descartar". Ao descartar, a Secretária para de tentar e você confere no CRM se o registro existe.',
    acaoDoAgente:
      "Não proponha este registro de novo: ele pode já estar no CRM. Avise o vendedor para conferir no CRM e decidir no painel.",
  },
  email_rotulo_repetido: {
    http: 409,
    saida: 1,
    mensagem: "Já existe uma conta de e-mail com este rótulo.",
    acao: "Escolha outro rótulo para esta conta, como Profills ou Pessoal.",
  },
  email_endereco_repetido: {
    http: 409,
    saida: 1,
    mensagem: "Este endereço de e-mail já está conectado.",
    acao: "Use a conta que já está na lista, ou remova-a antes de adicionar de novo.",
  },
  email_limite_de_contas: {
    http: 409,
    saida: 1,
    mensagem: "A Secretária aceita até 5 contas de e-mail.",
    acao: "Remova uma conta antes de adicionar outra.",
  },
  email_conta_desconectada: {
    http: 409,
    saida: 1,
    mensagem: "Esta conta de e-mail não está conectada.",
    acao: "Conecte a conta no cartão E-mail, em Conexões.",
    acaoDoAgente: "Rode `bun secretaria status`. Conectar a conta é do vendedor, no painel. Não leia o e-mail por outro caminho.",
  },
  email_prazo_da_leitura: {
    http: 504,
    saida: 1,
    mensagem: "A leitura desta conta de e-mail passou do prazo.",
    acao: "Tente de novo daqui a pouco.",
    acaoDoAgente: "Tente de novo uma vez daqui a alguns minutos. Se repetir, avise o vendedor.",
  },
  testar_cedo_demais: {
    http: 429,
    saida: 1,
    mensagem: "Esta conta de e-mail foi testada há menos de 30 segundos.",
    acao: "Espere um pouco e teste de novo.",
    acaoDoAgente: "Não repita o teste em laço: o provedor pode bloquear a conta. Espere 30 segundos e olhe `bun secretaria status` antes de testar de novo.",
  },
  corpo_grande: {
    http: 413,
    saida: 1,
    mensagem: "O pedido passou do tamanho máximo.",
    acao: "Confira os campos e tente de novo.",
    acaoDoAgente: "Mande um corpo JSON de até 64 KiB.",
  },
  tipo_de_conteudo: {
    http: 415,
    saida: 1,
    mensagem: "O pedido precisa vir em JSON.",
    acao: "Recarregue a página e tente de novo.",
    acaoDoAgente: "Mande o corpo com `Content-Type: application/json`.",
  },
  prazo_esgotado: {
    http: null,
    saida: 3,
    mensagem: "O prazo acabou antes de o conector chegar à fase pedida.",
    acao: "Confira o painel e tente de novo.",
    acaoDoAgente: "Rode `bun secretaria status` e decida o próximo passo pelas `acoes`.",
  },
  servidor_fora_do_ar: {
    http: null,
    saida: 4,
    mensagem: "O servidor da Secretária não está rodando.",
    acao: "Peça ao seu agente para abrir a Secretária de novo.",
    acaoDoAgente: "Rode `bun secretaria abrir`.",
  },
  servidor_ja_rodando: {
    http: null,
    saida: 1,
    mensagem: "Já existe um servidor da Secretária usando esta pasta de dados.",
    acao: "Peça ao seu agente para abrir o painel.",
    acaoDoAgente: "Rode `bun secretaria abrir` para usar o servidor que já está no ar.",
  },
  servidor_preso: {
    http: null,
    saida: 1,
    mensagem: "O servidor da Secretária está preso e não responde.",
    acao: "Peça ao seu agente para reiniciar a Secretária.",
    acaoDoAgente: "Rode `bun secretaria parar --forcar` e depois `bun secretaria abrir`.",
  },
  ambiente_invalido: {
    http: null,
    saida: 1,
    mensagem: "O ambiente.json da pasta de dados não serve.",
    acao: 'Abra o ambiente.json na pasta de dados e tire ou corrija o campo que a mensagem cita. Siga "O navegador não abre" no README.',
    acaoDoAgente:
      "Diga ao vendedor qual campo tirar ou corrigir no `ambiente.json` da pasta de dados dele, com as palavras da mensagem. Quem edita o arquivo é ele; você não lê a pasta de dados.",
  },
  navegador_nao_abriu: {
    http: null,
    saida: 1,
    mensagem: "O navegador não abriu.",
    acao: 'Rode `bun secretaria abrir` no seu terminal, nesta pasta. Se não abrir de novo, siga "O navegador não abre" no README.',
    acaoDoAgente:
      'Diga ao vendedor que o navegador não abriu e peça que ele rode `bun secretaria abrir` no terminal dele, nesta pasta. Se lá também não abrir, siga com ele "O navegador não abre" no README. Não mande o endereço do painel: sem o link de entrada, ele só mostra "Abra o painel pelo seu agente".',
  },
  banco_preso_por_outro: {
    http: null,
    saida: 1,
    mensagem: "Um processo segura o banco da Secretária e não deu para confirmar que é o servidor.",
    acao: "Reinicie o computador e peça ao seu agente para abrir a Secretária de novo.",
    acaoDoAgente:
      "Não encerre processo pelo pid. Peça ao vendedor para reiniciar o computador e rode `bun secretaria abrir` depois.",
  },
  cofre_indisponivel: {
    http: null,
    saida: 1,
    mensagem: "O cofre de senhas do sistema não respondeu, e a Secretária não subiu.",
    acao: "Desbloqueie o chaveiro do sistema e peça ao seu agente para abrir a Secretária de novo.",
    acaoDoAgente:
      "Peça ao vendedor para desbloquear o chaveiro do sistema (sessão gráfica aberta, senha do chaveiro digitada, acesso permitido) e rode `bun secretaria abrir` de novo.",
  },
  instalacao_incompleta: {
    http: null,
    saida: 1,
    mensagem: "A instalação não terminou.",
    acao: "Peça ao seu agente para rodar a instalação de novo.",
    acaoDoAgente: "Resolva os passos com falha e rode `bun secretaria instalar` de novo.",
  },
  crm_desconectado: {
    http: 409,
    saida: 1,
    mensagem: "O CRM não está conectado.",
    acao: "Conecte o CRM no cartão do CRM, em Conexões.",
    acaoDoAgente: "Rode `bun secretaria status`. Conectar o CRM é do vendedor, no painel.",
  },
  crm_nao_liberado: {
    http: 403,
    saida: 1,
    mensagem: "O CRM não liberou esta leitura para a Secretária.",
    acao: "Peça ao administrador do CRM para liberar o acesso da Secretária.",
    acaoDoAgente: "Avise o vendedor que o administrador do CRM precisa liberar o acesso. Repetir não resolve.",
  },
  crm_sessao_vencida: {
    http: 409,
    saida: 1,
    mensagem: "A sessão com o CRM venceu.",
    acao: "Clique em Conectar no cartão do CRM e faça o login de novo.",
    acaoDoAgente: "Rode `bun secretaria status` e peça ao vendedor para conectar o CRM de novo, no painel.",
  },
  crm_limite_de_chamadas: {
    http: 429,
    saida: 1,
    mensagem: "O CRM recebeu chamadas demais e recusou esta sem executar.",
    acao: "Espere um pouco e sincronize de novo.",
    acaoDoAgente: "Espere os segundos de `erro.esperaS` antes de chamar de novo, uma vez só. Não repita em laço.",
  },
  crm_fora_do_ar: {
    http: 503,
    saida: 1,
    mensagem: "O CRM não respondeu.",
    acao: "Confira a internet e tente de novo em alguns minutos.",
    acaoDoAgente: "Tente de novo uma vez daqui a alguns minutos. Se repetir, avise o vendedor.",
  },
  crm_resposta_inesperada: {
    http: 502,
    saida: 1,
    mensagem: "O CRM respondeu num formato que a Secretária não conhece.",
    acao: "Tente de novo. Se continuar, peça ao seu agente o diagnóstico da Secretária.",
    acaoDoAgente: "Rode `bun secretaria diagnostico` e mande o resultado ao suporte. Não tente adivinhar o dado.",
  },
  crm_nao_encontrado: {
    http: 404,
    saida: 1,
    mensagem: "O CRM não achou este registro, ou você não tem acesso a ele.",
    acao: "Confira o cliente no CRM.",
    acaoDoAgente:
      "Confira se o id veio de uma resposta do CRM (`buscar_clientes`) e não de um número falado. Não diga que o registro não existe: o CRM responde igual para o que você não vê.",
  },
  crm_ferramenta_recusada: {
    http: 400,
    saida: 1,
    mensagem: "A Secretária não chama esta ferramenta do CRM.",
    acao: "Use a tela do CRM para esta ação.",
  },
  whatsapp_resposta_inesperada: {
    http: 502,
    saida: 1,
    mensagem: "O WhatsApp respondeu num formato que a Secretária não conhece.",
    acao: "Tente de novo. Se continuar, peça ao seu agente o diagnóstico da Secretária.",
    acaoDoAgente:
      "Rode `bun secretaria diagnostico` e mande o resultado ao suporte. Não leia a conversa por outro caminho nem tente adivinhar o dado.",
  },
  interno: {
    http: 500,
    saida: 1,
    mensagem: "Algo falhou dentro da Secretária.",
    acao: "Tente de novo. Se continuar, peça ao seu agente o diagnóstico da Secretária.",
    acaoDoAgente: "Rode `bun secretaria diagnostico` e mande o resultado ao suporte.",
  },
} as const satisfies Record<string, DefinicaoDeErro>;

export type CodigoErro = keyof typeof ERROS;

export interface ErroOperacao {
  readonly codigo: CodigoErro | CodigoProblema;
  readonly mensagem: string;
  /** Próximo passo em uma frase, para o vendedor ou o agente. Obrigatório. */
  readonly acao: string;
  /** Num conflito de versão, o recurso como está agora, para quem chamou recarregar sem outro pedido. */
  readonly atual?: unknown;
  /** No limite de chamadas, os segundos que o CRM pediu de espera. */
  readonly esperaS?: number;
}

export type Resultado<T> = { readonly ok: true; readonly dados: T } | { readonly ok: false; readonly erro: ErroOperacao };

/** Envelope da API e do `--json` do CLI: uma linha, sempre neste formato. */
export type Saida<T> = { readonly v: 1 } & Resultado<T>;

export function ok<T>(dados: T): Resultado<T> {
  return { ok: true, dados };
}

function ehCodigoErro(codigo: CodigoErro | CodigoProblema): codigo is CodigoErro {
  return Object.hasOwn(ERROS, codigo);
}

/** Erro com o texto da tabela. `mensagem` troca o texto quando o contexto pede um mais preciso. */
export function falha(codigo: CodigoErro | CodigoProblema, mensagem?: string): Resultado<never> {
  const definicao = ehCodigoErro(codigo) ? ERROS[codigo] : PROBLEMAS[codigo];
  return { ok: false, erro: { codigo, mensagem: mensagem ?? definicao.mensagem, acao: definicao.acao } };
}

export function saida<T>(resultado: Resultado<T>): Saida<T> {
  return { v: 1, ...resultado };
}

export type Leitor = "vendedor" | "agente";

/**
 * O mesmo erro escrito para quem vai ler. O vendedor recebe o texto fixo da tabela, porque a
 * mensagem trocada pelo contexto costuma ser técnica; o agente recebe essa mensagem e o passo em CLI.
 * Problema de conector já fala com o vendedor e sai igual para os dois.
 */
export function paraOLeitor(erro: ErroOperacao, leitor: Leitor): ErroOperacao {
  if (!ehCodigoErro(erro.codigo)) return erro;
  const definicao: DefinicaoDeErro = ERROS[erro.codigo];
  const extras = { ...(erro.atual === undefined ? {} : { atual: erro.atual }), ...(erro.esperaS === undefined ? {} : { esperaS: erro.esperaS }) };
  if (leitor === "vendedor") return { codigo: erro.codigo, mensagem: definicao.mensagem, acao: definicao.acao, ...extras };
  return { codigo: erro.codigo, mensagem: erro.mensagem, acao: definicao.acaoDoAgente ?? definicao.acao, ...extras };
}

/** Conflito de versão com o recurso atual no corpo: quem chamou sempre tem como recarregar e repetir. */
export function conflito(atual: unknown, codigo: "conflito_de_versao" | "conflito_da_escrita" = "conflito_de_versao"): Resultado<never> {
  const definicao = ERROS[codigo];
  return { ok: false, erro: { codigo, mensagem: definicao.mensagem, acao: definicao.acao, atual } };
}

/** Código de saída do CLI para o erro. Problema de conector é erro de operação comum. */
export function codigoDeSaida(erro: ErroOperacao): number {
  return ehCodigoErro(erro.codigo) ? ERROS[erro.codigo].saida : 1;
}

/** Problema de conector vira 409: o pedido é válido, mas o conector precisa de uma ação antes. */
export function statusHttp(erro: ErroOperacao): number {
  return ehCodigoErro(erro.codigo) ? (ERROS[erro.codigo].http ?? 500) : 409;
}
