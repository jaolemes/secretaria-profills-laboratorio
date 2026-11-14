# Segurança

## Como relatar

Relate o problema em particular pela aba Security deste repositório no GitHub, em "Report a vulnerability" (Security advisories). Não abra issue pública com o detalhe. Mande o passo que reproduz, a versão do núcleo (`bun secretaria diagnostico`) e o sistema operacional, sem dado de cliente, senha nem token.

## O que é fronteira

- A fronteira de segurança é o usuário do sistema operacional: a pasta de dados é dele, e qualquer processo dele alcança tudo.
- As travas do servidor local, o `deny` e o `ask` de `.claude/settings.json` e o cartão de aprovação barram o agente que segue as regras e a página web maliciosa, não um processo do mesmo usuário.
- O detalhe de cada barreira, e de por que ela não é fronteira, está em `docs/arquitetura.md`, seção "O que é fronteira e o que não é".
