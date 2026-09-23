ALTER TABLE `users` ADD `llm_rpm` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_fallback_base_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_fallback_model` text;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_fallback_key_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `llm_fallback_rpm` integer;