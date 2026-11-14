import { LoaderCircle, MessageCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useId, useState, type FormEvent } from "react";
import { ROTULOS_DAS_ACOES, type EstadoWhatsapp } from "../../dominio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { descrever, NOMES_DOS_CONECTORES } from "../descrever";
import { lerTelefoneDigitado } from "../formularios";
import { AcoesDoRodape, type PropsDoConector } from "./comum";
import { Cartao, Prazo } from "./Cartao";

const PASSOS_NO_CELULAR = "No celular, abra o WhatsApp e toque em Configurações, depois em Aparelhos conectados e em Conectar aparelho.";

function Pareamento({ estado, agora }: { estado: Extract<EstadoWhatsapp, { fase: "pareando" }>; agora: Date }) {
  const { meio } = estado;
  switch (meio.tipo) {
    case "iniciando":
      return (
        <div className="grid aspect-square w-full max-w-56 place-items-center self-center rounded-xl bg-muted">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-muted-foreground" />
        </div>
      );
    case "qr":
      return (
        <div className="flex flex-col gap-3">
          <div className="self-center rounded-xl bg-white p-3">
            <QRCodeSVG
              key={meio.qr}
              value={meio.qr}
              size={200}
              level="L"
              role="img"
              aria-label="QR para conectar o WhatsApp"
              className="block size-48 sm:size-52"
            />
          </div>
          <p className="text-sm leading-snug text-muted-foreground">{PASSOS_NO_CELULAR} Aponte a câmera para o QR.</p>
          <Prazo expiraEm={estado.expiraEm} agora={agora} rotulo="O QR se renova sozinho. Tempo para ler:" />
        </div>
      );
    case "codigo":
      return (
        <div className="flex flex-col gap-3">
          <p className="self-center rounded-xl bg-muted px-5 py-4 font-mono text-3xl font-semibold tracking-[0.2em] tabular-nums" aria-label={`Código ${meio.codigo.split("").join(" ")}`}>
            {meio.codigo}
          </p>
          <p className="text-sm leading-snug text-muted-foreground">
            {PASSOS_NO_CELULAR} Toque em Conectar com número de telefone e digite o código.
          </p>
          <Prazo expiraEm={estado.expiraEm} agora={agora} rotulo="Tempo para digitar:" />
        </div>
      );
  }
}

/** A ação conectar do WhatsApp: QR por padrão, ou código pelo número de telefone. */
function EscolhaDeConexao({ livre, agir }: Pick<PropsDoConector<"whatsapp">, "livre" | "agir">) {
  const [pedirNumero, setPedirNumero] = useState(false);
  const [erroDoNumero, setErroDoNumero] = useState<string | null>(null);
  const idDoCampo = useId();

  const enviarNumero = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const telefone = lerTelefoneDigitado(String(new FormData(evento.currentTarget).get("telefone") ?? ""));
    if (telefone === null) return setErroDoNumero("Digite o número com DDD, como (11) 98765-4321.");
    setErroDoNumero(null);
    agir({ id: "whatsapp", acao: "conectar", corpo: { meio: "codigo", telefone } });
  };

  if (!pedirNumero) {
    return (
      <>
        <Button variant="outline" disabled={!livre} onClick={() => setPedirNumero(true)}>
          Usar código no lugar do QR
        </Button>
        <Button disabled={!livre} onClick={() => agir({ id: "whatsapp", acao: "conectar", corpo: { meio: "qr" } })}>
          {ROTULOS_DAS_ACOES.conectar}
        </Button>
      </>
    );
  }

  return (
    <form onSubmit={enviarNumero} className="flex w-full flex-col gap-2" noValidate>
      <Label htmlFor={idDoCampo}>Número do WhatsApp de trabalho</Label>
      <Input
        id={idDoCampo}
        name="telefone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="(00) 00000-0000"
        aria-invalid={erroDoNumero !== null}
        aria-describedby={erroDoNumero ? `${idDoCampo}-erro` : undefined}
        autoFocus
      />
      {erroDoNumero && (
        <p id={`${idDoCampo}-erro`} className="text-sm text-destructive">
          {erroDoNumero}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={() => setPedirNumero(false)}>
          Voltar ao QR
        </Button>
        <Button type="submit" disabled={!livre}>
          Gerar código
        </Button>
      </div>
    </form>
  );
}

export function CartaoWhatsapp({ estado, acoes, agora, livre, erro, agir }: PropsDoConector<"whatsapp">) {
  const descricao = descrever("whatsapp", estado, agora);
  return (
    <Cartao
      nome={NOMES_DOS_CONECTORES.whatsapp}
      Icone={MessageCircle}
      descricao={descricao}
      erro={erro}
      rodape={<AcoesDoRodape id="whatsapp" acoes={acoes} livre={livre} agir={agir} conectar={<EscolhaDeConexao livre={livre} agir={agir} />} />}
    >
      {estado.fase === "pareando" && <Pareamento estado={estado} agora={agora} />}
      {estado.fase === "sincronizando" && (
        <>
          <p className="text-sm leading-snug text-muted-foreground">Pode levar alguns minutos. Você pode deixar esta tela aberta.</p>
          <Prazo expiraEm={estado.expiraEm} agora={agora} rotulo="Tempo máximo:" />
        </>
      )}
      {estado.fase === "confirmar_conta" && (
        <p className="text-sm leading-snug text-muted-foreground">
          A Secretária só começa a ler as conversas depois que você confirmar que este é o WhatsApp que você usa no trabalho.
        </p>
      )}
    </Cartao>
  );
}
