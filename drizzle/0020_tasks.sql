CREATE TABLE `file_hints` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`hints_json` text NOT NULL,
	`extracted_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_plans` (
	`module_id` integer PRIMARY KEY NOT NULL,
	`inputs_hash` text,
	`generated_at` integer,
	`error` text,
	`error_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`due_at` integer,
	`due_confidence` text DEFAULT 'exact' NOT NULL,
	`anticipated` integer DEFAULT false NOT NULL,
	`weight_pct` real,
	`why` text,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`touched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_user_key` ON `tasks` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `tasks_requested_at` integer;