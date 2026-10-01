ALTER TABLE `users` ADD `onboarded_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `demo_reset_at` integer;--> statement-breakpoint
-- Everyone who signed up before the welcome steps existed has already set up.
UPDATE `users` SET `onboarded_at` = `created_at` WHERE `onboarded_at` IS NULL;
