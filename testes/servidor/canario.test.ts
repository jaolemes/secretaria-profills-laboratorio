import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { INTERVALO_DO_TESTE_DO_AGENTE_MS } from "../../nucleo/dominio";
import { rodar } from "../cli/rodar";
import { gerarCertificado } from "../falsos/certificado";
import { iniciarCrmFalso } from "../falsos/crm";
import { iniciarImapFalso } from "../falsos/imap";
import { ESPELHAR, PAREAR, REPO, subirPalco } from "./palco";

setDefaultTimeout(90_000);

const ENDERECO = "vendedor@empresa.test";
const PESSOAL = "nome@pessoal.test";
// Gerados agora: um literal no código-fonte apareceria no `git status` de um arquivo ainda sem commit.
const SENHA = `CANARIO-senha-${crypto.randomUUID()}`;
const SENHA_PESSOAL = `CANARIO-senha-pessoal-${crypto.randomUUID()}`;
const QR = `CANARIO-qr-${crypto.randomUUID()}@AbCd==`;
const certificado = gerarCertificado();
const paradas: (() => Promise<void>)[] = [];

afterAll(async () => {
  for (const parar of paradas.splice(0).reverse()) await parar();
});

/** `git status` e o conteúdo de cada arquivo novo ou mudado que ele lista. */
async function oQueOGitVe(): Promise<string> {
  const git = Bun.spawn(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const status = await new Response(git.stdout).text();
  expect(await git.exited).toBe(0);
  let texto = status;
  for (const linha of status.split("\n")) {
    const caminho = join(REPO, linha.slice(3).trim());
    if (linha.length > 3 && existsSync(caminho) && statSync(caminho).isFile()) texto += readFileSync(caminho).toString("latin1");
  }
  return texto;
}

test("token, refresh, as senhas de duas contas de e-mail e QR canários não saem do cofre nem do painel", async () => {
  const crm = iniciarCrmFalso();
  paradas.push(() => crm.parar());
  const imap = await iniciarImapFalso({ seguranca: "tls", certificado, contas: { [ENDERECO]: SENHA, [PESSOAL]: SENHA_PESSOAL } });
  paradas.push(() => imap.parar());
  const p = await subirPalco({ crmRecurso: crm.recurso, crmClientId: crm.clientId, caExtra: certificado.certificado });
  paradas.push(() => p.limpar());
  p.bancada.roteiro({ auth: [{ emitir: "qr_code", dados: { code: QR } }, ...PAREAR.slice(1)], sync: ESPELHAR });
  await p.servidor.pronto;
  const doPainel = await p.eventosDoPainel();
  const doAgente = await p.eventosDoAgente();
  const json = { "Content-Type": "application/json" };

  await p.painel("/api/conectores/whatsapp/conectar", { method: "POST", headers: json, body: '{"meio":"qr"}' });
  await doPainel.ate((e) => e.conectores.whatsapp.estado.fase === "pareando" && e.conectores.whatsapp.estado.meio.tipo === "qr", "QR");
  await p.agente("/api/estado");
  p.bancada.celular("leu");
  p.bancada.celular("sincronizou");
  await doPainel.ate((e) => e.conectores.whatsapp.estado.fase === "confirmar_conta", "confirmar");
  await p.painel("/api/conectores/whatsapp/confirmar", { method: "POST" });

  const destino = (await p.painel("/oauth/crm/iniciar")).headers.get("location") ?? "";
  const query = await crm.autorizar(destino);
  await p.cru(`/oauth/crm/retorno?${query}`, { headers: { "Sec-Fetch-Site": "cross-site" } });

  const contas = [
    { rotulo: "Profills", provedor: "profills", endereco: ENDERECO, servidor: "127.0.0.1", porta: imap.porta, senha: SENHA },
    { rotulo: "Pessoal", provedor: "outro", endereco: PESSOAL, servidor: "127.0.0.1", porta: imap.porta, seguranca: "tls", senha: SENHA_PESSOAL },
  ];
  for (const conta of contas) {
    await p.painel("/api/email/contas", { method: "POST", headers: json, body: JSON.stringify(conta) });
    // O agente tenta mandar a senha: recusado, e a senha não volta em nenhum texto.
    await p.agente("/api/email/contas", { method: "POST", headers: json, body: JSON.stringify(conta) });
  }
  const conectado = await doAgente.ate(
    (e) => e.onboardingCompleto && e.email.contas.length === 2 && e.email.contas.every((c) => c.estado.fase === "conectado"),
    "WhatsApp, CRM e as duas contas conectados, visto pelo agente",
  );
  for (const conta of conectado.email.contas) {
    await p.agente(`/api/email/contas/${conta.id}/conectar`, { method: "POST", headers: json, body: JSON.stringify({ senha: SENHA }) });
    await p.agente(`/api/email/contas/${conta.id}/testar`, { method: "POST" });
  }

  p.bancada.avancar(INTERVALO_DO_TESTE_DO_AGENTE_MS + 1);

  const cli: string[] = [];
  for (const args of [
    ["status", "--json"],
    ["status"],
    ["diagnostico", "--json"],
    ["diagnostico"],
    ["esperar", "crm=conectado", "--ate", "5s", "--json"],
    ["conector", "crm", "testar", "--json"],
    ["email", "testar", "Profills", "--json"],
    ["email", "testar", "pessoal"],
    ["email", "janela", "Pessoal", "60", "--json"],
    ["esperar", "email:Profills=conectado", "--ate", "5s", "--json"],
    ["conector", "whatsapp", "testar", "--json"],
    ["wa", "chats", "list", "--json"],
  ]) {
    const saida = await rodar(p.bancada.dirDados, args);
    expect(saida.codigo).toBe(0);
    cli.push(saida.stdout, saida.stderr);
  }
  await p.agente("/api/diagnostico");
  await p.servidor.parar();
  await doAgente.fim;

  const segredosDoCrm = crm.registro().segredos;
  expect(segredosDoCrm.some((segredo) => segredo.startsWith("CANARIO-access-"))).toBe(true);
  expect(segredosDoCrm.some((segredo) => segredo.startsWith("CANARIO-refresh-"))).toBe(true);
  const canarios = [QR, SENHA, SENHA_PESSOAL, ...segredosDoCrm];

  // A busca enxerga os canários: a senha e o refresh atual estão no cofre, e o QR no SSE do painel.
  const cofre = readFileSync(join(p.bancada.dirDados, "cofre.json"), "utf8");
  expect(cofre).toContain(SENHA);
  expect(cofre).toContain(SENHA_PESSOAL);
  expect(segredosDoCrm.some((segredo) => segredo.startsWith("CANARIO-refresh-") && cofre.includes(segredo))).toBe(true);
  expect(doPainel.textos.join("")).toContain(QR);
  // O SSE do painel leva o QR de propósito, mas nenhuma senha de e-mail.
  expect([SENHA, SENHA_PESSOAL].filter((senha) => doPainel.textos.join("").includes(senha))).toEqual([]);

  const lugares: Record<string, string> = {
    "respostas e SSE do agente": p.vistoPeloAgente.join("\n"),
    "stdout e stderr do CLI": cli.join("\n"),
    "pasta de dados sem o cofre (logs, banco, WAL, servidor.json)": p.bancada.textoDaPastaDeDados(),
    "git status": await oQueOGitVe(),
  };
  expect(p.vistoPeloAgente.length).toBeGreaterThan(10);
  expect(lugares["pasta de dados sem o cofre (logs, banco, WAL, servidor.json)"]).toContain("servidor.no_ar");
  for (const [lugar, texto] of Object.entries(lugares)) {
    expect({ lugar, achados: canarios.filter((canario) => texto.includes(canario)) }).toEqual({ lugar, achados: [] });
  }
});
