CREATE TABLE `crm_cache` (
	`recurso` text NOT NULL,
	`chave` text NOT NULL,
	`json` text NOT NULL,
	`lido_em` text NOT NULL,
	PRIMARY KEY(`recurso`, `chave`),
	CONSTRAINT "crm_cache_recurso" CHECK("crm_cache"."recurso" IN ('agenda', 'propostas', 'carteira', 'proposta_link')),
	CONSTRAINT "crm_cache_json" CHECK(json_valid("crm_cache"."json"))
);
--> statement-breakpoint
ALTER TABLE `tarefa` ADD `cliente_conferido` integer DEFAULT false NOT NULL;