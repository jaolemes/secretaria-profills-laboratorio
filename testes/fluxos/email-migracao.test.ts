import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caminhosDosDados } from "../../nucleo/ambiente";
import { PASTA_DO_NUCLEO, abrirBanco, listarContasEmail, migrar, type BancoAberto } from "../../nucleo/banco";
import { Segredo, abrirCofre, chaveDaSenhaDoEmail, type Cofre } from "../../nucleo/cofre";
import { criarConectores, type Conectores } from "../../nucleo/conectores";
import { instante } from "../../nucleo/dominio";
import { criarRegistro } from "../../nucleo/registro";
import { abrirOBanco, montarAmbiente } from "../falsos/bancada";
import { gerarCertificado } from "../falsos/certificado";
import { iniciarImapFalso, type ImapFalso } from "../falsos/imap";

setDefaultTimeout(30_000);

const ENDERECO = "vendedor@empresa.test";
const SENHA = `CANARIO-senha-antiga-${crypto.randomUUID()}`;
const SENHA_NOVA = `CANARIO-senha-nova-${crypto.randomUUID()}`;
const certificado = gerarCertificado();
const agora = () => instante(new Date());

interface Instalacao {
  readonly raiz: string;
  readonly dirDados: string;
  readonly cofre: Cofre;
  readonly linhas: string[];
  banco: BancoAberto | null;
  ligados: Conectores[];
}

const instalacoes: Instalacao[] = [];
const servidores: ImapFalso[] = [];

afterEach(async () => {
  for (const inst of instalacoes.splice(0)) {
    await Promise.all(inst.ligados.map((c) => c.parar()));
    inst.banco?.fechar();
    expect(inst.linhas.join("\n")).not.toContain("CANARIO");
    rmSync(inst.raiz, { recursive: true, force: true });
  }
  await Promise.all(servidores.splice(0).map((s) => s.parar()));
});

/** Uma pasta de dados da versão de conta única: banco até a migração 0003 e a senha em `email.senha`. */
async function instalacaoAntiga(imap: ImapFalso | null, opcoes: { readonly conectada?: boolean; readonly senha?: boolean } = {}): Promise<Instalacao> {
  const raiz = mkdtempSync(join(tmpdir(), "secretaria-migracao-email-"));
  const dirDados = join(raiz, "dados");
  const antigas = join(raiz, "migracoes-antigas");
  mkdirSync(antigas, { recursive: true });
  for (const nome of readdirSync(PASTA_DO_NUCLEO).filter((nome) => nome.endsWith(".sql") && nome < "0004")) copyFileSync(join(PASTA_DO_NUCLEO, nome), join(antigas, nome));
  const banco = abrirBanco(caminhosDosDados({ dirDados, plataforma: process.platform }).banco);
  migrar(banco.sqlite, { trilha: "nucleo", pasta: antigas, dirBackups: join(raiz, "backups"), agora: agora() });
  if (opcoes.conectada !== false && imap !== null) {
    const config = JSON.stringify({ servidor: "127.0.0.1", porta: imap.porta, seguranca: "tls" });
    banco.sqlite.run("UPDATE conector SET fase = 'conectado', identidade = ?, config = ?, verificado_em = ? WHERE id = 'email'", [ENDERECO, config, agora()]);
  }
  banco.fechar();
  const cofre = abrirCofre({ backend: "arquivo", idInstalacao: "migracao", dirDados });
  if (opcoes.senha !== false) await cofre.gravar("email.senha", Segredo.de(SENHA));
  const inst: Instalacao = { raiz, dirDados, cofre, linhas: [], banco: null, ligados: [] };
  instalacoes.push(inst);
  return inst;
}

function subir(inst: Instalacao, cofre: Cofre = inst.cofre): Conectores {
  inst.banco ??= abrirOBanco(inst.dirDados, join(inst.raiz, "sem-migracoes"), agora());
  const ambiente = montarAmbiente(inst.dirDados, join(inst.raiz, "falso"), { caExtra: certificado.certificado }, agora);
  const registro = criarRegistro({ escrever: (linha) => inst.linhas.push(linha), agora });
  const conectores = criarConectores(ambiente, inst.banco, cofre, { registro });
  inst.ligados.push(conectores);
  return conectores;
}

async function descer(inst: Instalacao): Promise<void> {
  await Promise.all(inst.ligados.splice(0).map((c) => c.parar()));
  inst.banco?.fechar();
  inst.banco = null;
}

async function imapComSenha(senha: string): Promise<ImapFalso> {
  const servidor = await iniciarImapFalso({ seguranca: "tls", certificado, contas: { [ENDERECO]: senha } });
  servidores.push(servidor);
  return servidor;
}

const senhaDe = async (cofre: Cofre, chave: Parameters<Cofre["ler"]>[0]) => (await cofre.ler(chave))?.revelar() ?? null;

