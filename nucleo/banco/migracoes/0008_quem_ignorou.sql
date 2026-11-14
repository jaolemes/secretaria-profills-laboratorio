PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item_ignorado` (
	`tipo` text NOT NULL,
	`crm_id` integer NOT NULL,
	`ate` text NOT NULL,
	`criado_em` text NOT NULL,
	`quem` text DEFAULT 'vendedor' NOT NULL,
	`motivo` text,
	`nome` text DEFAULT '' NOT NULL,
	`codigo` text,
	PRIMARY KEY(`tipo`, `crm_id`),
	CONSTRAINT "item_ignorado_tipo" CHECK("tipo" IN ('proposta', 'cliente')),
	CONSTRAINT "item_ignorado_crm_id" CHECK("crm_id" >= 1),
	CONSTRAINT "item_ignorado_ate" CHECK(length("ate") = 10 AND date("ate") IS "ate"),
	CONSTRAINT "item_ignorado_quem" CHECK("quem" IN ('vendedor', 'agente')),
	CONSTRAINT "item_ignorado_motivo" CHECK("motivo" IS NULL OR length("motivo") BETWEEN 5 AND 300),
	CONSTRAINT "item_ignorado_motivo_do_agente" CHECK("quem" = 'vendedor' OR "motivo" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_item_ignorado`("tipo", "crm_id", "ate", "criado_em") SELECT "tipo", "crm_id", "ate", "criado_em" FROM `item_ignorado`;--> statement-breakpoint
DROP TABLE `item_ignorado`;--> statement-breakpoint
ALTER TABLE `__new_item_ignorado` RENAME TO `item_ignorado`;--> statement-breakpoint
PRAGMA foreign_keys=ON;