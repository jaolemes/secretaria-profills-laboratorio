# meu/

Esta pasta é do vendedor. A atualização do núcleo da Profills nunca muda nada aqui.

| Caminho | Para quê |
|---|---|
| `meu/AGENTS.md` | suas regras para o agente, uma por linha |
| `meu/skills/meu-<nome>/SKILL.md` | skills suas; `bun secretaria instalar` copia para `.agents/skills` e `.claude/skills` |
| `meu/migracoes/NNNN_<nome>.sql` | tabelas suas, criadas em `meu.db`, na pasta de dados |

`meu.db` é um arquivo só seu, separado do banco do núcleo (`secretaria.db`). Uma migração sua não lê nem altera dado do núcleo, e `ATTACH` é recusado.

Páginas e comandos seus ainda não têm lugar: o núcleo ainda não lê código desta pasta. Peça ao agente, com a skill `secretaria-estender`, para ver o que dá para fazer hoje.
