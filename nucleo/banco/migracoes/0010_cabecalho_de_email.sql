CREATE TABLE `email_cabecalho` (
	`conta_id` text NOT NULL,
	`pasta` text NOT NULL,
	`uid` integer NOT NULL,
	`message_id` text,
	`conversa` text NOT NULL,
	`remetente` text NOT NULL,
	`remetente_nome` text,
	`destinatarios` text NOT NULL,
	`instante` text NOT NULL,
	`assunto` text,
	`da_conta` integer NOT NULL,
	`automatico` integer NOT NULL,
	`sinais_do_assunto` text NOT NULL,
	`sinais_do_nome` text NOT NULL,
	PRIMARY KEY(`conta_id`, `pasta`, `uid`),
	FOREIGN KEY (`conta_id`) REFERENCES `email_conta`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_cabecalho_pasta" CHECK("email_cabecalho"."pasta" IN ('entrada', 'enviados')),
	CONSTRAINT "email_cabecalho_uid" CHECK("email_cabecalho"."uid" >= 1),
	CONSTRAINT "email_cabecalho_da_conta" CHECK("email_cabecalho"."da_conta" IN (0, 1)),
	CONSTRAINT "email_cabecalho_automatico" CHECK("email_cabecalho"."automatico" IN (0, 1)),
	CONSTRAINT "email_cabecalho_destinatarios_json" CHECK(json_valid("email_cabecalho"."destinatarios")),
	CONSTRAINT "email_cabecalho_sinais_do_assunto_json" CHECK(json_valid("email_cabecalho"."sinais_do_assunto")),
	CONSTRAINT "email_cabecalho_sinais_do_nome_json" CHECK(json_valid("email_cabecalho"."sinais_do_nome")),
	CONSTRAINT "email_cabecalho_remetente_minusculo" CHECK("email_cabecalho"."remetente" = lower("email_cabecalho"."remetente"))
);
--> statement-breakpoint
CREATE TABLE `email_cursor` (
	`conta_id` text NOT NULL,
	`pasta` text NOT NULL,
	`caminho` text NOT NULL,
	`uid_validity` text NOT NULL,
	`ultimo_uid` integer NOT NULL,
	`lido_em` text,
	PRIMARY KEY(`conta_id`, `pasta`),
	FOREIGN KEY (`conta_id`) REFERENCES `email_conta`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_cursor_pasta" CHECK("email_cursor"."pasta" IN ('entrada', 'enviados')),
	CONSTRAINT "email_cursor_ultimo_uid" CHECK("email_cursor"."ultimo_uid" >= 0)
);
