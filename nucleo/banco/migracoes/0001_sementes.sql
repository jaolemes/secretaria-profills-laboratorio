-- Uma linha por conector de CONECTORES, todas em `desconectado`.
INSERT INTO `conector` (`id`, `atualizado_em`) VALUES
  ('whatsapp', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('crm', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('email', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
