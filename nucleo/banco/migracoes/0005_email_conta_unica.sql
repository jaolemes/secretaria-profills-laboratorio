-- A conta única de e-mail, que morava na linha `email` de `conector`, vira a primeira linha de
-- `email_conta`, com rótulo "Profills", o mesmo estado e a trilha dela. Sem endereço ou sem
-- configuração gravados, não havia conta: nada vai para a tabela nova. `senha_legada = 1` diz ao
-- servidor que a senha ainda está na chave antiga do cofre, `email.senha`.
INSERT INTO `email_conta` (`id`, `rotulo`, `provedor`, `endereco`, `servidor`, `porta`, `seguranca`, `janela_dias`, `fase`, `codigo_problema`, `verificado_em`, `senha_legada`, `criada_em`, `atualizado_em`)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  'Profills',
  CASE lower(json_extract(`config`, '$.servidor')) WHEN 'imap.gmail.com' THEN 'gmail' WHEN 'imap.kinghost.net' THEN 'profills' ELSE 'outro' END,
  `identidade`,
  json_extract(`config`, '$.servidor'),
  json_extract(`config`, '$.porta'),
  json_extract(`config`, '$.seguranca'),
  30,
  `fase`,
  `codigo_problema`,
  `verificado_em`,
  1,
  `atualizado_em`,
  `atualizado_em`
FROM `conector`
WHERE `id` = 'email'
  AND `fase` <> 'desconectado'
  AND `identidade` IS NOT NULL
  AND `config` IS NOT NULL
  AND json_type(`config`, '$.servidor') = 'text'
  AND json_type(`config`, '$.porta') = 'integer'
  AND json_extract(`config`, '$.porta') BETWEEN 1 AND 65535
  AND json_extract(`config`, '$.seguranca') IN ('tls', 'starttls');
--> statement-breakpoint
INSERT INTO `evento_email` (`conta_id`, `tipo`, `detalhe`, `em`)
SELECT (SELECT `id` FROM `email_conta` WHERE `senha_legada` = 1), `tipo`, `detalhe`, `em`
FROM `evento_conector`
WHERE `conector` = 'email' AND EXISTS (SELECT 1 FROM `email_conta` WHERE `senha_legada` = 1)
ORDER BY `id`;
--> statement-breakpoint
DELETE FROM `evento_conector` WHERE `conector` = 'email';
--> statement-breakpoint
DELETE FROM `conector` WHERE `id` = 'email';
