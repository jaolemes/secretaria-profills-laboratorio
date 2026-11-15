#!/bin/sh
# Instala a última versão marcada da Secretária no Linux e no macOS e abre o painel. Rodar de novo não estraga nada.
# Uso: sh instalar.sh [pasta]. Sem pasta, instala na pasta atual quando ela já é a Secretária, e em ./secretaria-profills quando não é.
# Este script só garante o Bun; quem baixa, confere a assinatura e instala é o instalador embutido no fim.
set -eu

# Mínimo de `engines.bun` no package.json, e a versão que este script instala quando falta.
BUN_VERSAO="1.4.4"
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

# Sai com 0 quando o executável $1 existe e responde uma versão igual ou mais nova que a mínima.
# Um Bun mais novo serve como está: este script nunca rebaixa.
bun_serve() {
  versao="$("$1" --version 2>/dev/null)" || return 1
  awk -v tem="$versao" -v pede="$BUN_VERSAO" 'BEGIN {
    split(tem, t, "."); split(pede, p, ".")
    for (i = 1; i <= 3; i++) {
      if (t[i] + 0 > p[i] + 0) exit 0
      if (t[i] + 0 < p[i] + 0) exit 1
    }
    exit 0
  }'
}

if ! bun_serve bun; then
  if ! bun_serve "$BUN_INSTALL/bin/bun"; then
    for programa in curl bash unzip; do
      if ! command -v "$programa" >/dev/null 2>&1; then
        echo "Falta o programa $programa, que o instalador do Bun usa. Instale-o pelo gerenciador do sistema e rode este script de novo." >&2
        exit 1
      fi
    done
    # Instalador oficial com versão fixa: https://bun.com/docs/installation
    curl -fsSL https://bun.com/install | bash -s "bun-v$BUN_VERSAO"
  fi
  PATH="$BUN_INSTALL/bin:$PATH"
  export PATH
fi

# Com o modelo, o mktemp do macOS usa o TMPDIR; sem ele, usaria a pasta temporária do usuário e ignoraria o TMPDIR.
pasta_temporaria="$(mktemp -d "${TMPDIR:-/tmp}/secretaria.XXXXXXXXXX")"
trap 'rm -rf "$pasta_temporaria"' EXIT
instalador="$pasta_temporaria/instalar.js"

# Gerado de nucleo/atualizacao/instalacao.ts por `bun nucleo/atualizacao/script.ts`. Não edite à mão.
cat > "$instalador" <<'FIM_DO_INSTALADOR'
// @bun
// nucleo/atualizacao/instalacao.ts
import { copyFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync2, renameSync, rmdirSync, rmSync, writeFileSync as writeFileSync2 } from "fs";
import path2 from "path";

// nucleo/atualizacao/chaves.ts
var CHAVES_PUBLICAS = [
  { papel: "ativa", publica: "X+A+9QrCu3g7Y3Ty1hrelht9QWwplrtiP1BnkWOpE3Q=" },
  { papel: "reserva", publica: "zM0h3uhXRuNG8HZN8e7IXHco1z6u5jwVtDZIr0r5JWE=" }
];

// nucleo/atualizacao/novidades.ts
var MAXIMO_DE_LINHAS = 5;
var MAXIMO_DE_CARACTERES = 140;
var PADRAO_DE_VERSAO = /^\d+\.\d+\.\d+$/;

// nucleo/atualizacao/recusa.ts
function recusar(motivo, detalhe) {
  return { ok: false, motivo, detalhe };
}

