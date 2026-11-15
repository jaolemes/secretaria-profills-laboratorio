---
name: secretaria-estender
description: Guia o pedido do vendedor por uma funcionalidade nova na Secretária, decidindo o que vai em `meu/` e o que é pedido à Profills, e fecha com os testes. Use quando o vendedor pedir para criar, mudar ou automatizar algo na Secretária (tabela, regra, skill, página, comando).
---

# Estender a Secretária

## Como falar e rodar

- Fale com o vendedor em frases curtas e diga o próximo passo. Diga o erro em palavras, sem código de erro, nome de comando, de arquivo ou de repositório em crase. Conte o que a skill manda como fala sua, sem citar skill, arquivo nem link de arquivo. Comando só aparece quando ele precisa digitar, assim: "abra o terminal nesta pasta e digite `bun secretaria abrir`".
- Rode um comando por chamada, sem `;`, `|`, `&&` nem parênteses: comando encadeado não casa com a permissão do Claude Code.

O repo tem dois donos.

| Pasta | Dono | Quem muda |
|---|---|---|
| `nucleo/` | Profills. Chega nas atualizações. | Só a Profills. Mudança local sai do ar na próxima atualização: fica uma cópia, e o painel avisa quantos arquivos eram. |
| `meu/` | O vendedor. A atualização nunca mexe. | Você, a pedido do vendedor. |

Leia `meu/AGENTS.md` antes: são as regras dele.

## Onde vai cada coisa

| Pedido | Onde | Regra |
|---|---|---|
| Regra de trabalho ("prefiro e-mail curto") | `meu/AGENTS.md` | Uma linha por regra. |
| Skill dele | `meu/skills/meu-<nome>/SKILL.md` | Pasta e `name` começam com `meu-`. `bun secretaria instalar` copia para `.agents/skills` e `.claude/skills`. |
| Tabela nova | `meu/migracoes/NNNN_<nome>.sql` | Número na ordem. O servidor aplica ao subir, em `meu.db`, na pasta de dados, com backup antes. Migração aplicada não muda: corrija com outra. |
| Página ou comando novo | ainda não há lugar | O núcleo ainda não tem `nucleo/extensao.ts`, o contrato que lê código de `meu/`. Diga ao vendedor que isso depende da Profills e anote o pedido em `meu/AGENTS.md`. |
| Mudança no comportamento do núcleo | pedido à Profills | Não edite `nucleo/`. |

As tabelas do vendedor moram em `meu.db`, um arquivo SQLite separado do banco do núcleo (`secretaria.db`). A migração dele roda só nesse arquivo: não existe ali tabela do núcleo para ler ou alterar, e `ATTACH` é recusado. Migração que falha é desfeita, vira `MigracaoRecusada` e o servidor não sobe até você corrigir o arquivo. As fronteiras de import entre `meu/` e `nucleo/` são cobradas por `testes/conferencias/fronteiras.test.ts`.

## Antes de dizer que terminou

1. `bun test` sai com 0.
2. `bun run tipos` sai com 0.
3. Com tabela nova, rode `bun secretaria parar --json` e depois `bun secretaria abrir --json`: a migração só roda quando o servidor sobe, e um servidor que já estava no ar não a aplica. `servidor_fora_do_ar` no `parar` quer dizer que ele já estava parado. O `abrir` sobe sem `MigracaoRecusada` e `bun secretaria status --json` responde.
4. Conte ao vendedor o que mudou em palavras dele ("agora a Secretária guarda a lista de visitas"), sem nome de arquivo. Mostre os arquivos só se ele pedir.

Comandos de Bun e Drizzle deste repo: skill `ferramentas-bun-drizzle`. Componentes do painel: skill `shadcn`.
