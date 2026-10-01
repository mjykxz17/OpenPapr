CREATE TABLE `passages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`kind` text NOT NULL,
	`source_key` text NOT NULL,
	`version` text,
	`file_id` integer,
	`deck` text,
	`page` integer,
	`item_id` integer,
	`anchor` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`hash` text NOT NULL,
	`embedding` blob,
	`embed_model` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passages_source` ON `passages` (`module_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `passages_user` ON `passages` (`user_id`,`module_id`);