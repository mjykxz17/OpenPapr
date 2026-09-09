ALTER TABLE `module_context` ADD `profile_deck_key` text;--> statement-breakpoint
ALTER TABLE `module_context` ADD `profile_checked_at` integer;--> statement-breakpoint
ALTER TABLE `module_context` ADD `profile_attempts` integer DEFAULT 0 NOT NULL;