describe("migração da senha da conta única", () => {
  test("a conta conectada continua conectada: a senha passa para a chave da conta e a antiga sai", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap);
    const conectores = subir(inst);
    const [conta] = conectores.estado().email.contas;
    expect(conta).toMatchObject({ rotulo: "Profills", janelaDias: 30, estado: { fase: "conectado" } });
    await conectores.pronto;
    expect(conectores.estado().email.contas[0]?.estado).toMatchObject({ fase: "conectado", caixaDeEntrada: { mensagens: 7 } });
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(conta!.id))).toBe(SENHA);
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
    expect(listarContasEmail(inst.banco!)[0]?.senhaLegada).toBe(false);
    expect(imap.logins().cifrados).toBe(1);
  });

  test("subir duas vezes converge no mesmo lugar", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap);
    await subir(inst).pronto;
    const id = listarContasEmail(inst.banco!)[0]!.conta.id;
    await descer(inst);
    const segundo = subir(inst);
    await segundo.pronto;
    expect(segundo.estado().email.contas.map((c) => [c.id, c.estado.fase])).toEqual([[id, "conectado"]]);
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(id))).toBe(SENHA);
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
  });

  test("queda depois de copiar e antes de apagar a antiga: a cópia fica, a antiga sai, e um login novo não é sobrescrito", async () => {
    const imap = await imapComSenha(SENHA_NOVA);
    const inst = await instalacaoAntiga(imap);
    inst.banco = abrirOBanco(inst.dirDados, join(inst.raiz, "sem-migracoes"), agora());
    const id = listarContasEmail(inst.banco)[0]!.conta.id;
    // Como se a queda viesse logo depois da cópia, e o vendedor tivesse conectado de novo com outra senha.
    await inst.cofre.gravar(chaveDaSenhaDoEmail(id), Segredo.de(SENHA_NOVA));
    const conectores = subir(inst);
    await conectores.pronto;
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(id))).toBe(SENHA_NOVA);
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
    expect(listarContasEmail(inst.banco)[0]?.senhaLegada).toBe(false);
    expect(conectores.estado().email.contas[0]?.estado.fase).toBe("conectado");
  });

  test("queda depois de apagar a antiga e antes de soltar a marca: a marca sai e a senha fica", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap);
    inst.banco = abrirOBanco(inst.dirDados, join(inst.raiz, "sem-migracoes"), agora());
    const id = listarContasEmail(inst.banco)[0]!.conta.id;
    await inst.cofre.gravar(chaveDaSenhaDoEmail(id), Segredo.de(SENHA));
    await inst.cofre.apagar("email.senha");
    const conectores = subir(inst);
    await conectores.pronto;
    expect(listarContasEmail(inst.banco)[0]?.senhaLegada).toBe(false);
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(id))).toBe(SENHA);
    expect(conectores.estado().email.contas[0]?.estado.fase).toBe("conectado");
  });

  test("sem conta, a senha antiga que sobrou é apagada", async () => {
    const inst = await instalacaoAntiga(null, { conectada: false });
    const conectores = subir(inst);
    await conectores.pronto;
    expect(conectores.estado().email).toEqual({ pulado: false, contas: [] });
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
  });

  test("conta antiga sem senha no cofre vira desconectada, sem erro", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap, { senha: false });
    const conectores = subir(inst);
    await conectores.pronto;
    expect(conectores.estado().email.contas[0]?.estado).toEqual({ fase: "desconectado" });
    expect(listarContasEmail(inst.banco!)[0]?.senhaLegada).toBe(false);
  });

  test("cofre fora do ar na subida: nada se perde, e a subida seguinte migra", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap);
    const fora: Cofre = {
      backend: "arquivo",
      ler: async () => {
        throw new Error("chaveiro fora do ar");
      },
      gravar: async () => {
        throw new Error("chaveiro fora do ar");
      },
      apagar: async () => {
        throw new Error("chaveiro fora do ar");
      },
    };
    const primeiro = subir(inst, fora);
    await primeiro.pronto;
    expect(primeiro.estado().email.contas[0]?.estado.fase).toBe("conectado");
    expect(listarContasEmail(inst.banco!)[0]).toMatchObject({ senhaLegada: true, estado: { fase: "conectado" } });
    expect(await senhaDe(inst.cofre, "email.senha")).toBe(SENHA);
    await descer(inst);

    const segundo = subir(inst);
    await segundo.pronto;
    const id = segundo.estado().email.contas[0]!.id;
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(id))).toBe(SENHA);
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
    expect(segundo.estado().email.contas[0]?.estado.fase).toBe("conectado");
  });

  test("remover a conta migrada antes de a senha sair da chave antiga apaga as duas", async () => {
    const imap = await imapComSenha(SENHA);
    const inst = await instalacaoAntiga(imap);
    const conectores = subir(inst);
    const id = conectores.estado().email.contas[0]!.id;
    expect((await conectores.email.remover(id)).ok).toBe(true);
    await conectores.pronto;
    expect(await senhaDe(inst.cofre, "email.senha")).toBeNull();
    expect(await senhaDe(inst.cofre, chaveDaSenhaDoEmail(id))).toBeNull();
  });
});