// nucleo/atualizacao/manifesto.ts
var ORIGEM_DAS_VERSOES = "https://github.com/profillsbrasil/secretaria-profills/releases/";
var ENDERECO_DA_ULTIMA_VERSAO = `${ORIGEM_DAS_VERSOES}latest/download/versao.json`;
var TETO_DO_PACOTE_BYTES = 64 * 1024 * 1024;
function nomeDoPacote(versao) {
  return `secretaria-${versao}.tar.gz`;
}
function enderecoDoPacote(versao, tag = `v${versao}`) {
  return `${ORIGEM_DAS_VERSOES}download/${tag}/${nomeDoPacote(versao)}`;
}
function ehObjeto(valor) {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
function ehTexto(valor, padrao) {
  return typeof valor === "string" && padrao.test(valor);
}
function lerManifesto(texto, tag) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return recusar("manifesto_invalido", "o manifesto n\xE3o \xE9 JSON");
  }
  if (!ehObjeto(bruto))
    return recusar("manifesto_invalido", "o manifesto n\xE3o \xE9 um objeto");
  const { v, versao, data, bunMinimo, pacote, oQueMuda } = bruto;
  if (v !== 1)
    return recusar("manifesto_invalido", "esta vers\xE3o s\xF3 l\xEA o manifesto de formato 1");
  if (!ehTexto(versao, PADRAO_DE_VERSAO))
    return recusar("manifesto_invalido", "versao precisa ser X.Y.Z");
  if (!ehTexto(data, /^\d{4}-\d{2}-\d{2}$/))
    return recusar("manifesto_invalido", "data precisa ser AAAA-MM-DD");
  if (!ehTexto(bunMinimo, PADRAO_DE_VERSAO))
    return recusar("manifesto_invalido", "bunMinimo precisa ser X.Y.Z");
  if (!ehObjeto(pacote))
    return recusar("manifesto_invalido", "falta o pacote");
  const { url, sha256, bytes } = pacote;
  if (typeof url !== "string")
    return recusar("manifesto_invalido", "falta a URL do pacote");
  if (!ehTexto(sha256, /^[0-9a-f]{64}$/))
    return recusar("manifesto_invalido", "o sha256 do pacote precisa ter 64 caracteres hexadecimais");
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > TETO_DO_PACOTE_BYTES) {
    return recusar("manifesto_invalido", `o tamanho do pacote precisa ficar entre 1 e ${TETO_DO_PACOTE_BYTES} bytes`);
  }
  if (!Array.isArray(oQueMuda) || oQueMuda.length < 1 || oQueMuda.length > MAXIMO_DE_LINHAS) {
    return recusar("manifesto_invalido", `oQueMuda precisa ter de 1 a ${MAXIMO_DE_LINHAS} frases`);
  }
  const frases = [];
  for (const frase of oQueMuda) {
    if (typeof frase !== "string" || frase.length < 1 || frase.length > MAXIMO_DE_CARACTERES) {
      return recusar("manifesto_invalido", `cada frase de oQueMuda tem de 1 a ${MAXIMO_DE_CARACTERES} caracteres`);
    }
    frases.push(frase);
  }
  if (url !== enderecoDoPacote(versao, tag)) {
    return recusar("endereco_fora_do_canonico", `a URL do pacote precisa ser ${enderecoDoPacote(versao, tag)}`);
  }
  return { ok: true, manifesto: { v, versao, data, bunMinimo, pacote: { url, sha256, bytes }, oQueMuda: frases } };
}
function versaoMaior(candidata, instalada) {
  const partes = (versao) => versao.split(".").map(Number);
  const a = partes(candidata);
  const b = partes(instalada);
  for (let i = 0;i < 3; i++) {
    const diferenca = (a[i] ?? 0) - (b[i] ?? 0);
    if (diferenca !== 0)
      return diferenca > 0;
  }
  return false;
}

// nucleo/atualizacao/envelope.ts
var TETO_DO_ENVELOPE_BYTES = 64 * 1024;
var ALGORITMO = "Ed25519";
function deBase64(texto) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(texto))
    return null;
  const bytes = Buffer.from(texto, "base64");
  return bytes.toString("base64") === texto ? new Uint8Array(bytes) : null;
}
function idDaChave(publica) {
  return new Bun.CryptoHasher("sha256").update(publica).digest("hex").slice(0, 16);
}
function lerEnvelope(texto) {
  if (new TextEncoder().encode(texto).length > TETO_DO_ENVELOPE_BYTES)
    return null;
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null)
    return null;
  const { manifesto, chave, assinatura } = bruto;
  if (typeof manifesto !== "string" || typeof chave !== "string" || typeof assinatura !== "string")
    return null;
  return { manifesto, chave, assinatura };
}
async function abrirEnvelope(texto, chaves = CHAVES_PUBLICAS) {
  const envelope = lerEnvelope(texto);
  if (envelope === null)
    return recusar("envelope_invalido", "o arquivo da vers\xE3o n\xE3o tem manifesto, chave e assinatura");
  for (const { papel, publica } of chaves) {
    const bytes = deBase64(publica);
    if (bytes === null || bytes.length !== 32 || idDaChave(bytes) !== envelope.chave)
      continue;
    const assinatura = deBase64(envelope.assinatura);
    if (assinatura === null || assinatura.length !== 64)
      return recusar("assinatura_invalida", "a assinatura n\xE3o tem 64 bytes em base64");
    const chave = await crypto.subtle.importKey("raw", bytes, ALGORITMO, false, ["verify"]);
    const confere = await crypto.subtle.verify(ALGORITMO, chave, assinatura, new TextEncoder().encode(envelope.manifesto));
    if (!confere)
      return recusar("assinatura_invalida", "a assinatura n\xE3o \xE9 desse manifesto");
    return { ok: true, manifesto: envelope.manifesto, papel };
  }
  return recusar("chave_desconhecida", "a vers\xE3o foi assinada por uma chave que esta instala\xE7\xE3o n\xE3o conhece");
}

