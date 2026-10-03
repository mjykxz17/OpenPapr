ALTER TABLE `modules` ADD `seen_at` integer;--> statement-breakpoint
-- The home cards counted every announcement and forum reply since the
-- account was made, because nothing recorded a visit. Start everyone from
-- now: opening a module from here on marks it seen.
UPDATE `modules` SET `seen_at` = CAST(strftime('%s','now') AS INTEGER) * 1000;
