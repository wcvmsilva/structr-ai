CREATE TABLE `assembly_performance_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assembly_id` int NOT NULL,
	`assembly_name` varchar(255),
	`project_count` int NOT NULL DEFAULT 0,
	`avg_estimated_qty` decimal(12,4) DEFAULT '0',
	`avg_actual_qty` decimal(12,4) DEFAULT '0',
	`avg_estimated_cost` decimal(14,2) DEFAULT '0',
	`avg_actual_cost` decimal(14,2) DEFAULT '0',
	`avg_variance_pct` decimal(8,2) DEFAULT '0',
	`total_estimated_cost` decimal(16,2) DEFAULT '0',
	`total_actual_cost` decimal(16,2) DEFAULT '0',
	`overrun_count` int NOT NULL DEFAULT 0,
	`underrun_count` int NOT NULL DEFAULT 0,
	`high_variance_count` int NOT NULL DEFAULT 0,
	`last_updated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assembly_performance_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calibration_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assembly_id` int NOT NULL,
	`assembly_name` varchar(255),
	`suggested_waste_factor` decimal(6,4),
	`suggested_labor_multiplier` decimal(6,4),
	`suggested_material_multiplier` decimal(6,4),
	`current_waste_factor` decimal(6,4),
	`current_labor_multiplier` decimal(6,4),
	`current_material_multiplier` decimal(6,4),
	`confidence_score` decimal(5,2) NOT NULL,
	`sample_size` int NOT NULL DEFAULT 0,
	`avg_variance_pct` decimal(8,2),
	`rationale` text,
	`status` enum('pending','reviewed','accepted','rejected') NOT NULL DEFAULT 'pending',
	`reviewed_by` int,
	`reviewed_at` timestamp,
	`review_notes` text,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `calibration_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `estimate_variance_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`estimate_id` int NOT NULL,
	`assembly_id` int NOT NULL,
	`assembly_name` varchar(255),
	`estimated_cost` decimal(14,2) NOT NULL,
	`actual_cost` decimal(14,2) NOT NULL,
	`variance_pct` decimal(8,2) NOT NULL,
	`variance_amount` decimal(14,2) NOT NULL,
	`variance_type` enum('labor_variance','material_variance','waste_variance','scope_variance') NOT NULL,
	`variance_direction` enum('overrun','underrun') NOT NULL DEFAULT 'overrun',
	`trade` varchar(128),
	`region` varchar(128),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `estimate_variance_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_apm_assembly` ON `assembly_performance_metrics` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_apm_variance` ON `assembly_performance_metrics` (`avg_variance_pct`);--> statement-breakpoint
CREATE INDEX `idx_apm_overrun` ON `assembly_performance_metrics` (`overrun_count`);--> statement-breakpoint
CREATE INDEX `idx_apm_underrun` ON `assembly_performance_metrics` (`underrun_count`);--> statement-breakpoint
CREATE INDEX `idx_cs_assembly` ON `calibration_suggestions` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_cs_status` ON `calibration_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cs_confidence` ON `calibration_suggestions` (`confidence_score`);--> statement-breakpoint
CREATE INDEX `idx_cs_generated` ON `calibration_suggestions` (`generated_at`);--> statement-breakpoint
CREATE INDEX `idx_eve_project` ON `estimate_variance_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_eve_estimate` ON `estimate_variance_events` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `idx_eve_assembly` ON `estimate_variance_events` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_eve_type` ON `estimate_variance_events` (`variance_type`);--> statement-breakpoint
CREATE INDEX `idx_eve_direction` ON `estimate_variance_events` (`variance_direction`);--> statement-breakpoint
CREATE INDEX `idx_eve_created` ON `estimate_variance_events` (`created_at`);