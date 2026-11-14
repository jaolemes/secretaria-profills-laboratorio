import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { EmailParaOPainel, ErroOperacao, ItemDeEsperandoDeEmail, ItemDeResponderDeEmail } from "../../dominio";
import { Button } from "@/components/ui/button";
import { AlertaDeErro, Selo } from "../cartoes/Cartao";
import { Cabecalho, Corpo, Rodape } from "../cartoes/GavetaDoEmail";
import { NOMES_DOS_SINAIS, avisoDasMarcas, avisoDosEmailsSemLugar, emailsDaGaveta, partesDoTexto, tituloDoEmail } from "../conversas";
import { momento } from "../tempo";
import { api } from "./comum";
import { TextoDaMensagem, TextoMarcado } from "./TextoMarcado";

export type Lido = { readonly tipo: "ok"; readonly email: EmailParaOPainel } | { readonly tipo: "erro"; readonly erro: ErroOperacao };

/**
 * Lê cada e-mail na hora pela rota do painel. O texto fica só neste estado e some quando a gaveta
 * fecha: nada vai ao banco, ao `localStorage`, ao `sessionStorage` nem ao hash.
 */
function useEmails(conta: string, ids: readonly string[], tentativa: number): ReadonlyMap<string, Lido> {
  const [lidos, setLidos] = useState<ReadonlyMap<string, Lido>>(new Map());
  const chave = ids.join(",");

  useEffect(() => {
    let valendo = true;
    setLidos(new Map());
    for (const id of ids) {
      void api.corpoDoEmail(conta, id).then((resposta) => {
        if (!valendo) return;
        const lido: Lido = resposta.ok ? { tipo: "ok", email: resposta.dados } : { tipo: "erro", erro: resposta.erro };
        setLidos((atuais) => new Map(atuais).set(id, lido));
      });
    }
    return () => {
      valendo = false;
    };
  }, [conta, chave, tentativa]);

  return lidos;
}

/** Um e-mail lido. Com sinal, a parte suspeita fica à vista só do vendedor, com cada invisível marcado. */
export function UmEmail({ email, agora }: { email: EmailParaOPainel; agora: Date }) {
  const partes = partesDoTexto([email.assunto, email.nomeDoRemetente, email.texto].filter((texto) => texto !== null).join("\n"));
  const aviso = avisoDasMarcas(partes, "e-mail");
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">E-mail de {momento(email.em, agora)}</h3>
      <p className="text-xs leading-snug break-words text-muted-foreground">
        E-mail · {email.conta.rotulo} · de {email.de}
      </p>
      {email.sinais.length > 0 && (
        <>
          <p className="text-sm leading-snug text-muted-foreground">A Secretária escondeu do agente a parte suspeita deste e-mail. Você pode ler. Ele não.</p>
          <div className="flex flex-wrap gap-1.5">
            {email.sinais.map((sinal) => (
              <Selo key={sinal} tom="atencao" texto={NOMES_DOS_SINAIS[sinal]} />
            ))}
          </div>
          {email.assunto !== null && (
            <p className="text-sm leading-snug break-words">
              <span className="text-muted-foreground">Assunto: </span>
              <TextoMarcado texto={email.assunto} />
            </p>
          )}
          {email.nomeDoRemetente !== null && (
            <p className="text-sm leading-snug break-words">
              <span className="text-muted-foreground">Remetente: </span>
              <TextoMarcado texto={email.nomeDoRemetente} />
            </p>
          )}
        </>
      )}
      {email.origem === "nenhum" ? <p className="text-sm text-muted-foreground">Este e-mail não tem texto.</p> : <TextoDaMensagem texto={email.texto} />}
      {email.cortado && <p className="text-xs leading-snug text-muted-foreground">O e-mail é maior do que a Secretária mostra. Leia o resto no seu programa de e-mail.</p>}
      {aviso !== null && <p className="text-xs leading-snug text-muted-foreground">{aviso}</p>}
    </section>
  );
}

/** A segunda linha do cabeçalho: o assunto, ou a frase de quando ele não existe ou ficou em quarentena. */
function assuntoDoCabecalho(item: ItemDeResponderDeEmail | ItemDeEsperandoDeEmail): string {
  if (item.assunto !== null) return item.assunto;
  return item.em_quarentena ? "E-mail em quarentena" : "Sem assunto";
}

type ItemDaGaveta = ItemDeResponderDeEmail | ItemDeEsperandoDeEmail;

function idsDaGaveta(item: ItemDaGaveta) {
  return emailsDaGaveta("mensagens_em_quarentena" in item ? item : { ultimo_email: item.ultimo_email });
}

/** A gaveta "Ver e-mail": cada e-mail é lido na hora, do mais antigo para o mais novo. O vendedor lê, e nada libera o texto ao agente. */
export function LerEmail({ item, fechar }: { item: ItemDaGaveta; fechar: () => void }) {
  const [tentativa, setTentativa] = useState(0);
  const lidos = useEmails(item.conta.id, idsDaGaveta(item).ids, tentativa);
  return <ConteudoDoLerEmail item={item} lidos={lidos} tentarDeNovo={() => setTentativa((n) => n + 1)} fechar={fechar} />;
}

/** O que a gaveta mostra com os e-mails já lidos. Com erro, "Tentar de novo" lê todos outra vez. */
export function ConteudoDoLerEmail({ item, lidos, tentarDeNovo, fechar }: { item: ItemDaGaveta; lidos: ReadonlyMap<string, Lido>; tentarDeNovo: () => void; fechar: () => void }) {
  const { ids, semLugar } = idsDaGaveta(item);
  const agora = new Date();
  const faltam = ids.some((id) => !lidos.has(id));
  const comErro = [...lidos.values()].some((lido) => lido.tipo === "erro");
  const assunto = assuntoDoCabecalho(item);
  const semLugarNaGaveta = avisoDosEmailsSemLugar(semLugar);
  return (
    <>
      <Cabecalho titulo={tituloDoEmail(item)}>
        <p className="min-w-0 truncate text-sm text-muted-foreground" title={assunto}>
          {assunto}
        </p>
      </Cabecalho>
      <Corpo>
        {ids.map((id) => {
          const lido = lidos.get(id);
          if (lido === undefined) return null;
          return lido.tipo === "ok" ? <UmEmail key={id} email={lido.email} agora={agora} /> : <AlertaDeErro key={id} erro={lido.erro} />;
        })}
        {faltam && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Abrindo o e-mail.
          </p>
        )}
        {semLugarNaGaveta !== null && <p className="text-xs leading-snug text-muted-foreground">{semLugarNaGaveta}</p>}
        <p className="text-xs leading-snug text-muted-foreground">O texto é lido na hora e não fica guardado na Secretária. Links e imagens não abrem aqui.</p>
      </Corpo>
      <Rodape>
        {comErro && (
          <Button variant="outline" disabled={faltam} onClick={tentarDeNovo}>
            Tentar de novo
          </Button>
        )}
        <Button onClick={fechar}>Fechar</Button>
      </Rodape>
    </>
  );
}
