CREATE TABLE `project_actuals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`estimate_draft_id` int,
	`assembly_id` int,
	`assembly_name` varchar(255),
	`line_item_description` varchar(512),
	`unit` varchar(32),
	`estimated_qty` decimal(12,4),
	`actual_qty` decimal(12,4),
	`estimated_unit_cost` decimal(12,4),
	`actual_unit_cost` decimal(12,4),
	`estimated_total_cost` decimal(14,2),
	`actual_total_cost` decimal(14,2),
	`variance_pct` decimal(8,2),
	`variance_reason` text,
	`trade` varchar(128),
	`category` varchar(128),
	`region` varchar(128),
	`pricing_schema_version` varchar(10),
	`recorded_by` int,
	`recorded_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_actuals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pa_project` ON `project_actuals` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_pa_estimate` ON `project_actuals` (`estimate_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_pa_assembly` ON `project_actuals` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_pa_trade` ON `project_actuals` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_pa_region` ON `project_actuals` (`region`);--> statement-breakpoint
CREATE INDEX `idx_pa_recorded_at` ON `project_actuals` (`recorded_at`);