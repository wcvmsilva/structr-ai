CREATE TABLE `channel_multipliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`channel` enum('direct','insurance','commercial') NOT NULL,
	`trade` varchar(80),
	`cost_multiplier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`price_multiplier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `channel_multipliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finish_levels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` enum('standard','premium','luxury') NOT NULL,
	`trade` varchar(80),
	`price_multiplier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finish_levels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `newcon_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`structure_type` enum('adu','one_story','two_story','two_story_terrace','shell') NOT NULL,
	`description` text,
	`parametric_model_id` int,
	`default_parameters` json NOT NULL,
	`default_systems` json,
	`default_options` json,
	`mep_packages` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `newcon_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `parametric_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`structure_type` enum('adu','one_story','two_story','two_story_terrace','shell') NOT NULL,
	`base_cost_per_sqft` decimal(10,4) NOT NULL,
	`base_price_per_sqft` decimal(10,4) NOT NULL,
	`min_sqft` int DEFAULT 400,
	`max_sqft` int DEFAULT 5000,
	`complexity_multiplier` decimal(6,4) DEFAULT '1.0000',
	`default_systems` json,
	`default_options` json,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `parametric_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `regional_modifiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`region_code` varchar(80) NOT NULL,
	`region_name` varchar(160) NOT NULL,
	`cost_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`labor_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`material_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`permit_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `regional_modifiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `regional_modifiers_region_code_unique` UNIQUE(`region_code`)
);
--> statement-breakpoint
CREATE TABLE `remodel_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`service_type` enum('kitchen_remodel','bathroom_remodel','roof_replacement','siding_replacement','window_replacement','deck_build','exterior_paint','interior_paint','flooring') NOT NULL,
	`description` text,
	`default_assemblies` json,
	`default_options` json,
	`typical_sqft_range` json,
	`estimated_duration` varchar(80),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `remodel_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `assemblies` ADD `assembly_type` enum('scope','system','package','parametric') DEFAULT 'scope' NOT NULL;--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `item_type` enum('material','labor','subcontract','permit_fee','equipment','allowance') DEFAULT 'material';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `trade` varchar(80);--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `finish_level` enum('standard','premium','luxury') DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `channel` enum('direct','insurance','commercial') DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `region` varchar(80) DEFAULT 'charleston_metro';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `waste_factor` decimal(6,4) DEFAULT '1.0000';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `coastal_modifier` decimal(6,4) DEFAULT '1.0000';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `channel_multiplier` decimal(6,4) DEFAULT '1.0000';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `source` varchar(80) DEFAULT 'jobtread_csv';--> statement-breakpoint
ALTER TABLE `price_book_items` ADD `effective_date` timestamp;--> statement-breakpoint
CREATE INDEX `idx_cm_channel` ON `channel_multipliers` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_cm_trade` ON `channel_multipliers` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_fl_level` ON `finish_levels` (`level`);--> statement-breakpoint
CREATE INDEX `idx_fl_trade` ON `finish_levels` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_nt_type` ON `newcon_templates` (`structure_type`);--> statement-breakpoint
CREATE INDEX `idx_pm_type` ON `parametric_models` (`structure_type`);--> statement-breakpoint
CREATE INDEX `idx_rt_service` ON `remodel_templates` (`service_type`);--> statement-breakpoint
CREATE INDEX `idx_pbi_trade` ON `price_book_items` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_pbi_item_type` ON `price_book_items` (`item_type`);--> statement-breakpoint
CREATE INDEX `idx_pbi_finish` ON `price_book_items` (`finish_level`);--> statement-breakpoint
CREATE INDEX `idx_pbi_channel` ON `price_book_items` (`channel`);