CREATE TABLE `email_conta` (
	`id` text PRIMARY KEY NOT NULL,
	`rotulo` text NOT NULL,
	`provedor` text NOT NULL,
	`endereco` text NOT NULL,
	`servidor` text NOT NULL,
	`porta` integer NOT NULL,
	`seguranca` text NOT NULL,
	`janela_dias` integer DEFAULT 30 NOT NULL,
	`fase` text DEFAULT 'desconectado' NOT NULL,
	`codigo_problema` text,
	`verificado_em` text,
	`senha_legada` integer DEFAULT 0 NOT NULL,
	`criada_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	CONSTRAINT "email_conta_rotulo" CHECK(length(trim("email_conta"."rotulo")) BETWEEN 1 AND 30),
	CONSTRAINT "email_conta_provedor" CHECK("email_conta"."provedor" IN ('profills', 'gmail', 'outro')),
	CONSTRAINT "email_conta_porta" CHECK("email_conta"."porta" BETWEEN 1 AND 65535),
	CONSTRAINT "email_conta_seguranca" CHECK("email_conta"."seguranca" IN ('tls', 'starttls')),
	CONSTRAINT "email_conta_janela" CHECK("email_conta"."janela_dias" IN (30, 60, 90)),
	CONSTRAINT "email_conta_fase" CHECK("email_conta"."fase" IN ('desconectado', 'conectado', 'atencao')),
	CONSTRAINT "email_conta_problema_so_em_atencao" CHECK(("email_conta"."fase" = 'atencao') = ("email_conta"."codigo_problema" IS NOT NULL)),
	CONSTRAINT "email_conta_conectado_verificado" CHECK("email_conta"."fase" <> 'conectado' OR "email_conta"."verificado_em" IS NOT NULL),
	CONSTRAINT "email_conta_senha_legada" CHECK("email_conta"."senha_legada" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_conta_rotulo_unico` ON `email_conta` ("rotulo" COLLATE NOCASE);--> statement-breakpoint
CREATE UNIQUE INDEX `email_conta_endereco_unico` ON `email_conta` ("endereco" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `evento_email` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conta_id` text NOT NULL,
	`tipo` text NOT NULL,
	`detalhe` text DEFAULT '{}' NOT NULL,
	`em` text NOT NULL,
	FOREIGN KEY (`conta_id`) REFERENCES `email_conta`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "evento_email_detalhe_json" CHECK(json_valid("evento_email"."detalhe"))
);
--> statement-breakpoint
CREATE INDEX `evento_email_por_conta` ON `evento_email` (`conta_id`,`id`);--> statement-breakpoint
ALTER TABLE `instalacao` ADD `email_pulado_em` text;