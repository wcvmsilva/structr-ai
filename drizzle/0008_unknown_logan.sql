ALTER TABLE `estimate_drafts` MODIFY COLUMN `bundleId` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` MODIFY COLUMN `discountApplied` decimal(5,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `estimate_drafts` MODIFY COLUMN `discountAmount` decimal(14,2) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `region` varchar(80);--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `finish_level` enum('standard','premium','luxury') DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `project_id` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `client_id` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `assembly_selections` json;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `assembly_count` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `profit_shield_passed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `profit_shield_min_pct` decimal(5,2) DEFAULT '35.00';--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `source` enum('legacy_bundle','assembly_calculator') DEFAULT 'legacy_bundle';--> statement-breakpoint
CREATE INDEX `idx_ed_region` ON `estimate_drafts` (`region`);--> statement-breakpoint
CREATE INDEX `idx_ed_source` ON `estimate_drafts` (`source`);--> statement-breakpoint
CREATE INDEX `idx_ed_project` ON `estimate_drafts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_ed_created_by` ON `estimate_drafts` (`createdBy`);