// nucleo/atualizacao/descoberta.ts
var INTERVALO_DAS_CONFERENCIAS_MS = 6 * 60 * 60 * 1000;
var PRAZO_DA_BUSCA_MS = 5000;

// nucleo/atualizacao/fonte.ts
var FONTE_DAS_VERSOES = {
  endereco: new URL(ENDERECO_DA_ULTIMA_VERSAO),
  chaves: CHAVES_PUBLICAS,
  prazoMs: PRAZO_DA_BUSCA_MS,
  pacote: (url) => new URL(url)
};
var PRAZO_DO_PACOTE_MS = 10 * 60000;
async function lerComTeto(corpo) {
  const partes = [];
  let total = 0;
  for await (const parte of corpo) {
    partes.push(parte);
    total += parte.length;
    if (total > TETO_DO_ENVELOPE_BYTES)
      break;
  }
  return new TextDecoder().decode(Buffer.concat(partes));
}
async function buscarVersao(fonte) {
  try {
    const resposta = await fetch(fonte.endereco, { signal: AbortSignal.timeout(fonte.prazoMs) });
    if (resposta.status !== 200 || resposta.body === null) {
      await resposta.body?.cancel();
      return { tipo: "http", status: resposta.status, corpo: "" };
    }
    return { tipo: "http", status: 200, corpo: await lerComTeto(resposta.body) };
  } catch {
    return { tipo: "sem_resposta" };
  }
}
async function baixarPacote(endereco, bytes) {
  try {
    const resposta = await fetch(endereco, { signal: AbortSignal.timeout(PRAZO_DO_PACOTE_MS) });
    if (resposta.status !== 200 || resposta.body === null) {
      await resposta.body?.cancel();
      return null;
    }
    const partes = [];
    let total = 0;
    for await (const parte of resposta.body) {
      partes.push(parte);
      total += parte.length;
      if (total > bytes)
        break;
    }
    return new Uint8Array(Buffer.concat(partes));
  } catch {
    return null;
  }
}

// nucleo/atualizacao/pacote.ts
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

// nucleo/atualizacao/tar.ts
var BLOCO = 512;
var CAMPO = {
  nome: [0, 100],
  modo: [100, 108],
  dono: [108, 116],
  grupo: [116, 124],
  tamanho: [124, 136],
  data: [136, 148],
  soma: [148, 156],
  tipo: [156, 157],
  magia: [257, 263],
  versao: [263, 265],
  prefixo: [345, 500]
};
var codificador = new TextEncoder;
function somaDoCabecalho(bloco) {
  let soma = 0;
  for (let i = 0;i < BLOCO; i++)
    soma += i >= CAMPO.soma[0] && i < CAMPO.soma[1] ? 32 : bloco[i] ?? 0;
  return soma;
}
var decodificador = new TextDecoder("utf-8", { fatal: true });
function ler(bloco, campo) {
  const bytes = bloco.subarray(CAMPO[campo][0], CAMPO[campo][1]);
  const fim = bytes.indexOf(0);
  return decodificador.decode(fim === -1 ? bytes : bytes.subarray(0, fim));
}
function lerOctal(bloco, campo) {
  const texto = ler(bloco, campo).trim();
  if (!/^[0-7]+$/.test(texto))
    throw new Error(`o tar tem ${campo} que n\xE3o \xE9 n\xFAmero`);
  return Number.parseInt(texto, 8);
}
function lerTar(tar) {
  const entradas = [];
  for (let cursor = 0;; ) {
    if (cursor + BLOCO > tar.length)
      throw new Error("o tar acaba sem o bloco de fim");
    const cabecalho = tar.subarray(cursor, cursor + BLOCO);
    if (cabecalho.every((byte) => byte === 0)) {
      if (!tar.subarray(cursor).every((byte) => byte === 0))
        throw new Error("o tar tem dados depois do fim");
      return entradas;
    }
    if (lerOctal(cabecalho, "soma") !== somaDoCabecalho(cabecalho))
      throw new Error("o tar tem cabe\xE7alho com a soma errada");
    if (ler(cabecalho, "magia") !== "ustar")
      throw new Error("o tar n\xE3o est\xE1 no formato ustar");
    const tamanho = lerOctal(cabecalho, "tamanho");
    const inicio = cursor + BLOCO;
    if (inicio + tamanho > tar.length)
      throw new Error("o tar acaba no meio de um arquivo");
    const prefixo = ler(cabecalho, "prefixo");
    const nome = ler(cabecalho, "nome");
    const tipo = ler(cabecalho, "tipo");
    entradas.push({
      caminho: prefixo === "" ? nome : `${prefixo}/${nome}`,
      dados: tar.subarray(inicio, inicio + tamanho),
      executavel: (lerOctal(cabecalho, "modo") & 64) !== 0,
      tipo: tipo === "" ? "0" : tipo
    });
    cursor = inicio + Math.ceil(tamanho / BLOCO) * BLOCO;
  }
}

