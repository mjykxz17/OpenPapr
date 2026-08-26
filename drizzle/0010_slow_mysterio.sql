CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`canvas_file_id` integer NOT NULL,
	`display_name` text NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`hidden` integer DEFAULT false NOT NULL,
	`discovered_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_module_canvas_file` ON `files` (`module_id`,`canvas_file_id`);