CREATE TABLE `nota` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tarefa_id` text NOT NULL,
	`texto` text NOT NULL,
	`autor` text NOT NULL,
	`proximo_passo` text,
	`criada_em` text NOT NULL,
	FOREIGN KEY (`tarefa_id`) REFERENCES `tarefa`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "nota_autor" CHECK("nota"."autor" IN ('vendedor', 'agente')),
	CONSTRAINT "nota_texto" CHECK(length("nota"."texto") BETWEEN 1 AND 4000),
	CONSTRAINT "nota_proximo_passo" CHECK("nota"."proximo_passo" IS NULL OR length("nota"."proximo_passo") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `nota_por_tarefa` ON `nota` (`tarefa_id`,`id`);--> statement-breakpoint
CREATE TABLE `tarefa` (
	`id` text PRIMARY KEY NOT NULL,
	`titulo` text NOT NULL,
	`cliente_id` text,
	`cliente_nome` text,
	`proposta_codigo` text,
	`vence_em` text,
	`estado` text DEFAULT 'aberta' NOT NULL,
	`origem` text NOT NULL,
	`versao` integer DEFAULT 1 NOT NULL,
	`criada_em` text NOT NULL,
	`atualizada_em` text NOT NULL,
	CONSTRAINT "tarefa_estado" CHECK("tarefa"."estado" IN ('aberta', 'concluida', 'descartada')),
	CONSTRAINT "tarefa_origem" CHECK("tarefa"."origem" IN ('vendedor', 'agente')),
	CONSTRAINT "tarefa_titulo" CHECK(length("tarefa"."titulo") BETWEEN 1 AND 200),
	CONSTRAINT "tarefa_vence_em" CHECK("tarefa"."vence_em" IS NULL OR (length("tarefa"."vence_em") = 10 AND date("tarefa"."vence_em") IS "tarefa"."vence_em")),
	CONSTRAINT "tarefa_versao" CHECK("tarefa"."versao" >= 1)
);
--> statement-breakpoint
CREATE INDEX `tarefa_por_estado` ON `tarefa` (`estado`,`vence_em`);