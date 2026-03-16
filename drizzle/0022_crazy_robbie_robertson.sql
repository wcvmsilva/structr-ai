ALTER TABLE `estimate_drafts` MODIFY COLUMN `status` enum('draft','sent_to_estimate','converted','archived','approved','rejected') NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `approved_by` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `approved_at` timestamp;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `rejected_by` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `rejected_at` timestamp;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD `rejection_reason` text;