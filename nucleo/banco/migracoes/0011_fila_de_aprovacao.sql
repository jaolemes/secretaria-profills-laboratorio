CREATE TABLE `decisao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escrita_id` text NOT NULL,
	`acao` text NOT NULL,
	`hash` text NOT NULL,
	`em` text NOT NULL,
	FOREIGN KEY (`escrita_id`) REFERENCES `escrita_crm`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisao_acao" CHECK("decisao"."acao" IN ('aprovou', 'editou', 'descartou', 'retirou', 'ja_esta_no_crm', 'tentou_de_novo')),
	CONSTRAINT "decisao_hash" CHECK(length("decisao"."hash") = 64)
);
--> statement-breakpoint
CREATE TABLE `escrita_crm` (
	`id` text PRIMARY KEY NOT NULL,
	`tool` text NOT NULL,
	`payload` text NOT NULL,
	`hash` text NOT NULL,
	`cliente_id` integer,
	`cliente_conferido` integer DEFAULT false NOT NULL,
	`cliente_nome` text,
	`cliente_cidade` text,
	`confira_cliente` integer DEFAULT false NOT NULL,
	`sinais` text NOT NULL,
	`estado` text DEFAULT 'rascunho' NOT NULL,
	`crm_id` integer,
	`crm_link` text,
	`erro_codigo` text,
	`erro_detalhe` text,
	`versao` integer DEFAULT 1 NOT NULL,
	`criada_em` text NOT NULL,
	`atualizada_em` text NOT NULL,
	`ordem` integer NOT NULL,
	CONSTRAINT "escrita_crm_tool" CHECK("escrita_crm"."tool" IN ('registrar_atendimento', 'criar_compromisso', 'criar_contato')),
	CONSTRAINT "escrita_crm_estado" CHECK("escrita_crm"."estado" IN ('rascunho', 'aprovado', 'gravando', 'gravado', 'falhou', 'falhou_incerto', 'descartado')),
	CONSTRAINT "escrita_crm_payload" CHECK(json_valid("escrita_crm"."payload")),
	CONSTRAINT "escrita_crm_sinais" CHECK(json_valid("escrita_crm"."sinais")),
	CONSTRAINT "escrita_crm_hash" CHECK(length("escrita_crm"."hash") = 64),
	CONSTRAINT "escrita_crm_cliente_id" CHECK("escrita_crm"."cliente_id" IS NULL OR "escrita_crm"."cliente_id" >= 1),
	CONSTRAINT "escrita_crm_versao" CHECK("escrita_crm"."versao" >= 1),
	CONSTRAINT "escrita_crm_cliente" CHECK(CASE WHEN "escrita_crm"."cliente_conferido" = 1 THEN "escrita_crm"."cliente_id" IS NOT NULL AND "escrita_crm"."cliente_nome" IS NOT NULL ELSE "escrita_crm"."cliente_conferido" = 0 AND "escrita_crm"."cliente_nome" IS NULL AND "escrita_crm"."cliente_cidade" IS NULL END),
	CONSTRAINT "escrita_crm_confira_cliente" CHECK("escrita_crm"."confira_cliente" IN (0, 1) AND ("escrita_crm"."confira_cliente" = 0 OR "escrita_crm"."cliente_id" IS NOT NULL)),
	CONSTRAINT "escrita_crm_recibo" CHECK("escrita_crm"."estado" = 'gravado' OR ("escrita_crm"."crm_id" IS NULL AND "escrita_crm"."crm_link" IS NULL)),
	CONSTRAINT "escrita_crm_erro" CHECK(("escrita_crm"."estado" IN ('falhou', 'falhou_incerto')) = ("escrita_crm"."erro_codigo" IS NOT NULL) AND ("escrita_crm"."erro_detalhe" IS NULL OR "escrita_crm"."erro_codigo" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `escrita_crm_ordem` ON `escrita_crm` (`ordem`);