import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

export interface Certificado {
  /** Chave privada em PEM. Existe só na memória do teste. */
  readonly chave: string;
  readonly certificado: string;
}

const OID_ECDSA_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];
const OID_NOME_COMUM = [0x55, 0x04, 0x03];
const OID_NOME_ALTERNATIVO = [0x55, 0x1d, 0x11];
const OID_RESTRICOES_BASICAS = [0x55, 0x1d, 0x13];

function der(tag: number, ...partes: readonly Uint8Array[]): Uint8Array {
  const corpo = Buffer.concat(partes);
  const tamanho =
    corpo.length < 0x80
      ? [corpo.length]
      : corpo.length < 0x100
        ? [0x81, corpo.length]
        : [0x82, corpo.length >> 8, corpo.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...tamanho]), corpo]);
}

const sequencia = (...partes: readonly Uint8Array[]) => der(0x30, ...partes);
const oid = (bytes: readonly number[]) => der(0x06, Buffer.from(bytes));
const octetos = (conteudo: Uint8Array) => der(0x04, conteudo);
const VERDADEIRO = der(0x01, Buffer.from([0xff]));

function nome(comum: string): Uint8Array {
  return sequencia(der(0x31, sequencia(oid(OID_NOME_COMUM), der(0x0c, Buffer.from(comum, "utf8")))));
}

function horaUtc(data: Date): Uint8Array {
  const texto = data.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
  return der(0x17, Buffer.from(texto, "ascii"));
}

function pem(rotulo: string, bytes: Uint8Array): string {
  const linhas = Buffer.from(bytes).toString("base64").match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${rotulo}-----`, ...linhas, `-----END ${rotulo}-----`, ""].join("\n");
}

/**
 * Certificado autoassinado para `localhost` e `127.0.0.1`, gerado a cada teste.
 * Ele serve de CA de si mesmo: o teste o entrega como `caExtra` do `Ambiente`.
 */
export function gerarCertificado(nomeComum = "falso.secretaria.test"): Certificado {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algoritmo = sequencia(oid(OID_ECDSA_SHA256));
  const agora = Date.now();
  const serie = randomBytes(8);
  serie[0] = (serie[0] ?? 0) & 0x7f | 0x01;

  const extensoes = der(
    0xa3,
    sequencia(
      sequencia(oid(OID_RESTRICOES_BASICAS), VERDADEIRO, octetos(sequencia(VERDADEIRO))),
      sequencia(
        oid(OID_NOME_ALTERNATIVO),
        octetos(sequencia(der(0x82, Buffer.from("localhost", "ascii")), der(0x87, Buffer.from([127, 0, 0, 1])))),
      ),
    ),
  );

  const corpo = sequencia(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serie),
    algoritmo,
    nome(nomeComum),
    sequencia(horaUtc(new Date(agora - 3_600_000)), horaUtc(new Date(agora + 24 * 3_600_000))),
    nome(nomeComum),
    publicKey.export({ type: "spki", format: "der" }),
    extensoes,
  );
  const assinatura = sign("sha256", corpo, privateKey);
  const certificado = sequencia(corpo, algoritmo, der(0x03, Buffer.from([0]), assinatura));

  return {
    chave: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certificado: pem("CERTIFICATE", certificado),
  };
}
