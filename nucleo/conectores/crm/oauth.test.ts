import { afterEach, describe, expect, test } from "bun:test";
import { descobrir, mesmoState } from "./oauth";

type Documentos = { recurso: Record<string, unknown>; servidor: Record<string, unknown> };

const servidores: { stop(fechar: boolean): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servidores.splice(0).map((servidor) => servidor.stop(true)));
});

/** Serve os dois `.well-known`. `mudar` recebe os documentos corretos e devolve o que o teste quer ver recusado. */
function crm(mudar: (documentos: Documentos, origem: string) => void = () => {}): URL {
  const servidor = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(pedido) {
      const origem = `http://127.0.0.1:${servidor.port}`;
      const documentos: Documentos = {
        recurso: { resource: `${origem}/mcp`, authorization_servers: [origem] },
        servidor: {
          issuer: origem,
          authorization_endpoint: `${origem}/oauth/authorize`,
          token_endpoint: `${origem}/oauth/token`,
          code_challenge_methods_supported: ["S256"],
        },
      };
      mudar(documentos, origem);
      const caminho = new URL(pedido.url).pathname;
      if (caminho === "/.well-known/oauth-protected-resource/mcp") return Response.json(documentos.recurso);
      if (caminho === "/.well-known/oauth-authorization-server") return Response.json(documentos.servidor);
      return new Response(null, { status: 404 });
    },
  });
  servidores.push(servidor);
  return new URL(`http://127.0.0.1:${servidor.port}/mcp`);
}

const semPrazo = () => new AbortController().signal;

describe("descoberta do servidor de autorização", () => {
  test("lê os dois documentos e devolve emissor e endpoints", async () => {
    const recurso = crm();
    const descoberta = await descobrir(recurso, semPrazo());
    expect(descoberta.ok && descoberta.valor.emissor).toBe(recurso.origin);
    expect(descoberta.ok && descoberta.valor.token.href).toBe(`${recurso.origin}/oauth/token`);
    expect(descoberta.ok && descoberta.valor.autorizacao.href).toBe(`${recurso.origin}/oauth/authorize`);
  });

  test.each<[string, (documentos: Documentos, origem: string) => void]>([
    ["recurso de outro servidor", (d) => (d.recurso.resource = "https://outro.invalid/mcp")],
    ["nenhum servidor de autorização", (d) => (d.recurso.authorization_servers = [])],
    ["servidor de autorização em http fora do loopback", (d) => (d.recurso.authorization_servers = ["http://crm.invalid"])],
    ["emissor diferente do anunciado", (d) => (d.servidor.issuer = "https://outro.invalid")],
    ["token endpoint em http fora do loopback", (d) => (d.servidor.token_endpoint = "http://crm.invalid/oauth/token")],
    ["authorize que não é URL", (d) => (d.servidor.authorization_endpoint = "javascript:alert(1)")],
    ["sem PKCE S256", (d) => (d.servidor.code_challenge_methods_supported = ["plain"])],
    ["metadados sem token endpoint", (d) => delete d.servidor.token_endpoint],
  ])("recusa %s", async (_nome, mudar) => {
    const descoberta = await descobrir(crm(mudar), semPrazo());
    expect(descoberta).toMatchObject({ ok: false, falha: { motivo: "retorno_invalido" } });
  });

  test("servidor que não responde é inacessível, não inválido", async () => {
    const recurso = crm();
    await servidores.pop()?.stop(true);
    expect(await descobrir(recurso, semPrazo())).toMatchObject({ ok: false, falha: { motivo: "inacessivel" } });
  });

  test("pedido cortado pelo sinal devolve falha em vez de lançar", async () => {
    const aborto = new AbortController();
    aborto.abort();
    expect(await descobrir(crm(), aborto.signal)).toMatchObject({ ok: false, falha: { motivo: "inacessivel" } });
  });
});

describe("state do retorno", () => {
  test("só o valor exato passa", () => {
    expect(mesmoState("abc", "abc")).toBe(true);
    expect(mesmoState("abc", "abd")).toBe(false);
    expect(mesmoState("abc", "abcd")).toBe(false);
    expect(mesmoState("", "abc")).toBe(false);
  });
});
