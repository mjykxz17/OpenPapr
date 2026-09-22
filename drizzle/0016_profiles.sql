CREATE TABLE `course_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`canvas_course_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`term` text,
	`state` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_history_user_course` ON `course_history` (`user_id`,`canvas_course_id`);--> statement-breakpoint
CREATE TABLE `module_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` integer NOT NULL,
	`lecturers_json` text,
	`lecturers_at` integer,
	`profile_json` text,
	`inputs_hash` text,
	`generated_at` integer,
	`requested_at` integer,
	`error` text,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_profiles_module` ON `module_profiles` (`module_id`);--> statement-breakpoint
CREATE TABLE `nusmods_modules` (
	`code` text PRIMARY KEY NOT NULL,
	`acad_year` text,
	`json` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nusmods_reviews` (
	`code` text PRIMARY KEY NOT NULL,
	`posts_json` text NOT NULL,
	`count` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`week_start` integer NOT NULL,
	`plan_json` text,
	`inputs_hash` text,
	`generated_at` integer,
	`requested_at` integer,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_plans_user` ON `weekly_plans` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `major` text;--> statement-breakpoint
ALTER TABLE `users` ADD `study_year` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `style_learning` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `writing_style_json` text;--> statement-breakpoint
ALTER TABLE `users` ADD `writing_style_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `writing_style_notes_chars` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_json` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_inputs_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_requested_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_error` text;--> statement-breakpoint
ALTER TABLE `users` ADD `course_history_at` integer;