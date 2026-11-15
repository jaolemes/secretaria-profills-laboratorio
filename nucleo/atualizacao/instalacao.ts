/**
 * A instalação pela versão marcada, que o `instalar.sh` e o `instalar.ps1` rodam antes de a
 * Secretária existir na máquina: o script garante o Bun e roda este módulo, embutido nele.
 * Busca o `versao.json` da última versão, confere a assinatura e o sha256 do pacote antes de
 * extrair, e põe a versão na pasta. Uma pasta que já tem a Secretária fica guardada ao lado,
 * com o `meu/` no lugar.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abrirEnvelope } from "./envelope";
import { baixarPacote, buscarVersao, type FonteDasVersoes } from "./fonte";
import { lerManifesto, versaoMaior } from "./manifesto";
import { PADRAO_DE_VERSAO } from "./novidades";
import { LISTA_DO_PACOTE, conferirPacote, extrairPacote } from "./pacote";

export type MotivoDaInstalacao =
  | "sem_versao_publicada"
  | "sem_internet"
  | "versao_recusada"
  | "pacote_recusado"
  | "bun_antigo"
  | "versao_mais_velha"
  | "pasta_de_outra_coisa"
  | "troca_falhou";

const MENSAGENS: Record<MotivoDaInstalacao, string> = {
  sem_versao_publicada: "Ainda não existe uma versão da Secretária publicada para instalar. Nada foi instalado. Fale com o suporte da Profills.",
  sem_internet: "Não deu para falar com o GitHub, onde a Secretária é publicada. Confira a internet e rode o script de novo.",
  versao_recusada: "A versão publicada não passou na conferência de assinatura, e nada foi instalado. Fale com o suporte da Profills.",
  pacote_recusado: "O pacote baixado não é o que a versão publicada descreve, e nada foi instalado. Rode o script de novo. Se repetir, fale com o suporte da Profills.",
  bun_antigo: "Esta versão da Secretária pede um Bun mais novo que o deste computador. Baixe o script de instalação de novo e rode.",
  versao_mais_velha: "Esta pasta já tem uma versão da Secretária mais nova que a publicada. Nada foi mudado.",
  pasta_de_outra_coisa: "A pasta escolhida já tem outros arquivos e não é uma Secretária. Nada foi mudado. Rode o script numa pasta vazia ou diga outra pasta.",
  troca_falhou:
    "Não deu para trocar os arquivos da pasta, e ela ficou como estava. Feche a Secretária e os programas com arquivos dessa pasta abertos, como um editor, e rode o script de novo.",
};

export type DesfechoDaInstalacao =
  | { readonly tipo: "instalada"; readonly versao: string; readonly guardada: string | null }
  | { readonly tipo: "ja_estava"; readonly versao: string }
  | { readonly tipo: "recusada"; readonly motivo: MotivoDaInstalacao; readonly mensagem: string; readonly detalhe: string };

export interface OpcoesDaInstalacao {
  readonly destino: string;
  readonly fonte: FonteDasVersoes;
  /** O esqueleto de `meu/`, que o pacote não traz: caminho dentro de `meu/` e conteúdo. Só cria o que falta. */
  readonly meuInicial: Readonly<Record<string, string>>;
  readonly agora: Date;
  /** `quieto` esconde a saída do comando, que não diz nada ao vendedor. */
  rodar(argv: readonly string[], cwd: string, quieto?: boolean): Promise<number>;
  avisar(texto: string): void;
  /** Só o teste troca, para uma troca falhar no meio. */
  readonly renomear?: (de: string, para: string) => void;
}

const NOME_DO_PACOTE_NPM = "secretaria-profills";
/** O que fica na pasta quando ela é trocada: o resto vai para a cópia guardada. */
const FICA_NA_PASTA = "meu";
const PERMISSOES_LOCAIS = path.join(".claude", "settings.local.json");
const ESPERAS_NO_WINDOWS_MS = [100, 200, 400, 800, 1_500];

