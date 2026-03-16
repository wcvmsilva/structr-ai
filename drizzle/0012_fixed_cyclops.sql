CREATE TABLE `scope_draft_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope_draft_id` int NOT NULL,
	`assembly_id` int NOT NULL,
	`quantity` decimal(10,4) NOT NULL,
	`unit` varchar(30) NOT NULL DEFAULT 'EA',
	`reason` text NOT NULL,
	`confidence` decimal(5,2) NOT NULL DEFAULT '1.00',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scope_draft_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scope_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`intake_form_id` int NOT NULL,
	`status` enum('draft','reviewed','approved','converted') NOT NULL DEFAULT 'draft',
	`confidence_score` decimal(5,2),
	`warnings_json` json,
	`created_by` int,
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scope_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scope_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rule_code` varchar(80) NOT NULL,
	`service_type` varchar(128) NOT NULL,
	`project_type` enum('remodel','new_construction','repair','insurance_restoration','commercial_buildout','addition','exterior'),
	`channel` enum('direct','insurance','commercial','residential'),
	`zone` varchar(128),
	`finish_level` enum('standard','premium','luxury'),
	`condition_json` json,
	`assembly_id` int NOT NULL,
	`quantity_formula` varchar(255) NOT NULL,
	`reason_template` varchar(512) NOT NULL,
	`priority` int NOT NULL DEFAULT 100,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scope_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `scope_rules_rule_code_unique` UNIQUE(`rule_code`)
);
--> statement-breakpoint
CREATE INDEX `idx_sdi_draft` ON `scope_draft_items` (`scope_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_sdi_assembly` ON `scope_draft_items` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_sdi_sort` ON `scope_draft_items` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_sd_project` ON `scope_drafts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_sd_intake` ON `scope_drafts` (`intake_form_id`);--> statement-breakpoint
CREATE INDEX `idx_sd_status` ON `scope_drafts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sr_service_type` ON `scope_rules` (`service_type`);--> statement-breakpoint
CREATE INDEX `idx_sr_project_type` ON `scope_rules` (`project_type`);--> statement-breakpoint
CREATE INDEX `idx_sr_channel` ON `scope_rules` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_sr_zone` ON `scope_rules` (`zone`);--> statement-breakpoint
CREATE INDEX `idx_sr_finish` ON `scope_rules` (`finish_level`);--> statement-breakpoint
CREATE INDEX `idx_sr_active` ON `scope_rules` (`active`);--> statement-breakpoint
CREATE INDEX `idx_sr_priority` ON `scope_rules` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_sr_assembly` ON `scope_rules` (`assembly_id`);