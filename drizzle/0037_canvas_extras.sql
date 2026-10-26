CREATE TABLE `canvas_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`conversation_id` integer NOT NULL,
	`last_message_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_conversations_user_conv` ON `canvas_conversations` (`user_id`,`conversation_id`);--> statement-breakpoint
CREATE TABLE `canvas_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer,
	`conversation_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`course_name` text,
	`subject` text,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_messages_user_message` ON `canvas_messages` (`user_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `canvas_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`page_url` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` text,
	`seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_pages_module_page` ON `canvas_pages` (`module_id`,`page_url`);--> statement-breakpoint
CREATE TABLE `mail_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`graph_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`path` text,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_attachments_item_graph` ON `mail_attachments` (`item_id`,`graph_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `grade_json` text;--> statement-breakpoint
ALTER TABLE `modules` ADD `outline_json` text;