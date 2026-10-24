ALTER TABLE `users` ADD `mcp_token_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mcp_token_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_mcp_token` ON `users` (`mcp_token_hash`);