// nucleo/atualizacao/pacote.ts
var LISTA_DO_PACOTE = "arquivos-da-versao.json";
var TETO_DESCOMPRIMIDO_BYTES = 256 * 1024 * 1024;
var SEGMENTO = /^[A-Za-z0-9._-]+$/;
var RESERVADO_NO_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
function problemaDoCaminho(caminho) {
  for (const segmento of caminho.split("/")) {
    if (!SEGMENTO.test(segmento))
      return "s\xF3 aceita pastas e nomes com letras sem acento, n\xFAmeros, ponto, tra\xE7o e sublinhado";
    if (segmento.endsWith("."))
      return "tem nome que termina em ponto";
    if (RESERVADO_NO_WINDOWS.test(segmento))
      return "tem nome que o Windows reserva";
  }
  return null;
}
var PASTAS_DA_PROFILLS = ["nucleo/", "docs/", "testes/", "novidades/"];
var FORA_DA_RAIZ = ["meu", "node_modules", ".git", ".atualizacao", ".agents", ".claude"];
function entraNaTroca(caminho) {
  const partes = caminho.split("/");
  if (partes.length === 1)
    return !FORA_DA_RAIZ.includes(caminho.toLowerCase());
  if (PASTAS_DA_PROFILLS.some((pasta) => caminho.startsWith(pasta)))
    return true;
  if (caminho === ".claude/settings.json")
    return true;
  const skill = partes[2] ?? "";
  return partes[0] === ".agents" && partes[1] === "skills" && partes.length >= 4 && !skill.toLowerCase().startsWith("meu-");
}
function problemaDoConjunto(caminhos) {
  const arquivos = new Set;
  const pastas = new Set;
  for (const caminho of caminhos) {
    const chave = caminho.toLowerCase();
    if (arquivos.has(chave))
      return `${JSON.stringify(caminho)} aparece duas vezes`;
    arquivos.add(chave);
    for (let barra = chave.indexOf("/");barra !== -1; barra = chave.indexOf("/", barra + 1))
      pastas.add(chave.slice(0, barra));
  }
  for (const caminho of caminhos)
    if (pastas.has(caminho.toLowerCase()))
      return `${JSON.stringify(caminho)} \xE9 arquivo e pasta`;
  return null;
}
function sha256De(bytes) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
function conferirPacote(bytes, manifesto) {
  if (bytes.length !== manifesto.pacote.bytes) {
    return recusar("pacote_nao_confere", `o pacote tem ${bytes.length} bytes e o manifesto pede ${manifesto.pacote.bytes}`);
  }
  const obtido = sha256De(bytes);
  if (obtido !== manifesto.pacote.sha256) {
    return recusar("pacote_nao_confere", `o sha256 do pacote \xE9 ${obtido} e o manifesto pede ${manifesto.pacote.sha256}`);
  }
  return { ok: true, pacote: { bytes, versao: manifesto.versao } };
}
function lerLista(bytes) {
  let bruto;
  try {
    bruto = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null)
    return null;
  const { v, versao, arquivos } = bruto;
  if (v !== 1 || typeof versao !== "string" || !PADRAO_DE_VERSAO.test(versao) || !Array.isArray(arquivos))
    return null;
  const lidos = [];
  for (const item of arquivos) {
    if (typeof item !== "object" || item === null)
      return null;
    const { caminho, sha256, bytes: tamanho } = item;
    if (typeof caminho !== "string" || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))
      return null;
    if (typeof tamanho !== "number" || !Number.isSafeInteger(tamanho) || tamanho < 0)
      return null;
    lidos.push({ caminho, sha256, bytes: tamanho });
  }
  return { v, versao, arquivos: lidos };
}
function extrairPacote(pacote, destino) {
  if (existsSync(destino) && readdirSync(destino).length > 0)
    throw new Error(`a pasta ${destino} j\xE1 tem arquivo`);
  let entradas;
  try {
    entradas = lerTar(new Uint8Array(gunzipSync(pacote.bytes, { maxOutputLength: TETO_DESCOMPRIMIDO_BYTES })));
  } catch (erro) {
    return recusar("pacote_invalido", erro instanceof Error ? erro.message : String(erro));
  }
  const arquivos = new Map;
  let bytesDaLista = null;
  for (const entrada of entradas) {
    const citado = JSON.stringify(entrada.caminho);
    if (entrada.tipo !== "0")
      return recusar("caminho_recusado", `${citado} n\xE3o \xE9 arquivo comum: o pacote n\xE3o traz link nem pasta`);
    if (entrada.caminho === LISTA_DO_PACOTE) {
      if (bytesDaLista !== null)
        return recusar("caminho_recusado", `${citado} aparece duas vezes`);
      bytesDaLista = entrada.dados;
      continue;
    }
    const problema = problemaDoCaminho(entrada.caminho) ?? (entraNaTroca(entrada.caminho) ? null : "est\xE1 fora do que a atualiza\xE7\xE3o troca");
    if (problema !== null)
      return recusar("caminho_recusado", `${citado} ${problema}`);
    if (arquivos.has(entrada.caminho))
      return recusar("caminho_recusado", `${citado} aparece duas vezes`);
    arquivos.set(entrada.caminho, entrada);
  }
  const conflito = problemaDoConjunto([...arquivos.keys()]);
  if (conflito !== null)
    return recusar("caminho_recusado", conflito);
  const lista = bytesDaLista === null ? null : lerLista(bytesDaLista);
  if (bytesDaLista === null || lista === null)
    return recusar("lista_nao_confere", `o pacote n\xE3o traz ${LISTA_DO_PACOTE} no formato`);
  if (lista.versao !== pacote.versao)
    return recusar("lista_nao_confere", `a lista \xE9 da ${lista.versao} e o manifesto, da ${pacote.versao}`);
  const naLista = new Set(lista.arquivos.map(({ caminho }) => caminho));
  if (naLista.size !== lista.arquivos.length || naLista.size !== arquivos.size)
    return recusar("lista_nao_confere", "a lista e o pacote n\xE3o t\xEAm os mesmos arquivos");
  for (const { caminho, sha256, bytes } of lista.arquivos) {
    const arquivo = arquivos.get(caminho);
    if (arquivo === undefined)
      return recusar("lista_nao_confere", `${JSON.stringify(caminho)} est\xE1 na lista e n\xE3o est\xE1 no pacote`);
    if (arquivo.dados.length !== bytes || sha256De(arquivo.dados) !== sha256) {
      return recusar("lista_nao_confere", `${JSON.stringify(caminho)} n\xE3o tem o sha256 da lista`);
    }
  }
  const raiz = path.resolve(destino);
  const gravar = (caminho, dados, executavel) => {
    const alvo = path.join(raiz, ...caminho.split("/"));
    mkdirSync(path.dirname(alvo), { recursive: true });
    writeFileSync(alvo, dados, { flag: "wx" });
    if (executavel && process.platform !== "win32")
      chmodSync(alvo, 493);
  };
  gravar(LISTA_DO_PACOTE, bytesDaLista, false);
  for (const { caminho, dados, executavel } of arquivos.values())
    gravar(caminho, dados, executavel);
  return { ok: true, lista };
}

