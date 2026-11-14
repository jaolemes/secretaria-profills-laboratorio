import type { Ambiente } from "../ambiente";
import type { BancoAberto } from "../banco";
import type { Cofre } from "../cofre";
import type { Supervisor } from "../processos";
import type { Registro } from "../registro";
import type { Temporizador } from "./motor";

/** O que cada casca recebe. Nada aqui é global: o teste monta as mesmas peças com falsos. */
export interface Dependencias {
  readonly ambiente: Ambiente;
  readonly banco: BancoAberto;
  readonly cofre: Cofre;
  readonly supervisor: Supervisor;
  readonly registro: Registro;
  readonly armar: Temporizador;
  /** Teto de e-mails pedidos por pasta e por rodada. Sem ele, `TETO_POR_PASTA`. Só o teste troca. */
  readonly tetoDeEmailPorPasta?: number;
}
