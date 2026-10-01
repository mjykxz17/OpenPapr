CREATE TABLE `guide_quizzes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`chapter_hash` text NOT NULL,
	`questions_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guide_quizzes_chapter` ON `guide_quizzes` (`module_id`,`chapter_hash`);--> statement-breakpoint
CREATE TABLE `llm_usage` (
	`user_id` integer NOT NULL,
	`month` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`shared_calls` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_usage_user_month` ON `llm_usage` (`user_id`,`month`);--> statement-breakpoint
CREATE TABLE `task_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_feedback_module` ON `task_feedback` (`user_id`,`module_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `due_locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `calendar_token` text;