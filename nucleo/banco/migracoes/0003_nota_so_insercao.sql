-- A nota é o histórico da tarefa: só se anexa.
CREATE TRIGGER `nota_sem_update` BEFORE UPDATE ON `nota`
BEGIN
  SELECT RAISE(ABORT, 'nota só aceita inserção');
END;
--> statement-breakpoint
CREATE TRIGGER `nota_sem_delete` BEFORE DELETE ON `nota`
BEGIN
  SELECT RAISE(ABORT, 'nota só aceita inserção');
END;
