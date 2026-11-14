import type { Conectores } from "../../nucleo/conectores";
import { ESPELHAR, PAREAR } from "../servidor/palco";
import { esperar, type Bancada } from "./bancada";
import type { LeiturasDoWacliFalso } from "./wacli";

/** O vendedor pareia e confirma a conta: o WhatsApp fica `conectado`, e `leituras` é o que o wacli falso devolve ao ler. */
export async function conectarWhatsapp(bancada: Bancada, conectores: Conectores, leituras: LeiturasDoWacliFalso = {}): Promise<void> {
  bancada.roteiro({ auth: PAREAR, sync: ESPELHAR, leituras });
  await conectores.pronto;
  await conectores.agir("whatsapp", "conectar", { meio: "qr" });
  await esperar(conectores, (e) => e.whatsapp.fase === "pareando", "pareando");
  bancada.celular("leu");
  await esperar(conectores, (e) => e.whatsapp.fase === "sincronizando", "sincronizando");
  bancada.celular("sincronizou");
  await esperar(conectores, (e) => e.whatsapp.fase === "confirmar_conta", "confirmar a conta");
  await conectores.agir("whatsapp", "confirmar");
  await esperar(conectores, (e) => e.whatsapp.fase === "conectado" && e.whatsapp.espelho === "ao_vivo", "espelho ao vivo");
}
