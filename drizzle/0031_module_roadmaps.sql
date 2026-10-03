CREATE TABLE `module_roadmaps` (
	`module_id` integer PRIMARY KEY NOT NULL,
	`items_json` text DEFAULT '[]' NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`inputs_hash` text,
	`generated_at` integer,
	`error` text,
	`error_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE no action
);
