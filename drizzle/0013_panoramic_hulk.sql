ALTER TABLE `scope_rules` MODIFY COLUMN `channel` enum('direct','insurance','commercial');--> statement-breakpoint
ALTER TABLE `scope_rules` ADD `scope_variant` varchar(128);--> statement-breakpoint
CREATE INDEX `idx_sr_scope_variant` ON `scope_rules` (`scope_variant`);