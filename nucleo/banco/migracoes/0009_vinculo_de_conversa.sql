CREATE TABLE `contato_vinculo` (
	`canal` text NOT NULL,
	`chave` text NOT NULL,
	`estado` text NOT NULL,
	`cliente_id` integer,
	`cliente_nome` text,
	`cliente_cidade` text,
	`candidatos` text,
	`motivo` text,
	`conferido_em` text NOT NULL,
	`decidido_em` text,
	PRIMARY KEY(`canal`, `chave`),
	CONSTRAINT "contato_vinculo_canal" CHECK("contato_vinculo"."canal" IN ('whatsapp', 'email')),
	CONSTRAINT "contato_vinculo_estado" CHECK("contato_vinculo"."estado" IN ('auto', 'confirmado', 'ambiguo', 'nao_cliente', 'sem_cliente')),
	CONSTRAINT "contato_vinculo_chave" CHECK("contato_vinculo"."canal" <> 'whatsapp' OR (substr("contato_vinculo"."chave", 1, 1) = '+' AND length("contato_vinculo"."chave") BETWEEN 9 AND 16)),
	CONSTRAINT "contato_vinculo_cliente_id" CHECK("contato_vinculo"."cliente_id" IS NULL OR "contato_vinculo"."cliente_id" >= 1),
	CONSTRAINT "contato_vinculo_cliente" CHECK(("contato_vinculo"."estado" IN ('auto', 'confirmado')) = ("contato_vinculo"."cliente_id" IS NOT NULL AND "contato_vinculo"."cliente_nome" IS NOT NULL) AND ("contato_vinculo"."estado" IN ('auto', 'confirmado') OR ("contato_vinculo"."cliente_id" IS NULL AND "contato_vinculo"."cliente_nome" IS NULL AND "contato_vinculo"."cliente_cidade" IS NULL))),
	CONSTRAINT "contato_vinculo_candidatos" CHECK(CASE WHEN "contato_vinculo"."estado" IN ('ambiguo', 'nao_cliente') THEN "contato_vinculo"."motivo" IN ('varios_clientes', 'variante_do_9', 'sem_prova_do_telefone', 'desfeito_pelo_vendedor') AND "contato_vinculo"."candidatos" IS NOT NULL AND CASE WHEN json_valid("contato_vinculo"."candidatos") THEN json_type("contato_vinculo"."candidatos") = 'array' AND json_array_length("contato_vinculo"."candidatos") >= 1 ELSE 0 END ELSE "contato_vinculo"."motivo" IS NULL AND "contato_vinculo"."candidatos" IS NULL END),
	CONSTRAINT "contato_vinculo_decidido" CHECK(("contato_vinculo"."estado" IN ('confirmado', 'nao_cliente')) = ("contato_vinculo"."decidido_em" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `conversa_ignorada` (
	`canal` text NOT NULL,
	`chave` text NOT NULL,
	`ate` text NOT NULL,
	`criado_em` text NOT NULL,
	`quem` text NOT NULL,
	`motivo` text,
	`nome` text NOT NULL,
	PRIMARY KEY(`canal`, `chave`),
	CONSTRAINT "conversa_ignorada_canal" CHECK("conversa_ignorada"."canal" IN ('whatsapp', 'email')),
	CONSTRAINT "conversa_ignorada_ate" CHECK(length("conversa_ignorada"."ate") = 10 AND date("conversa_ignorada"."ate") IS "conversa_ignorada"."ate"),
	CONSTRAINT "conversa_ignorada_quem" CHECK("conversa_ignorada"."quem" IN ('vendedor', 'agente')),
	CONSTRAINT "conversa_ignorada_motivo" CHECK("conversa_ignorada"."motivo" IS NULL OR length("conversa_ignorada"."motivo") BETWEEN 5 AND 300),
	CONSTRAINT "conversa_ignorada_motivo_do_agente" CHECK("conversa_ignorada"."quem" = 'vendedor' OR "conversa_ignorada"."motivo" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `conversas_cache` (
	`chave` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`lido_em` text NOT NULL,
	CONSTRAINT "conversas_cache_chave" CHECK("conversas_cache"."chave" = 'atual'),
	CONSTRAINT "conversas_cache_json" CHECK(json_valid("conversas_cache"."json"))
);
