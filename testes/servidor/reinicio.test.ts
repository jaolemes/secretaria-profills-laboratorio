import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { acoesPossiveis, type EstadoPainel } from "../../nucleo/dominio";
import { iniciarServidor } from "../../nucleo/servidor";
import { entrarComoPainel, prepararPasta, rodar, subirEmProcesso } from "../cli/rodar";
import { vivo, type Alvos } from "../falsos/bancada";
import { gerarCertificado } from "../falsos/certificado";
import { iniciarCrmFalso } from "../falsos/crm";
import { iniciarImapFalso } from "../falsos/imap";
import { ESPELHAR, PAREAR } from "./palco";

setDefaultTimeout(60_000);

const certificado = gerarCertificado();
let portaDoImap = 0;
const paradas: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const parar of paradas.splice(0).reverse()) await parar();
});

type Pasta = ReturnType<typeof prepararPasta>;

interface Caso {
  readonly nome: string;
  /** Conector único, ou `email:<rótulo>` de uma conta. */
  readonly id: string;
  readonly fase: string;
  alvos(): Promise<Alvos>;
  levar(pasta: Pasta): Promise<void>;
}

const CASOS: readonly Caso[] = [
  {
    nome: "WhatsApp pareando, com o wacli segurando a store",
    id: "whatsapp",
    fase: "pareando",
    alvos: async () => ({}),
    async levar(pasta) {
      pasta.bancada.roteiro({ auth: PAREAR, sync: ESPELHAR });
      await rodar(pasta.bancada.dirDados, ["conector", "whatsapp", "conectar", "--json"]);
    },
  },
  {
    nome: "WhatsApp sincronizando, já pareado",
    id: "whatsapp",
    fase: "sincronizando",
    alvos: async () => ({}),
    async levar(pasta) {
      pasta.bancada.roteiro({ auth: PAREAR, sync: ESPELHAR });
      await rodar(pasta.bancada.dirDados, ["conector", "whatsapp", "conectar", "--json"]);
      await rodar(pasta.bancada.dirDados, ["esperar", "whatsapp=pareando", "--ate", "10s"]);
      pasta.bancada.celular("leu");
    },
  },
  {
    nome: "CRM autorizando, com o login aberto no navegador",
    id: "crm",
    fase: "autorizando",
    async alvos() {
      const crm = iniciarCrmFalso();
      paradas.push(() => crm.parar());
      return { crmRecurso: crm.recurso, crmClientId: crm.clientId };
    },
    async levar(pasta) {
      const { origem, cookie } = await entrarComoPainel(pasta.bancada.dirDados);
      const inicio = await fetch(`${origem}/oauth/crm/iniciar`, { redirect: "manual", headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } });
      expect(inicio.status).toBe(303);
    },
  },
  ...["Profills", "Pessoal"].map(
    (rotulo, i): Caso => ({
      nome: `E-mail "${rotulo}" testando, com o servidor IMAP mudo`,
      id: `email:${rotulo}`,
      fase: "testando",
      async alvos() {
        const imap = await iniciarImapFalso({ seguranca: "tls", certificado, contas: {}, modo: "mudo" });
        paradas.push(() => imap.parar());
        portaDoImap = imap.porta;
        return { caExtra: certificado.certificado };
      },
      async levar(pasta) {
        const { origem, cookie } = await entrarComoPainel(pasta.bancada.dirDados);
        const cabecalhos = { Cookie: cookie, Origin: origem, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
        // As duas contas ficam em testando; o caso confere a de índice `i`.
        for (const [j, outro] of ["Profills", "Pessoal"].entries()) {
          const pedido = await fetch(`${origem}/api/email/contas`, {
            method: "POST",
            headers: cabecalhos,
            body: JSON.stringify({ rotulo: outro, provedor: "outro", endereco: `v${j}@empresa.test`, servidor: "127.0.0.1", porta: portaDoImap, seguranca: "tls", senha: "CANARIO-x" }),
          });
          expect(pedido.status).toBe(200);
        }
        expect(i).toBeLessThan(2);
      },
    }),
  ),
];

describe("queda do servidor no meio de cada fase transitória", () => {
  test.each(CASOS.map((caso) => [caso.nome, caso] as const))("%s: depois de subir de novo, há ação possível", async (_nome, caso) => {
    const pasta = prepararPasta(await caso.alvos());
    paradas.push(() => pasta.bancada.limpar());
    const dir = pasta.bancada.dirDados;
    const caido = await subirEmProcesso(dir);
    paradas.push(async () => {
      if (vivo(caido.pid)) await caido.matar();
    });

    await caso.levar(pasta);
    const chegou = await rodar(dir, ["esperar", `${caso.id}=${caso.fase}`, "--ate", "15s", "--json"]);
    expect(chegou.codigo).toBe(0);
    await caido.matar();

    const servidor = await iniciarServidor(pasta.ambiente());
    paradas.push(() => servidor.parar());
    await servidor.pronto;
    const resposta = await rodar(dir, ["status", "--json"]);
    const lido = resposta.envelope?.dados as EstadoPainel;
    const estado = caso.id.startsWith("email:")
      ? lido.email.contas.find((conta) => conta.rotulo === caso.id.slice("email:".length))!
      : lido.conectores[caso.id as "whatsapp" | "crm"];
    if (caso.id.startsWith("email:")) expect(lido.email.contas.map((conta) => conta.estado.fase)).toEqual(["desconectado", "desconectado"]);
    expect(estado.estado.fase).not.toBe(caso.fase);
    expect(estado.acoes.length).toBeGreaterThan(0);
    expect(estado.acoes).toEqual([...acoesPossiveis(estado.estado)]);

    await servidor.parar();
    // O wacli que o servidor morto deixou para trás não sobrevive à volta e à parada do novo.
    expect(pasta.bancada.chamadas().filter((chamada) => vivo(chamada.pid))).toEqual([]);
  });
});
