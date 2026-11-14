import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerTrava } from "./ferramentas";

const REPO = path.join(import.meta.dir, "..", "..");
const ORIGINAL = readFileSync(path.join(REPO, "ferramentas.lock.json"), "utf8");
const URL_DO_LINUX = "https://github.com/openclaw/wacli/releases/download/v0.26.0/wacli_0.26.0_linux_amd64.tar.gz";

let pasta: string | undefined;
afterEach(() => {
  if (pasta !== undefined) rmSync(pasta, { recursive: true, force: true });
  pasta = undefined;
});

function travaComUrl(url: string): () => unknown {
  pasta = mkdtempSync(path.join(tmpdir(), "trava-"));
  writeFileSync(path.join(pasta, "ferramentas.lock.json"), ORIGINAL.replace(URL_DO_LINUX, url));
  const raiz = pasta;
  return () => lerTrava(raiz);
}

describe("ferramentas.lock.json", () => {
  test("a trava do repo passa", () => {
    expect(lerTrava(REPO).wacli.artefatos["linux-x64"]?.url).toBe(URL_DO_LINUX);
  });

  test.each([
    ["outro host", "https://exemplo.test/openclaw/wacli/releases/download/v0.26.0/wacli.tar.gz"],
    ["host parecido", "https://github.com.exemplo.test/openclaw/wacli/releases/download/v0.26.0/wacli.tar.gz"],
    ["outro repo no GitHub", "https://github.com/outro/wacli/releases/download/v0.26.0/wacli.tar.gz"],
    ["fora dos releases", "https://github.com/openclaw/wacli/archive/refs/heads/main.tar.gz"],
    ["http", "http://github.com/openclaw/wacli/releases/download/v0.26.0/wacli.tar.gz"],
    ["servidor local", "http://127.0.0.1:8080/openclaw/wacli/releases/download/v0.26.0/wacli.tar.gz"],
    ["usuário na URL", "https://usuario@github.com/openclaw/wacli/releases/download/v0.26.0/wacli.tar.gz"],
  ])("recusa download de %s", (_caso, url) => {
    expect(travaComUrl(url)).toThrow("github.com/openclaw/wacli/releases/download/");
  });
});
