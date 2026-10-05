CREATE TABLE `task_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer,
	`task_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`old_due_at` integer,
	`new_due_at` integer,
	`new_confidence` text,
	`source_item_id` integer,
	`source_label` text,
	`quote` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_changes_user` ON `task_changes` (`user_id`,`status`);