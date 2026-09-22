ALTER TABLE `users` ADD `canvas_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `canvas_token_failed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_base_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_model` text;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_key_enc` text;