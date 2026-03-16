ALTER TABLE `assemblies` ADD `subcategory` varchar(128);--> statement-breakpoint
ALTER TABLE `assemblies` ADD `finish_level` enum('standard','premium','luxury') DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `assemblies` ADD `region` varchar(80) DEFAULT 'charleston_metro';--> statement-breakpoint
ALTER TABLE `assemblies` ADD `coastal_modifier` decimal(6,4) DEFAULT '1.0000';--> statement-breakpoint
ALTER TABLE `assemblies` ADD `trade_sequence_order` int DEFAULT 100;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `inclusions` text;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `exclusions` text;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `hidden_condition_flag` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `parent_assembly_id` int;--> statement-breakpoint
ALTER TABLE `assembly_components` ADD `component_type` enum('material','labor','subcontract','equipment','permit','admin') DEFAULT 'material';--> statement-breakpoint
ALTER TABLE `assembly_components` ADD `unit` varchar(30);--> statement-breakpoint
ALTER TABLE `assembly_components` ADD `notes` text;--> statement-breakpoint
CREATE INDEX `idx_assemblies_category` ON `assemblies` (`category`);--> statement-breakpoint
CREATE INDEX `idx_assemblies_parent` ON `assemblies` (`parent_assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_assemblies_finish` ON `assemblies` (`finish_level`);--> statement-breakpoint
CREATE INDEX `idx_assemblies_type` ON `assemblies` (`assembly_type`);--> statement-breakpoint
CREATE INDEX `idx_ac_type` ON `assembly_components` (`component_type`);