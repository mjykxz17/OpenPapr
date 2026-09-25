ALTER TABLE `items` ADD `meta_json` text;--> statement-breakpoint
ALTER TABLE `items` ADD `missing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `canvas_done` integer DEFAULT false NOT NULL;