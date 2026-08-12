CREATE TABLE `components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`name` text NOT NULL,
	`weight_pct` real,
	`score_pct` real,
	`source` text NOT NULL,
	`evidence` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `components_module_name_source` ON `components` (`module_id`,`name`,`source`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`url` text,
	`sender` text,
	`due_at` integer,
	`source_created_at` integer,
	`first_seen_at` integer NOT NULL,
	`submitted` integer DEFAULT false NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`triage` text,
	`importance` real,
	`importance_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_user_source` ON `items` (`user_id`,`source`,`source_id`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`canvas_course_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`term` text,
	`active` integer DEFAULT true NOT NULL,
	`syllabus_body` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modules_user_course` ON `modules` (`user_id`,`canvas_course_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ok` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`canvas_token_enc` text,
	`ms_refresh_token_enc` text,
	`ms_delta_link` text,
	`last_seen_at` integer DEFAULT 0 NOT NULL
);
