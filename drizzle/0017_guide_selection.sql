ALTER TABLE `guide_runs` ADD `file_ids_json` text;--> statement-breakpoint
ALTER TABLE `guide_runs` ADD `mode` text DEFAULT 'replace' NOT NULL;