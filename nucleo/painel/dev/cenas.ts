import {
  PROBLEMAS,
  PRAZOS_MS,
  instante,
  lerEnderecoEmail,
  lerTelefone,
  montarEstadoPainel,
  payloadQr,
  somar,
  type CodigoProblema,
  type ConfigEmail,
  type ContaWhatsapp,
  type EstadoDoEmail,
  type EstadoEmail,
  type EstadoPainel,
  type ContaEmailComEstado,
  type IdContaEmail,
  type Instante,
  type ProblemaDe,
  type ProvedorEmail,
  type RetratoDosConectores,
} from "../../dominio";

/** Dados de mentira, só para o servidor de desenvolvimento desenhar cada estado. */
const conta: ContaWhatsapp = { telefone: lerTelefone("+5511900004321")! };
const config: ConfigEmail = {
  endereco: lerEnderecoEmail("vendedor@exemplo.com.br")!,
  servidor: "imap.exemplo.com.br",
  porta: 993,
  seguranca: "tls",
};

export function qrDaRodada(rodada: number) {
  return payloadQr(`2@painel-dev-rodada-${rodada},chave-de-mentira-${"x".repeat(40)},${rodada}`);
}

type Cena = (agora: Instante) => Partial<RetratoDosConectores>;

/** Uma conta "Profills" no estado pedido. */
function umaConta(estado: EstadoEmail): EstadoDoEmail {
  const id = "00000000-0000-4000-8000-000000000001" as IdContaEmail;
  return { pulado: false, contas: [{ id, rotulo: "Profills", provedor: "profills", config, janelaDias: 30, estado }] };
}

const minutosAtras = (agora: Instante, minutos: number) => somar(agora, -minutos * 60_000);

const idDaConta = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as IdContaEmail;

function contaDe(n: number, rotulo: string, provedor: ProvedorEmail, endereco: string, estado: EstadoEmail): ContaEmailComEstado {
  const servidor = provedor === "gmail" ? "imap.gmail.com" : provedor === "profills" ? "imap.kinghost.net" : "imap.exemplo.com.br";
  return { id: idDaConta(n), rotulo, provedor, config: { endereco: lerEnderecoEmail(endereco)!, servidor, porta: 993, seguranca: "tls" }, janelaDias: 30, estado };
}

const conectada = (agora: Instante, minutos = 2): EstadoEmail => ({ fase: "conectado", verificadoEm: minutosAtras(agora, minutos), caixaDeEntrada: { mensagens: 1250, naoLidas: 7 } });

/** WhatsApp e CRM de pé, para as cenas do e-mail mostrarem o resto da tela como o vendedor vê. */
const baseConectada = (agora: Instante) => ({
  whatsapp: { fase: "conectado", conta, verificadoEm: agora, espelho: "ao_vivo", ultimaAtividade: minutosAtras(agora, 3) },
  crm: { fase: "conectado", conexaoExpiraEm: somar(agora, 90 * 24 * 60 * 60_000), verificadoEm: agora, ferramentas: 12 },
}) as const;

