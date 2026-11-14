#!/bin/sh
# Prepara a Secretária no Linux e no macOS e abre o painel. Rodar de novo não estraga nada.
# Só faz o que precisa existir antes do Bun; o resto é `bun secretaria instalar`.
set -eu

# Mínimo de `engines.bun` no package.json, e a versão que este script instala quando falta.
BUN_VERSAO="1.4.4"
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

cd "$(dirname "$0")"

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

bun install --frozen-lockfile
bun secretaria instalar
bun secretaria abrir
