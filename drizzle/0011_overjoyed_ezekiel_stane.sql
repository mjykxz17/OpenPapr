CREATE TABLE `guide_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`ok` integer,
	`error` text,
	`stage` text,
	`decks_total` integer DEFAULT 0 NOT NULL,
	`decks_done` integer DEFAULT 0 NOT NULL,
	`sections_total` integer DEFAULT 0 NOT NULL,
	`sections_done` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
