ALTER TABLE `users` ADD `canvas_user_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_sync_started_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_canvas_user` ON `users` (`canvas_user_id`);