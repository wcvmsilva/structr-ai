CREATE TABLE `scope_review_deltas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope_draft_id` int NOT NULL,
	`assembly_id` int NOT NULL,
	`action_type` enum('remove','quantity_adjustment') NOT NULL,
	`previous_quantity` decimal(10,4) NOT NULL,
	`new_quantity` decimal(10,4),
	`operator_reason` text,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scope_review_deltas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scope_review_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope_draft_id` int NOT NULL,
	`approved_items` json NOT NULL,
	`delta_changes` json NOT NULL,
	`warnings` json,
	`confidence_score` decimal(5,2),
	`operator_id` int NOT NULL,
	`bundle_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scope_review_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `scope_drafts` MODIFY COLUMN `status` enum('draft','under_review','approved','rejected','converted') NOT NULL DEFAULT 'draft';--> statement-breakpoint
CREATE INDEX `idx_srd_draft` ON `scope_review_deltas` (`scope_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_srd_assembly` ON `scope_review_deltas` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_srd_action` ON `scope_review_deltas` (`action_type`);--> statement-breakpoint
CREATE INDEX `idx_srs_draft` ON `scope_review_snapshots` (`scope_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_srs_operator` ON `scope_review_snapshots` (`operator_id`);--> statement-breakpoint
CREATE INDEX `idx_srs_bundle` ON `scope_review_snapshots` (`bundle_id`);