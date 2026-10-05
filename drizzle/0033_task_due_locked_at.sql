ALTER TABLE `tasks` ADD `due_locked_at` integer;--> statement-breakpoint
UPDATE `tasks` SET `due_locked_at` = `touched_at` WHERE `due_locked` = 1;