type Pasta =
  | { readonly tipo: "nova" }
  | { readonly tipo: "outra" }
  | { readonly tipo: "secretaria"; readonly versao: string | null; readonly doPacote: string | null; readonly git: boolean };

function recusar(motivo: MotivoDaInstalacao, detalhe: string): DesfechoDaInstalacao {
  return { tipo: "recusada", motivo, mensagem: MENSAGENS[motivo], detalhe };
}

function lerJson(arquivo: string): Record<string, unknown> | null {
  try {
    const lido: unknown = JSON.parse(readFileSync(arquivo, "utf8"));
    return typeof lido === "object" && lido !== null && !Array.isArray(lido) ? (lido as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function lerPasta(destino: string): Pasta {
  let nomes: string[];
  try {
    nomes = readdirSync(destino);
  } catch (erro) {
    if ((erro as { code?: string }).code === "ENOENT") return { tipo: "nova" };
    return { tipo: "outra" };
  }
  if (nomes.length === 0) return { tipo: "nova" };
  const pacote = lerJson(path.join(destino, "package.json"));
  if (pacote?.name !== NOME_DO_PACOTE_NPM) return { tipo: "outra" };
  const versao = typeof pacote.version === "string" && PADRAO_DE_VERSAO.test(pacote.version) ? pacote.version : null;
  const lista = lerJson(path.join(destino, LISTA_DO_PACOTE));
  return { tipo: "secretaria", versao, doPacote: typeof lista?.versao === "string" ? lista.versao : null, git: existsSync(path.join(destino, ".git")) };
}

/** No Windows, o antivírus segura por instantes um arquivo recém-extraído; fora dele, não há nova tentativa. */
function renomearComEspera(de: string, para: string): void {
  for (const espera of [...ESPERAS_NO_WINDOWS_MS, null]) {
    try {
      renameSync(de, para);
      return;
    } catch (erro) {
      const emUso = ["EPERM", "EBUSY", "EACCES"].includes((erro as { code?: string }).code ?? "");
      if (espera === null || !emUso || process.platform !== "win32") throw erro;
      Bun.sleepSync(espera);
    }
  }
}

function carimbo(agora: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
}

function pastaLivre(base: string): string {
  for (let n = 1; ; n++) {
    const candidata = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(candidata)) return candidata;
  }
}

/**
 * Põe o que está em `extraida` dentro de `destino`, entrada por entrada. Com `guardada`, antes
 * leva para lá tudo de `destino` menos o `meu/`. Renomear as entradas, e não a pasta inteira,
 * deixa a pasta trocar mesmo sendo a pasta atual do terminal no Windows. Falha no meio desfaz
 * na ordem inversa.
 */
function trocar(destino: string, extraida: string, guardada: string | null, renomear: (de: string, para: string) => void): void {
  const feitos: [de: string, para: string][] = [];
  const mover = (de: string, para: string) => {
    renomear(de, para);
    feitos.push([de, para]);
  };
  try {
    mkdirSync(destino, { recursive: true });
    if (guardada !== null) {
      mkdirSync(guardada);
      for (const nome of readdirSync(destino)) if (nome !== FICA_NA_PASTA) mover(path.join(destino, nome), path.join(guardada, nome));
    }
    for (const nome of readdirSync(extraida)) mover(path.join(extraida, nome), path.join(destino, nome));
  } catch (erro) {
    for (const [de, para] of feitos.reverse()) {
      try {
        renomear(para, de);
      } catch {
        // O que não voltou continua inteiro na cópia guardada, que então não é apagada.
      }
    }
    if (guardada !== null) {
      try {
        rmdirSync(guardada);
      } catch {
        // Só sai a cópia que ficou vazia.
      }
    }
    throw erro;
  }
}

/** Busca, confere e põe a última versão em `destino`. Nada roda do pacote antes de a assinatura e o sha256 conferirem. */
export async function instalarPelaVersao(opcoes: OpcoesDaInstalacao): Promise<DesfechoDaInstalacao> {
  const { destino, fonte } = opcoes;
  opcoes.avisar("Conferindo a última versão da Secretária.");
  const resposta = await buscarVersao(fonte);
  if (resposta.tipo === "sem_resposta") return recusar("sem_internet", "o versao.json não respondeu");
  if (resposta.status === 404) return recusar("sem_versao_publicada", "o endereço da última versão respondeu 404");
  if (resposta.status !== 200) return recusar("sem_internet", `o endereço da última versão respondeu ${resposta.status}`);
  const aberto = await abrirEnvelope(resposta.corpo, fonte.chaves);
  if (!aberto.ok) return recusar("versao_recusada", `${aberto.motivo}: ${aberto.detalhe}`);
  const leitura = lerManifesto(aberto.manifesto);
  if (!leitura.ok) return recusar("versao_recusada", `${leitura.motivo}: ${leitura.detalhe}`);
  const { manifesto } = leitura;
  if (versaoMaior(manifesto.bunMinimo, Bun.version)) return recusar("bun_antigo", `a ${manifesto.versao} pede o Bun ${manifesto.bunMinimo}, e este é o ${Bun.version}`);

  const pasta = lerPasta(destino);
  if (pasta.tipo === "outra") return recusar("pasta_de_outra_coisa", "a pasta tem arquivos e não tem o package.json da Secretária");
  if (pasta.tipo === "secretaria") {
    if (pasta.versao !== null && versaoMaior(pasta.versao, manifesto.versao)) {
      return recusar("versao_mais_velha", `a pasta tem a ${pasta.versao}, e a publicada é a ${manifesto.versao}`);
    }
    if (!pasta.git && pasta.versao === manifesto.versao && pasta.doPacote === manifesto.versao) return { tipo: "ja_estava", versao: manifesto.versao };
  }

  opcoes.avisar(`Baixando a Secretária ${manifesto.versao}.`);
  const bytes = await baixarPacote(fonte.pacote(manifesto.pacote.url), manifesto.pacote.bytes);
  if (bytes === null) return recusar("sem_internet", "o pacote não chegou");
  const conferido = conferirPacote(bytes, manifesto);
  if (!conferido.ok) return recusar("pacote_recusado", conferido.detalhe);

  const mae = path.dirname(path.resolve(destino));
  const extraida = path.join(mae, `.${path.basename(destino)}.instalando`);
  mkdirSync(mae, { recursive: true });
  rmSync(extraida, { recursive: true, force: true });
  try {
    const extracao = extrairPacote(conferido.pacote, extraida);
    if (!extracao.ok) return recusar("pacote_recusado", extracao.detalhe);

    let guardada: string | null = null;
    if (pasta.tipo === "secretaria") {
      // Uma Secretária aberta nesta pasta segura os arquivos; `4` é a saída de quem já estava parada.
      const parada = await opcoes.rodar([process.execPath, "secretaria", "parar", "--json"], destino, true);
      if (parada !== 0 && parada !== 4) opcoes.avisar("Não deu para fechar a Secretária desta pasta. A troca tenta assim mesmo.");
      guardada = pastaLivre(path.join(mae, `${path.basename(destino)}-antes-${carimbo(opcoes.agora)}`));
    }
    try {
      trocar(destino, extraida, guardada, opcoes.renomear ?? renomearComEspera);
    } catch (erro) {
      // Só o código do erro: a mensagem do sistema traz o caminho, que mostra o nome do usuário.
      return recusar("troca_falhou", (erro as { code?: string }).code ?? (erro instanceof Error ? erro.name : typeof erro));
    }

    for (const [caminho, conteudo] of Object.entries(opcoes.meuInicial)) {
      const alvo = path.join(destino, FICA_NA_PASTA, ...caminho.split("/"));
      if (existsSync(alvo)) continue;
      mkdirSync(path.dirname(alvo), { recursive: true });
      writeFileSync(alvo, conteudo);
    }
    if (guardada !== null && existsSync(path.join(guardada, PERMISSOES_LOCAIS))) {
      mkdirSync(path.join(destino, ".claude"), { recursive: true });
      copyFileSync(path.join(guardada, PERMISSOES_LOCAIS), path.join(destino, PERMISSOES_LOCAIS));
    }
    return { tipo: "instalada", versao: manifesto.versao, guardada };
  } finally {
    try {
      rmSync(extraida, { recursive: true, force: true });
    } catch {
      // No Windows, um arquivo preso segura a pasta; a próxima rodada a apaga antes de extrair.
    }
  }
}

/** Sem pasta dita, a pasta atual quando ela é a Secretária; senão, `secretaria-profills` dentro dela. */
export function resolverDestino(cwd: string, pedida: string | undefined): string {
  if (pedida !== undefined && pedida !== "") return path.resolve(cwd, pedida);
  return lerPasta(cwd).tipo === "secretaria" ? path.resolve(cwd) : path.join(path.resolve(cwd), NOME_DO_PACOTE_NPM);
}

/** O que o gerador do script embute: a fonte das versões e o esqueleto de `meu/`. */
export interface ConfiguracaoDoScript {
  readonly fonte: FonteDasVersoes;
  readonly meuInicial: Readonly<Record<string, string>>;
}

export interface EfeitosDoScript {
  readonly cwd: string;
  readonly agora: Date;
  rodar(argv: readonly string[], cwd: string, quieto?: boolean): Promise<number>;
  escrever(texto: string): void;
}

const DEPOIS_DA_TROCA = [
  ["install", "--frozen-lockfile"],
  ["secretaria", "instalar"],
  ["secretaria", "abrir"],
] as const;

function efeitosReais(): EfeitosDoScript {
  return {
    cwd: process.cwd(),
    agora: new Date(),
    rodar: (argv, cwd, quieto = false) => Bun.spawn([...argv], { cwd, stdio: quieto ? ["ignore", "ignore", "ignore"] : ["inherit", "inherit", "inherit"] }).exited,
    escrever: (texto) => process.stdout.write(`${texto}\n`),
  };
}

/** O que o script roda: `bun instalar.js [pasta]`. Devolve a saída do processo. */
export async function principal(argv: readonly string[], configuracao: ConfiguracaoDoScript, efeitos: EfeitosDoScript = efeitosReais()): Promise<number> {
  const destino = resolverDestino(efeitos.cwd, argv[0]);
  const desfecho = await instalarPelaVersao({ destino, ...configuracao, agora: efeitos.agora, rodar: efeitos.rodar, avisar: efeitos.escrever });
  if (desfecho.tipo === "recusada") {
    efeitos.escrever(`${desfecho.mensagem}\nPara o suporte: ${desfecho.motivo} (${desfecho.detalhe}).`);
    return 1;
  }
  if (desfecho.tipo === "instalada" && desfecho.guardada !== null) {
    efeitos.escrever(`A pasta antiga ficou guardada em ${desfecho.guardada}. A pasta meu e os seus dados continuam no lugar. Apague a pasta guardada quando tudo estiver funcionando.`);
  }
  for (const passo of DEPOIS_DA_TROCA) {
    const codigo = await efeitos.rodar([process.execPath, ...passo], destino);
    if (codigo !== 0) {
      efeitos.escrever(`A instalação parou em "bun ${passo.join(" ")}". Rode o script de novo. Se parar de novo, peça ajuda ao seu agente.`);
      return codigo;
    }
  }
  efeitos.escrever(`A Secretária ${desfecho.versao} está em ${destino}. Para usar, abra o seu agente nessa pasta.`);
  return 0;
}
