CREATE TABLE `canvas_page_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`page_url` text NOT NULL,
	`updated_at` text,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_page_cache_page` ON `canvas_page_cache` (`course_id`,`page_url`);--> statement-breakpoint
CREATE TABLE `guide_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`topic_key` text NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guide_progress_topic` ON `guide_progress` (`user_id`,`module_id`,`topic_key`);--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`chapter_hash` text NOT NULL,
	`topic_title` text,
	`question` integer NOT NULL,
	`chosen` integer NOT NULL,
	`correct` integer NOT NULL,
	`deck` text,
	`page` integer,
	`answered_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_user` ON `quiz_attempts` (`user_id`,`module_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_attempts_answer` ON `quiz_attempts` (`user_id`,`module_id`,`chapter_hash`,`question`);--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `failed_logins` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` integer;