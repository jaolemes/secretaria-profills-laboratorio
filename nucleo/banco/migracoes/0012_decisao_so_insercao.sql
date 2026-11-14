-- A decisão é o registro do vendedor: só se anexa.
CREATE TRIGGER `decisao_sem_update` BEFORE UPDATE ON `decisao`
BEGIN
  SELECT RAISE(ABORT, 'decisao só aceita inserção');
END;
--> statement-breakpoint
CREATE TRIGGER `decisao_sem_delete` BEFORE DELETE ON `decisao`
BEGIN
  SELECT RAISE(ABORT, 'decisao só aceita inserção');
END;
