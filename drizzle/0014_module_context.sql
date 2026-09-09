CREATE TABLE `module_context` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`notes` text,
	`notes_updated_at` integer,
	`profile` text,
	`profiled_at` integer,
	`profile_source` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_context_module` ON `module_context` (`module_id`);