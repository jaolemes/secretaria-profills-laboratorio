import { partesDoTexto } from "../conversas";

/** O texto como texto puro: cada `⟦U+XXXX⟧` ganha destaque, e nada vira HTML nem link. */
export function TextoMarcado({ texto }: { texto: string }) {
  return (
    <>
      {partesDoTexto(texto).map((parte, indice) =>
        parte.marca ? (
          <mark key={indice} className="rounded-sm bg-destaque/20 px-1 font-mono text-xs text-destaque">
            {parte.texto}
          </mark>
        ) : (
          <span key={indice}>{parte.texto}</span>
        ),
      )}
    </>
  );
}

/** O bloco do texto de uma mensagem ou de um e-mail, com a quebra das linhas e das palavras longas. */
export function TextoDaMensagem({ texto }: { texto: string }) {
  return (
    <div className="rounded-lg border bg-sidebar px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap">
      <TextoMarcado texto={texto} />
    </div>
  );
}
