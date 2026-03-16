ALTER TABLE `estimate_drafts` ADD `scope_draft_id` int;--> statement-breakpoint
ALTER TABLE `estimate_drafts` ADD CONSTRAINT `idx_ed_scope_draft_unique` UNIQUE(`scope_draft_id`);