// nucleo/atualizacao/instalacao.ts
var MENSAGENS = {
  sem_versao_publicada: "Ainda n\xE3o existe uma vers\xE3o da Secret\xE1ria publicada para instalar. Nada foi instalado. Fale com o suporte da Profills.",
  sem_internet: "N\xE3o deu para falar com o GitHub, onde a Secret\xE1ria \xE9 publicada. Confira a internet e rode o script de novo.",
  versao_recusada: "A vers\xE3o publicada n\xE3o passou na confer\xEAncia de assinatura, e nada foi instalado. Fale com o suporte da Profills.",
  pacote_recusado: "O pacote baixado n\xE3o \xE9 o que a vers\xE3o publicada descreve, e nada foi instalado. Rode o script de novo. Se repetir, fale com o suporte da Profills.",
  bun_antigo: "Esta vers\xE3o da Secret\xE1ria pede um Bun mais novo que o deste computador. Baixe o script de instala\xE7\xE3o de novo e rode.",
  versao_mais_velha: "Esta pasta j\xE1 tem uma vers\xE3o da Secret\xE1ria mais nova que a publicada. Nada foi mudado.",
  pasta_de_outra_coisa: "A pasta escolhida j\xE1 tem outros arquivos e n\xE3o \xE9 uma Secret\xE1ria. Nada foi mudado. Rode o script numa pasta vazia ou diga outra pasta.",
  troca_falhou: "N\xE3o deu para trocar os arquivos da pasta, e ela ficou como estava. Feche a Secret\xE1ria e os programas com arquivos dessa pasta abertos, como um editor, e rode o script de novo."
};
var NOME_DO_PACOTE_NPM = "secretaria-profills";
var FICA_NA_PASTA = "meu";
var PERMISSOES_LOCAIS = path2.join(".claude", "settings.local.json");
var ESPERAS_NO_WINDOWS_MS = [100, 200, 400, 800, 1500];
function recusar2(motivo, detalhe) {
  return { tipo: "recusada", motivo, mensagem: MENSAGENS[motivo], detalhe };
}
function lerJson(arquivo) {
  try {
    const lido = JSON.parse(readFileSync2(arquivo, "utf8"));
    return typeof lido === "object" && lido !== null && !Array.isArray(lido) ? lido : null;
  } catch {
    return null;
  }
}
function lerPasta(destino) {
  let nomes;
  try {
    nomes = readdirSync2(destino);
  } catch (erro) {
    if (erro.code === "ENOENT")
      return { tipo: "nova" };
    return { tipo: "outra" };
  }
  if (nomes.length === 0)
    return { tipo: "nova" };
  const pacote = lerJson(path2.join(destino, "package.json"));
  if (pacote?.name !== NOME_DO_PACOTE_NPM)
    return { tipo: "outra" };
  const versao = typeof pacote.version === "string" && PADRAO_DE_VERSAO.test(pacote.version) ? pacote.version : null;
  const lista = lerJson(path2.join(destino, LISTA_DO_PACOTE));
  return { tipo: "secretaria", versao, doPacote: typeof lista?.versao === "string" ? lista.versao : null, git: existsSync2(path2.join(destino, ".git")) };
}
function renomearComEspera(de, para) {
  for (const espera of [...ESPERAS_NO_WINDOWS_MS, null]) {
    try {
      renameSync(de, para);
      return;
    } catch (erro) {
      const emUso = ["EPERM", "EBUSY", "EACCES"].includes(erro.code ?? "");
      if (espera === null || !emUso || process.platform !== "win32")
        throw erro;
      Bun.sleepSync(espera);
    }
  }
}
function carimbo(agora) {
  const dois = (n) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
}
function pastaLivre(base) {
  for (let n = 1;; n++) {
    const candidata = n === 1 ? base : `${base}-${n}`;
    if (!existsSync2(candidata))
      return candidata;
  }
}
function trocar(destino, extraida, guardada, renomear) {
  const feitos = [];
  const mover = (de, para) => {
    renomear(de, para);
    feitos.push([de, para]);
  };
  try {
    mkdirSync2(destino, { recursive: true });
    if (guardada !== null) {
      mkdirSync2(guardada);
      for (const nome of readdirSync2(destino))
        if (nome !== FICA_NA_PASTA)
          mover(path2.join(destino, nome), path2.join(guardada, nome));
    }
    for (const nome of readdirSync2(extraida))
      mover(path2.join(extraida, nome), path2.join(destino, nome));
  } catch (erro) {
    for (const [de, para] of feitos.reverse()) {
      try {
        renomear(para, de);
      } catch {}
    }
    if (guardada !== null) {
      try {
        rmdirSync(guardada);
      } catch {}
    }
    throw erro;
  }
}
async function instalarPelaVersao(opcoes) {
  const { destino, fonte } = opcoes;
  opcoes.avisar("Conferindo a \xFAltima vers\xE3o da Secret\xE1ria.");
  const resposta = await buscarVersao(fonte);
  if (resposta.tipo === "sem_resposta")
    return recusar2("sem_internet", "o versao.json n\xE3o respondeu");
  if (resposta.status === 404)
    return recusar2("sem_versao_publicada", "o endere\xE7o da \xFAltima vers\xE3o respondeu 404");
  if (resposta.status !== 200)
    return recusar2("sem_internet", `o endere\xE7o da \xFAltima vers\xE3o respondeu ${resposta.status}`);
  const aberto = await abrirEnvelope(resposta.corpo, fonte.chaves);
  if (!aberto.ok)
    return recusar2("versao_recusada", `${aberto.motivo}: ${aberto.detalhe}`);
  const leitura = lerManifesto(aberto.manifesto);
  if (!leitura.ok)
    return recusar2("versao_recusada", `${leitura.motivo}: ${leitura.detalhe}`);
  const { manifesto } = leitura;
  if (versaoMaior(manifesto.bunMinimo, Bun.version))
    return recusar2("bun_antigo", `a ${manifesto.versao} pede o Bun ${manifesto.bunMinimo}, e este \xE9 o ${Bun.version}`);
  const pasta = lerPasta(destino);
  if (pasta.tipo === "outra")
    return recusar2("pasta_de_outra_coisa", "a pasta tem arquivos e n\xE3o tem o package.json da Secret\xE1ria");
  if (pasta.tipo === "secretaria") {
    if (pasta.versao !== null && versaoMaior(pasta.versao, manifesto.versao)) {
      return recusar2("versao_mais_velha", `a pasta tem a ${pasta.versao}, e a publicada \xE9 a ${manifesto.versao}`);
    }
    if (!pasta.git && pasta.versao === manifesto.versao && pasta.doPacote === manifesto.versao)
      return { tipo: "ja_estava", versao: manifesto.versao };
  }
  opcoes.avisar(`Baixando a Secret\xE1ria ${manifesto.versao}.`);
  const bytes = await baixarPacote(fonte.pacote(manifesto.pacote.url), manifesto.pacote.bytes);
  if (bytes === null)
    return recusar2("sem_internet", "o pacote n\xE3o chegou");
  const conferido = conferirPacote(bytes, manifesto);
  if (!conferido.ok)
    return recusar2("pacote_recusado", conferido.detalhe);
  const mae = path2.dirname(path2.resolve(destino));
  const extraida = path2.join(mae, `.${path2.basename(destino)}.instalando`);
  mkdirSync2(mae, { recursive: true });
  rmSync(extraida, { recursive: true, force: true });
  try {
    const extracao = extrairPacote(conferido.pacote, extraida);
    if (!extracao.ok)
      return recusar2("pacote_recusado", extracao.detalhe);
    let guardada = null;
    if (pasta.tipo === "secretaria") {
      const parada = await opcoes.rodar([process.execPath, "secretaria", "parar", "--json"], destino, true);
      if (parada !== 0 && parada !== 4)
        opcoes.avisar("N\xE3o deu para fechar a Secret\xE1ria desta pasta. A troca tenta assim mesmo.");
      guardada = pastaLivre(path2.join(mae, `${path2.basename(destino)}-antes-${carimbo(opcoes.agora)}`));
    }
    try {
      trocar(destino, extraida, guardada, opcoes.renomear ?? renomearComEspera);
    } catch (erro) {
      return recusar2("troca_falhou", erro.code ?? (erro instanceof Error ? erro.name : typeof erro));
    }
    for (const [caminho, conteudo] of Object.entries(opcoes.meuInicial)) {
      const alvo = path2.join(destino, FICA_NA_PASTA, ...caminho.split("/"));
      if (existsSync2(alvo))
        continue;
      mkdirSync2(path2.dirname(alvo), { recursive: true });
      writeFileSync2(alvo, conteudo);
    }
    if (guardada !== null && existsSync2(path2.join(guardada, PERMISSOES_LOCAIS))) {
      mkdirSync2(path2.join(destino, ".claude"), { recursive: true });
      copyFileSync(path2.join(guardada, PERMISSOES_LOCAIS), path2.join(destino, PERMISSOES_LOCAIS));
    }
    return { tipo: "instalada", versao: manifesto.versao, guardada };
  } finally {
    try {
      rmSync(extraida, { recursive: true, force: true });
    } catch {}
  }
}
function resolverDestino(cwd, pedida) {
  if (pedida !== undefined && pedida !== "")
    return path2.resolve(cwd, pedida);
  return lerPasta(cwd).tipo === "secretaria" ? path2.resolve(cwd) : path2.join(path2.resolve(cwd), NOME_DO_PACOTE_NPM);
}
var DEPOIS_DA_TROCA = [
  ["install", "--frozen-lockfile"],
  ["secretaria", "instalar"],
  ["secretaria", "abrir"]
];
function efeitosReais() {
  return {
    cwd: process.cwd(),
    agora: new Date,
    rodar: (argv, cwd, quieto = false) => Bun.spawn([...argv], { cwd, stdio: quieto ? ["ignore", "ignore", "ignore"] : ["inherit", "inherit", "inherit"] }).exited,
    escrever: (texto) => process.stdout.write(`${texto}
`)
  };
}
async function principal(argv, configuracao, efeitos = efeitosReais()) {
  const destino = resolverDestino(efeitos.cwd, argv[0]);
  const desfecho = await instalarPelaVersao({ destino, ...configuracao, agora: efeitos.agora, rodar: efeitos.rodar, avisar: efeitos.escrever });
  if (desfecho.tipo === "recusada") {
    efeitos.escrever(`${desfecho.mensagem}
Para o suporte: ${desfecho.motivo} (${desfecho.detalhe}).`);
    return 1;
  }
  if (desfecho.tipo === "instalada" && desfecho.guardada !== null) {
    efeitos.escrever(`A pasta antiga ficou guardada em ${desfecho.guardada}. A pasta meu e os seus dados continuam no lugar. Apague a pasta guardada quando tudo estiver funcionando.`);
  }
  for (const passo of DEPOIS_DA_TROCA) {
    const codigo = await efeitos.rodar([process.execPath, ...passo], destino);
    if (codigo !== 0) {
      efeitos.escrever(`A instala\xE7\xE3o parou em "bun ${passo.join(" ")}". Rode o script de novo. Se parar de novo, pe\xE7a ajuda ao seu agente.`);
      return codigo;
    }
  }
  efeitos.escrever(`A Secret\xE1ria ${desfecho.versao} est\xE1 em ${destino}. Para usar, abra o seu agente nessa pasta.`);
  return 0;
}

