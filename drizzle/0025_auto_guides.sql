CREATE TABLE `guide_plans` (
	`module_id` integer PRIMARY KEY NOT NULL,
	`title` text,
	`input_hash` text,
	`planned_at` integer,
	`error` text,
	`error_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `guide_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`ord` integer NOT NULL,
	`lecture_ids_json` text DEFAULT '[]' NOT NULL,
	`practice_ids_json` text DEFAULT '[]' NOT NULL,
	`item_ids_json` text DEFAULT '[]' NOT NULL,
	`note_ids_json` text DEFAULT '[]' NOT NULL,
	`input_hash` text NOT NULL,
	`built_hash` text,
	`body` text,
	`built_at` integer,
	`stage` text,
	`error` text,
	`error_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guide_topics_module_key` ON `guide_topics` (`module_id`,`key`);--> statement-breakpoint
ALTER TABLE `files` ADD `text_sig_json` text;