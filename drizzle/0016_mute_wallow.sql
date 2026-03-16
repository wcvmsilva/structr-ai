CREATE TABLE `geographic_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zone` varchar(100) NOT NULL,
	`trade` varchar(80) NOT NULL,
	`finish_level` varchar(50),
	`original_assembly_id` int NOT NULL,
	`replacement_assembly_id` int NOT NULL,
	`override_type` enum('swap','add','warning_only') NOT NULL,
	`reason_template` text NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `geographic_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scope_override_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope_draft_id` int NOT NULL,
	`original_assembly_id` int NOT NULL,
	`replacement_assembly_id` int NOT NULL,
	`zone` varchar(100) NOT NULL,
	`override_type` enum('swap','add','warning_only') NOT NULL,
	`override_reason` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scope_override_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_go_zone` ON `geographic_overrides` (`zone`);--> statement-breakpoint
CREATE INDEX `idx_go_trade` ON `geographic_overrides` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_go_original` ON `geographic_overrides` (`original_assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_go_replacement` ON `geographic_overrides` (`replacement_assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_go_active` ON `geographic_overrides` (`active`);--> statement-breakpoint
CREATE INDEX `idx_go_zone_trade` ON `geographic_overrides` (`zone`,`trade`);--> statement-breakpoint
CREATE INDEX `idx_sol_draft` ON `scope_override_log` (`scope_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_sol_original` ON `scope_override_log` (`original_assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_sol_replacement` ON `scope_override_log` (`replacement_assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_sol_draft_original_replacement` ON `scope_override_log` (`scope_draft_id`,`original_assembly_id`,`replacement_assembly_id`);