CREATE TABLE `item_ignorado` (
	`tipo` text NOT NULL,
	`crm_id` integer NOT NULL,
	`ate` text NOT NULL,
	`criado_em` text NOT NULL,
	PRIMARY KEY(`tipo`, `crm_id`),
	CONSTRAINT "item_ignorado_tipo" CHECK("item_ignorado"."tipo" IN ('proposta', 'cliente')),
	CONSTRAINT "item_ignorado_crm_id" CHECK("item_ignorado"."crm_id" >= 1),
	CONSTRAINT "item_ignorado_ate" CHECK(length("item_ignorado"."ate") = 10 AND date("item_ignorado"."ate") IS "item_ignorado"."ate")
);
