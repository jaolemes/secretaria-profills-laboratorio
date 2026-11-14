import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { LIMITE_DO_CORPO } from "../../nucleo/servidor";
import { NAVEGACAO_DE_TOPO, subirPalco, type Palco } from "./palco";

setDefaultTimeout(30_000);

let palco: Palco;

beforeAll(async () => {
  palco = await subirPalco();
});

afterAll(async () => {
  await palco.limpar();
});

async function erro(resposta: Response): Promise<{ status: number; codigo: string; dados: unknown }> {
  const corpo = (await resposta.json()) as { ok: boolean; dados?: unknown; erro?: { codigo: string } };
  return { status: resposta.status, codigo: corpo.erro?.codigo ?? "ok", dados: corpo.dados };
}

describe("guarda HTTP", () => {
  test("Host trocado recebe 403 e nenhum dado", async () => {
    const resposta = await palco.painel("/api/estado", { headers: { Host: "secretaria.invalid" } });
    expect(await erro(resposta)).toEqual({ status: 403, codigo: "origem_recusada", dados: undefined });
    const comLocalhost = await palco.agente("/api/estado", { headers: { Host: `localhost:${palco.servidor.porta}` } });
    expect((await erro(comLocalhost)).status).toBe(403);
  });

  test("Origin de outro site recebe 403", async () => {
    const resposta = await palco.painel("/api/conectores/whatsapp/cancelar", {
      method: "POST",
      headers: { Origin: "https://ataque.invalid" },
    });
    expect(await erro(resposta)).toMatchObject({ status: 403, codigo: "origem_recusada" });
  });

  test("Origin de outra porta do mesmo 127.0.0.1 recebe 403", async () => {
    const resposta = await palco.painel("/api/estado", { headers: { Origin: "http://127.0.0.1:1" } });
    expect((await erro(resposta)).status).toBe(403);
  });

  test("Sec-Fetch-Site cross-site e same-site recebem 403", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const resposta = await palco.painel("/api/estado", { headers: { "Sec-Fetch-Site": site } });
      expect(await erro(resposta)).toMatchObject({ status: 403, codigo: "origem_recusada" });
    }
  });

  test("sem sessão recebe 401 na API e a página de entrada no painel", async () => {
    expect(await erro(await palco.cru("/api/estado"))).toEqual({ status: 401, codigo: "nao_autorizado", dados: undefined });
    expect((await erro(await palco.cru("/api/eventos"))).status).toBe(401);
    const pagina = await palco.cru("/");
    expect(pagina.status).toBe(401);
    expect(await pagina.text()).toContain("bun secretaria abrir");
    const cookieFalso = await palco.cru("/api/estado", { headers: { Cookie: "secretaria_sessao=inventado" } });
    expect((await erro(cookieFalso)).status).toBe(401);
  });

  test("Bearer errado recebe 401; Bearer com Origin recebe 403", async () => {
    const errado = await palco.cru("/api/estado", { headers: { Authorization: "Bearer inventado" } });
    expect((await erro(errado)).status).toBe(401);
    const comOrigin = await palco.agente("/api/estado", { headers: { Origin: palco.servidor.origem } });
    expect((await erro(comOrigin)).status).toBe(403);
  });

  test("anônimo só lê /api/info", async () => {
    const info = await erro(await palco.cru("/api/info"));
    expect(info).toMatchObject({ status: 200, codigo: "ok", dados: { app: "secretaria-profills", idInstalacao: palco.arquivo.idInstalacao } });
    const bilhete = await palco.cru("/api/sessoes/bilhete", { method: "POST" });
    expect((await erro(bilhete)).status).toBe(401);
  });

  test("o painel não pede bilhete nem para o servidor: são do agente", async () => {
    expect((await erro(await palco.painel("/api/sessoes/bilhete", { method: "POST" }))).status).toBe(401);
    expect((await erro(await palco.painel("/api/servidor/parar", { method: "POST" }))).status).toBe(401);
  });

  test("corpo acima do teto recebe 413, declarado ou em blocos", async () => {
    const grande = JSON.stringify({ meio: "qr", lixo: "x".repeat(LIMITE_DO_CORPO) });
    const declarado = await palco.painel("/api/conectores/whatsapp/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: grande,
    });
    expect(await erro(declarado)).toMatchObject({ status: 413, codigo: "corpo_grande" });
    const emBlocos = new ReadableStream<Uint8Array>({
      start(controle) {
        for (let i = 0; i < 20; i += 1) controle.enqueue(new TextEncoder().encode("x".repeat(8 * 1024)));
        controle.close();
      },
    });
    const semTamanho = await palco.painel("/api/conectores/whatsapp/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: emBlocos,
    });
    expect((await erro(semTamanho)).status).toBe(413);
  });

  test("corpo que não é JSON recebe 415", async () => {
    const resposta = await palco.painel("/api/conectores/whatsapp/conectar", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"meio":"qr"}',
    });
    expect(await erro(resposta)).toMatchObject({ status: 415, codigo: "tipo_de_conteudo" });
  });

  test("método errado recebe 405 com Allow", async () => {
    const resposta = await palco.agente("/api/estado", { method: "POST" });
    expect(resposta.headers.get("allow")).toBe("GET");
    expect(await erro(resposta)).toMatchObject({ status: 405, codigo: "metodo_nao_permitido" });
    const acao = await palco.agente("/api/conectores/whatsapp/cancelar");
    expect((await erro(acao)).status).toBe(405);
  });

  test("conector ou ação fora das listas recebe 404", async () => {
    expect((await erro(await palco.agente("/api/conectores/telegram/conectar", { method: "POST" }))).status).toBe(404);
    expect((await erro(await palco.agente("/api/conectores/crm/apagar", { method: "POST" }))).status).toBe(404);
    expect((await erro(await palco.agente("/api/nada"))).status).toBe(404);
  });

  test("bilhete vale uma vez", async () => {
    const pedido = (await (await palco.agente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } };
    const url = pedido.dados.url.replace(palco.servidor.origem, "");
    const primeira = await palco.cru(url, { headers: NAVEGACAO_DE_TOPO });
    expect(primeira.status).toBe(303);
    expect(primeira.headers.get("set-cookie")).toMatch(/^secretaria_sessao=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
    const segunda = await palco.cru(url, { headers: NAVEGACAO_DE_TOPO });
    expect(segunda.status).toBe(401);
    expect(segunda.headers.get("set-cookie")).toBeNull();
  });

  test("/entrar recusa o pedido sem os três cabeçalhos de navegação de topo e não gasta o bilhete", async () => {
    const pedido = (await (await palco.agente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } };
    const url = pedido.dados.url.replace(palco.servidor.origem, "");
    const recusados: Record<string, string>[] = [
      {},
      { "Sec-Fetch-Site": "none" },
      { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
      { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" },
      { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" },
    ];
    for (const headers of recusados) {
      const resposta = await palco.cru(url, { headers });
      expect({ headers, status: resposta.status, cookie: resposta.headers.get("set-cookie") }).toEqual({ headers, status: 403, cookie: null });
    }
    // A recusa não gasta o bilhete: o navegador do vendedor ainda entra com ele.
    const doNavegador = await palco.cru(url, { headers: NAVEGACAO_DE_TOPO });
    expect(doNavegador.status).toBe(303);
    expect(doNavegador.headers.get("set-cookie")).toContain("secretaria_sessao=");
  });

  test('limite conhecido, docs/arquitetura.md "O que é fronteira e o que não é": um programa com os cabeçalhos de navegação vira painel', async () => {
    const pedido = (await (await palco.agente("/api/sessoes/bilhete", { method: "POST" })).json()) as { dados: { url: string } };
    const entrada = await palco.cru(pedido.dados.url.replace(palco.servidor.origem, ""), { headers: NAVEGACAO_DE_TOPO });
    expect(entrada.status).toBe(303);
    const cookie = (entrada.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).toStartWith("secretaria_sessao=");

    // O mesmo pedido que a API do agente recusa com so_no_painel passa da guarda com o cookie.
    const comoAgente = await erro(await palco.agente("/api/conectores/whatsapp/recusar", { method: "POST" }));
    const comoPainel = await erro(
      await palco.cru("/api/conectores/whatsapp/recusar", {
        method: "POST",
        headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin", Origin: palco.servidor.origem },
      }),
    );
    expect({ comoAgente: comoAgente.codigo, comoPainel: comoPainel.codigo === "so_no_painel" ? "recusado" : "passou da guarda" }).toEqual({
      comoAgente: "so_no_painel",
      comoPainel: "passou da guarda",
    });
  });

  test("caminho com escape inválido recebe 404, e a guarda responde antes do roteamento", async () => {
    expect((await erro(await palco.agente("/api/conectores/%/conectar", { method: "POST" }))).status).toBe(404);
    expect((await palco.painel("/%")).status).toBe(404);
    expect((await palco.cru("/%", { headers: { Host: "x.invalid" } })).status).toBe(403);
    expect((await erro(await palco.cru("/api/conectores/%/conectar", { method: "POST", headers: { Host: "x.invalid" } }))).status).toBe(403);
  });

  test("toda resposta leva os cabeçalhos fixos, inclusive as recusas e o painel", async () => {
    const respostas = [
      await palco.painel("/"),
      await palco.cru("/api/estado"),
      await palco.agente("/api/info"),
      await palco.cru("/api/info", { headers: { Host: "x.invalid" } }),
    ];
    for (const resposta of respostas) {
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(resposta.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(resposta.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(resposta.headers.get("referrer-policy")).toBe("no-referrer");
      expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("o painel com sessão recebe a página e os arquivos dela; o anônimo não", async () => {
    const pagina = await palco.painel("/");
    expect(pagina.status).toBe(200);
    const html = await pagina.text();
    const scripts = [...html.matchAll(/(?:src|href)="\.?(\/chunk-[^"]+)"/g)].map((casamento) => casamento[1] ?? "");
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const caminho of scripts) {
      expect((await palco.painel(caminho)).status).toBe(200);
      expect((await palco.cru(caminho)).status).toBe(401);
    }
  });

  test("o servidor escuta só em 127.0.0.1", () => {
    expect(palco.servidor.origem).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
