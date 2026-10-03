ALTER TABLE `tasks` ADD `title_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `started_at` integer;