// script:instalador-do-script
var fonte = FONTE_DAS_VERSOES;
process.exit(await principal(process.argv.slice(2), { fonte, meuInicial: { "AGENTS.md": `# Minhas regras

Regras do vendedor para o agente. O \`AGENTS.md\` da raiz manda ler este arquivo depois dele. Uma linha por regra. As regras da raiz continuam valendo.
`, "README.md": "# meu/\n\nEsta pasta \xE9 do vendedor. A atualiza\xE7\xE3o do n\xFAcleo da Profills nunca muda nada aqui.\n\n| Caminho | Para qu\xEA |\n|---|---|\n| `meu/AGENTS.md` | suas regras para o agente, uma por linha |\n| `meu/skills/meu-<nome>/SKILL.md` | skills suas; `bun secretaria instalar` copia para `.agents/skills` e `.claude/skills` |\n| `meu/migracoes/NNNN_<nome>.sql` | tabelas suas, criadas em `meu.db`, na pasta de dados |\n\n`meu.db` \xE9 um arquivo s\xF3 seu, separado do banco do n\xFAcleo (`secretaria.db`). Uma migra\xE7\xE3o sua n\xE3o l\xEA nem altera dado do n\xFAcleo, e `ATTACH` \xE9 recusado.\n\nP\xE1ginas e comandos seus ainda n\xE3o t\xEAm lugar: o n\xFAcleo ainda n\xE3o l\xEA c\xF3digo desta pasta. Pe\xE7a ao agente, com a skill `secretaria-estender`, para ver o que d\xE1 para fazer hoje.\n", "migracoes/.gitkeep": "", "skills/.gitkeep": "" } }));
FIM_DO_INSTALADOR

bun "$instalador" "$@"
