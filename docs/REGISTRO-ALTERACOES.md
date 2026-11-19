# Registro de alterações do laboratório

Este fork acompanha ajustes solicitados durante o uso da Secretária. Cada entrada distingue pedido, implementação e validação; uma proposta não conta como correção entregue.

- Repositório de trabalho: https://github.com/jaolemes/secretaria-profills-laboratorio
- Branch de trabalho: `laboratorio`.
- Projeto de origem: https://github.com/profillsbrasil/secretaria-profills
- Base inicial: `69a72dfdabc972118c17d8f9e6b20f1f30eee01e` da `main`, versão declarada `0.3.0`.
- Fluxo combinado: ajustar e testar localmente, manter código e registro no fork e reunir novas issues/PRs quando o usuário pedir.
- Publicar somente código e documentação sem dados pessoais. Bancos, conexões, mensagens, nomes de clientes, logs de uso e credenciais não pertencem a este registro nem ao Git.

## Visão geral

| ID | Data | Assunto | Estado | Referência |
|---|---|---|---|---|
| LAB-000 | 2026-11-19 | Preparar fork e registro de alterações | Preparado e validado | Este documento |
| LAB-001 | 2026-11-19 | Concluir tarefa retira a pendência de A responder | Pedido registrado; implementação pendente | [Issue original #28](https://github.com/profillsbrasil/secretaria-profills/issues/28) |

## LAB-000 — Preparar o desenvolvimento no fork

**Pedido:** trabalhar no código à medida que surgirem necessidades durante o uso, manter um registro e usar uma cópia no GitHub do usuário.

**Realizado:** fork do projeto oficial em `jaolemes/secretaria-profills-laboratorio`, clone vinculado a esse fork, branch `laboratorio`, remoto `upstream` para acompanhar o original e instrução no `AGENTS.md` para manter este registro. O nome distingue o laboratório de outro repositório já existente na conta.

**Validação:** origem e commit inicial conferidos; dependências instaladas com `bun install --frozen-lockfile`; `bun test testes/conferencias`: 210 passaram, 10 testes de shell Unix foram pulados no Windows e nenhum falhou. As conferências incluem a auditoria do índice do Git, as instruções e as fronteiras do projeto. `git diff --cached --check` passou. A suíte funcional completa não foi executada nesta preparação, pois só mudaram documentação e instruções.

**Aplicação em uso:** nenhuma mudança funcional foi aplicada à instalação em execução nesta preparação. O clone é separado da instalação publicada e não contém seus dados.

## LAB-001 — Concluir tarefa criada em A responder

**Pedido:** ao concluir uma tarefa criada a partir de um item de **A responder**, retirar a pendência correspondente dessa aba.

**Comportamento anterior:** na versão `0.3.0`, a tarefa criada pelo Meu dia preserva o cliente, mas não um vínculo específico com a conversa/pendência. A conclusão altera a tarefa; a lista de conversas não consulta essa conclusão. Achado por leitura do código, sem reprodução adicional com dados reais.

**Implementação:** pendente. Proposta: preservar a origem e a referência às mensagens cobertas pela tarefa e resolver somente essa pendência quando a tarefa for concluída.

**Validação prevista:** a pendência sai e sua contagem é atualizada; a mesma pendência não retorna ao recarregar, reiniciar ou sincronizar; outras conversas e novas mensagens continuam visíveis; o histórico é preservado. Cobrir WhatsApp e e-mail, repetição de pedidos e concorrência com novas mensagens usando dados fictícios.

**Limitações a tratar:** tarefas antigas não têm vínculo de origem; não inferir a conversa apenas pelo cliente ou pelo título. Definir o comportamento da reabertura pelo vendedor e da conclusão com próximo passo durante a implementação.

**Referência existente:** [profillsbrasil/secretaria-profills#28](https://github.com/profillsbrasil/secretaria-profills/issues/28), aberta antes da decisão de reunir as próximas issues.

## Modelo para as próximas entradas

### LAB-NNN — Título curto

- Data e estado:
- Pedido do usuário:
- Comportamento anterior e evidência:
- Alteração implementada e arquivos principais:
- Validação realizada e resultado:
- Limitações ou pendências:
- Aplicada na instalação em uso:
- Commit(s):
- Issue/PR, quando solicitado:

Preservar o histórico e atualizar os estados. Registrar os resultados efetivos dos testes e da aplicação; não marcar como concluído apenas porque o código foi escrito.
