-- The home screen was rearranged so each fact appears once (Today, Coming up,
-- Modules). Saved layouts predate that and would keep the old repeats, so
-- everyone starts from the new default; Edit home can bring widgets back.
UPDATE `users` SET `home_layout_json` = NULL;
