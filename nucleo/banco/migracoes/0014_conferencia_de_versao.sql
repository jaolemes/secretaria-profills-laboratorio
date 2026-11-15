CREATE TABLE `conferencia_de_versao` (
	`id` integer PRIMARY KEY NOT NULL,
	`em` text NOT NULL,
	`resultado` text NOT NULL,
	CONSTRAINT "conferencia_de_versao_unica" CHECK("conferencia_de_versao"."id" = 1),
	CONSTRAINT "conferencia_de_versao_resultado_json" CHECK(json_valid("conferencia_de_versao"."resultado"))
);
