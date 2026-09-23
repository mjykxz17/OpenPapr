CREATE INDEX `sync_runs_user_source` ON `sync_runs` (`user_id`,`source`,`id`);--> statement-breakpoint
CREATE INDEX `sync_runs_started` ON `sync_runs` (`started_at`);