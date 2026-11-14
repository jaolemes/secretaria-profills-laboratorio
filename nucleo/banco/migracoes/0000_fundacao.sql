CREATE TABLE `conector` (
	`id` text PRIMARY KEY NOT NULL,
	`fase` text DEFAULT 'desconectado' NOT NULL,
	`identidade` text,
	`config` text,
	`codigo_problema` text,
	`conexao_expira_em` text,
	`verificado_em` text,
	`atualizado_em` text NOT NULL,
	CONSTRAINT "conector_id" CHECK("conector"."id" IN ('whatsapp', 'crm', 'email')),
	CONSTRAINT "conector_fase" CHECK("conector"."fase" IN ('desconectado', 'conectado', 'atencao')),
	CONSTRAINT "conector_config_json" CHECK("conector"."config" IS NULL OR json_valid("conector"."config")),
	CONSTRAINT "conector_problema_so_em_atencao" CHECK(("conector"."fase" = 'atencao') = ("conector"."codigo_problema" IS NOT NULL)),
	CONSTRAINT "conector_conectado_verificado" CHECK("conector"."fase" <> 'conectado' OR "conector"."verificado_em" IS NOT NULL),
	CONSTRAINT "conector_conectado_com_identidade" CHECK("conector"."fase" <> 'conectado' OR "conector"."id" = 'crm' OR "conector"."identidade" IS NOT NULL),
	CONSTRAINT "conector_email_com_config" CHECK("conector"."id" <> 'email' OR "conector"."fase" <> 'conectado' OR "conector"."config" IS NOT NULL),
	CONSTRAINT "conector_crm_com_prazo" CHECK("conector"."id" <> 'crm' OR "conector"."fase" <> 'conectado' OR "conector"."conexao_expira_em" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `evento_conector` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conector` text NOT NULL,
	`tipo` text NOT NULL,
	`detalhe` text DEFAULT '{}' NOT NULL,
	`em` text NOT NULL,
	FOREIGN KEY (`conector`) REFERENCES `conector`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "evento_conector_detalhe_json" CHECK(json_valid("evento_conector"."detalhe"))
);
--> statement-breakpoint
CREATE INDEX `evento_conector_por_conector` ON `evento_conector` (`conector`,`id`);--> statement-breakpoint
CREATE TABLE `instalacao` (
	`id` integer PRIMARY KEY NOT NULL,
	`id_instalacao` text NOT NULL,
	`criada_em` text NOT NULL,
	`cofre_backend` text,
	CONSTRAINT "instalacao_unica" CHECK("instalacao"."id" = 1),
	CONSTRAINT "instalacao_cofre_backend" CHECK("instalacao"."cofre_backend" IS NULL OR "instalacao"."cofre_backend" IN ('sistema', 'arquivo'))
);
