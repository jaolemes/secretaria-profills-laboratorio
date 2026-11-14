import { Building2, ExternalLink } from "lucide-react";
import { ROTULOS_DAS_ACOES } from "../../dominio";
import { Button } from "@/components/ui/button";
import { ROTA_DO_LOGIN_DO_CRM } from "../api";
import { descrever, NOMES_DOS_CONECTORES } from "../descrever";
import { AcoesDoRodape, type PropsDoConector } from "./comum";
import { Cartao, Prazo } from "./Cartao";

/**
 * Conectar é navegação, não `fetch`: o login abre numa aba nova pelo próprio clique,
 * então o bloqueador de popup não age, e o servidor responde com o redirecionamento.
 */
function LinkDoLogin({ livre }: { livre: boolean }) {
  return (
    <Button asChild>
      <a
        href={livre ? ROTA_DO_LOGIN_DO_CRM : undefined}
        target="_blank"
        rel="noopener"
        aria-disabled={!livre}
        role={livre ? undefined : "link"}
      >
        {ROTULOS_DAS_ACOES.conectar}
        <ExternalLink aria-hidden />
        <span className="sr-only"> (abre o login do CRM numa aba nova)</span>
      </a>
    </Button>
  );
}

export function CartaoCrm({ estado, acoes, agora, livre, erro, agir }: PropsDoConector<"crm">) {
  const descricao = descrever("crm", estado, agora);
  const podeConectar = acoes.includes("conectar");
  return (
    <Cartao
      nome={NOMES_DOS_CONECTORES.crm}
      Icone={Building2}
      descricao={descricao}
      erro={erro}
      rodape={<AcoesDoRodape id="crm" acoes={acoes} livre={livre} agir={agir} conectar={<LinkDoLogin livre={livre} />} />}
    >
      {podeConectar && (
        <p className="text-sm leading-snug text-muted-foreground">
          O login do CRM abre numa aba nova. Depois de entrar, volte para esta aba: o cartão muda sozinho.
        </p>
      )}
      {estado.fase === "autorizando" && <Prazo expiraEm={estado.expiraEm} agora={agora} rotulo="Tempo para fazer o login:" />}
    </Cartao>
  );
}