const CENAS_DE_FASE = {
  "tudo-desconectado": () => ({}),
  "whatsapp-iniciando": (agora) => ({
    whatsapp: { fase: "pareando", meio: { tipo: "iniciando" }, expiraEm: somar(agora, PRAZOS_MS.pareamento) },
  }),
  "whatsapp-qr": (agora) => ({
    whatsapp: { fase: "pareando", meio: { tipo: "qr", qr: qrDaRodada(1), emitidoEm: agora }, expiraEm: somar(agora, PRAZOS_MS.pareamento) },
  }),
  "whatsapp-codigo": (agora) => ({
    whatsapp: {
      fase: "pareando",
      meio: { tipo: "codigo", codigo: "K7QD-2MXP", telefone: conta.telefone },
      expiraEm: somar(agora, PRAZOS_MS.pareamento),
    },
  }),
  "whatsapp-sincronizando": (agora) => ({
    whatsapp: { fase: "sincronizando", mensagens: 1250, desde: minutosAtras(agora, 2), expiraEm: somar(agora, PRAZOS_MS.sincronizacao) },
  }),
  "whatsapp-confirmar-conta": () => ({ whatsapp: { fase: "confirmar_conta", conta } }),
  "whatsapp-conectado": (agora) => ({
    whatsapp: { fase: "conectado", conta, verificadoEm: agora, espelho: "ao_vivo", ultimaAtividade: minutosAtras(agora, 3) },
  }),
  "crm-autorizando": (agora) => ({
    crm: { fase: "autorizando", expiraEm: somar(agora, PRAZOS_MS.autorizacao), anterior: { fase: "desconectado" } },
  }),
  "crm-conectado": (agora) => ({
    crm: { fase: "conectado", conexaoExpiraEm: somar(agora, 90 * 24 * 60 * 60_000), verificadoEm: agora, ferramentas: 12 },
  }),
  "email-testando": (agora) => ({
    email: umaConta({ fase: "testando", config, expiraEm: somar(agora, PRAZOS_MS.testeDoEmail), anterior: { fase: "desconectado" } }),
  }),
  "email-conectado": (agora) => ({
    email: umaConta({ fase: "conectado", verificadoEm: agora, caixaDeEntrada: { mensagens: 1250, naoLidas: 7 } }),
  }),
  "email-conta-desconectada": () => ({ email: umaConta({ fase: "desconectado" }) }),
  "email-pulado": () => ({ email: { pulado: true, contas: [] } }),
  "email-duas-contas": (agora) => ({
    email: {
      pulado: false,
      contas: [
        ...umaConta({ fase: "conectado", verificadoEm: agora, caixaDeEntrada: { mensagens: 1250, naoLidas: 7 } }).contas,
        {
          id: "00000000-0000-4000-8000-000000000002" as IdContaEmail,
          rotulo: "Pessoal",
          provedor: "gmail",
          config: { endereco: lerEnderecoEmail("vendedor@gmail.com")!, servidor: "imap.gmail.com", porta: 993, seguranca: "tls" },
          janelaDias: 90,
          estado: { fase: "atencao", problema: { codigo: "email_gmail_senha_de_app", desde: minutosAtras(agora, 5) } },
        },
      ],
    },
  }),
  "email-sem-conta": (agora) => ({ ...baseConectada(agora), email: { pulado: false, contas: [] } }),
  "email-uma-conta": (agora) => ({
    ...baseConectada(agora),
    email: { pulado: false, contas: [contaDe(1, "Profills", "profills", "vendedor@profills.test", conectada(agora))] },
  }),
  "email-duas-conectadas": (agora) => ({
    ...baseConectada(agora),
    email: {
      pulado: false,
      contas: [
        contaDe(1, "Profills", "profills", "vendedor@profills.test", conectada(agora)),
        contaDe(2, "Pessoal", "gmail", "um.endereco.bem.comprido.de.vendedor@gmail.com", conectada(agora, 40)),
      ],
    },
  }),
  "email-uma-em-atencao": (agora) => ({
    ...baseConectada(agora),
    email: {
      pulado: false,
      contas: [
        contaDe(1, "Profills", "profills", "vendedor@profills.test", { fase: "atencao", problema: { codigo: "email_senha_recusada", desde: minutosAtras(agora, 10) } }),
        contaDe(2, "Pessoal", "gmail", "vendedor@gmail.com", conectada(agora, 15)),
      ],
    },
  }),
  "email-gmail-senha-de-app": (agora) => ({
    ...baseConectada(agora),
    email: {
      pulado: false,
      contas: [contaDe(2, "Pessoal", "gmail", "vendedor@gmail.com", { fase: "atencao", problema: { codigo: "email_gmail_senha_de_app", desde: minutosAtras(agora, 5) } })],
    },
  }),
  "email-testando-conta": (agora) => ({
    ...baseConectada(agora),
    email: {
      pulado: false,
      contas: [
        contaDe(1, "Profills", "profills", "vendedor@profills.test", {
          fase: "testando",
          config: { endereco: lerEnderecoEmail("vendedor@profills.test")!, servidor: "imap.kinghost.net", porta: 993, seguranca: "tls" },
          expiraEm: somar(agora, PRAZOS_MS.testeDoEmail),
          anterior: { fase: "desconectado" },
        }),
      ],
    },
  }),
  "email-limite": (agora) => ({
    ...baseConectada(agora),
    email: {
      pulado: false,
      contas: [
        contaDe(1, "Profills", "profills", "vendedor@profills.test", conectada(agora)),
        contaDe(2, "Pessoal", "gmail", "vendedor@gmail.com", conectada(agora, 30)),
        contaDe(3, "Vendas", "outro", "vendas@loja.test", { fase: "desconectado" }),
        contaDe(4, "Suporte", "outro", "suporte@loja.test", { fase: "atencao", problema: { codigo: "email_servidor_inacessivel", desde: minutosAtras(agora, 20) } }),
        contaDe(5, "Antigo", "outro", "antigo@loja.test", conectada(agora, 90)),
      ],
    },
  }),
  "dois-de-tres": (agora) => ({
    whatsapp: { fase: "conectado", conta, verificadoEm: agora, espelho: "reconectando", ultimaAtividade: null },
    crm: { fase: "conectado", conexaoExpiraEm: somar(agora, 90 * 24 * 60 * 60_000), verificadoEm: agora, ferramentas: null },
  }),
  "meu-dia-crm-nao-liberado": (agora) => ({
    ...baseConectada(agora),
    crm: { fase: "atencao", problema: { codigo: "crm_app_nao_liberado", desde: minutosAtras(agora, 30) } },
  }),
  "meu-dia-crm-desconectado": (agora) => ({ whatsapp: baseConectada(agora).whatsapp }),
  "meu-dia-whatsapp-desconectado": (agora) => ({ crm: baseConectada(agora).crm }),
  "tudo-conectado": (agora) => ({
    whatsapp: { fase: "conectado", conta, verificadoEm: agora, espelho: "ao_vivo", ultimaAtividade: minutosAtras(agora, 3) },
    crm: { fase: "conectado", conexaoExpiraEm: somar(agora, 90 * 24 * 60 * 60_000), verificadoEm: agora, ferramentas: 12 },
    email: umaConta({ fase: "conectado", verificadoEm: agora, caixaDeEntrada: null }),
  }),
} as const satisfies Record<string, Cena>;

/** Um problema por cena, gerado da tabela: problema novo no domínio ganha cena sem mexer aqui. */
function cenaDoProblema(codigo: CodigoProblema): Cena {
  return (agora) => {
    const desde = minutosAtras(agora, 5);
    switch (PROBLEMAS[codigo].conector) {
      case "whatsapp": {
        const comConta = codigo === "whatsapp_espelho_caindo" || codigo === "whatsapp_limite_do_banco";
        return { whatsapp: { fase: "atencao", problema: { codigo: codigo as ProblemaDe<"whatsapp">, desde }, conta: comConta ? conta : null } };
      }
      case "crm":
        return { crm: { fase: "atencao", problema: { codigo: codigo as ProblemaDe<"crm">, desde } } };
      case "email":
        return { email: umaConta({ fase: "atencao", problema: { codigo: codigo as ProblemaDe<"email">, desde } }) };
    }
  };
}

const CENAS_DE_PROBLEMA = Object.fromEntries(
  (Object.keys(PROBLEMAS) as CodigoProblema[]).map((codigo) => [`problema-${codigo}`, cenaDoProblema(codigo)]),
) as Record<`problema-${CodigoProblema}`, Cena>;

/** Endereços da gaveta para abrir direto em cada passo, com a cena que faz sentido para ele. */
export const GAVETAS_DE_EXEMPLO = {
  detalhe: `/?cena=email-duas-conectadas#/conexoes/email/${idDaConta(1)}`,
  detalheComProblema: `/?cena=email-uma-em-atencao#/conexoes/email/${idDaConta(1)}`,
  detalheDoGmail: `/?cena=email-gmail-senha-de-app#/conexoes/email/${idDaConta(2)}`,
  detalheTestando: `/?cena=email-testando-conta#/conexoes/email/${idDaConta(1)}`,
  provedor: "/?cena=email-sem-conta#/conexoes/email/nova",
  profills: "/?cena=email-sem-conta#/conexoes/email/nova/profills",
  gmail: "/?cena=email-sem-conta#/conexoes/email/nova/gmail",
  outro: "/?cena=email-sem-conta#/conexoes/email/nova/outro",
  testeEmAndamento: "/?cena=email-sem-conta&teste=lento#/conexoes/email/nova/profills",
  erroNoConectar: "/?cena=email-sem-conta&falha=1#/conexoes/email/nova/profills",
} as const;

/** Endereços do Meu dia para cada estado dos ignorados pelo agente e das ações da proposta. */
export const MEU_DIA_DE_EXEMPLO = {
  umIgnorado: "/?cena=tudo-conectado&crm=cheio#/meu-dia",
  doisIgnorados: "/?cena=tudo-conectado&crm=ignorados#/meu-dia",
  listaDosIgnorados: "/?cena=tudo-conectado&crm=ignorados#/meu-dia/ignorados",
  propostasComESemLink: "/?cena=tudo-conectado&crm=cheio#/meu-dia/propostas",
  crmNaoLiberado: "/?cena=meu-dia-crm-nao-liberado#/meu-dia/fazer-hoje",
  conversas: "/?cena=tudo-conectado&crm=cheio&conversas=cheio#/meu-dia/responder",
  esperandoCliente: "/?cena=tudo-conectado&crm=cheio&conversas=cheio#/meu-dia/esperando-cliente",
  conversasSemLeitura: "/?cena=tudo-conectado#/meu-dia/responder",
  tudoEmZero: "/?cena=tudo-conectado&crm=vazio&conversas=vazio&tarefas=vazio#/meu-dia",
  whatsappDesconectado: "/?cena=meu-dia-whatsapp-desconectado#/meu-dia/responder",
} as const;

export const CENAS: Readonly<Record<string, Cena>> = { ...CENAS_DE_FASE, ...CENAS_DE_PROBLEMA };
export const NOMES_DAS_CENAS = Object.keys(CENAS);
export const CENA_PADRAO = "tudo-desconectado";

export function montarCena(nome: string, agora: Date): EstadoPainel | null {
  const cena = CENAS[nome];
  if (cena === undefined) return null;
  const momento = instante(agora);
  const estados: RetratoDosConectores = {
    whatsapp: { fase: "desconectado" },
    crm: { fase: "desconectado" },
    email: { pulado: false, contas: [] },
    ...cena(momento),
  };
  return montarEstadoPainel({ id: "painel-dev", versaoNucleo: "0.1.0", criadaEm: momento }, estados);
}
