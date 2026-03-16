CREATE TABLE `geo_zones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zone_name` varchar(160) NOT NULL,
	`county` varchar(128),
	`zip_codes` json,
	`center_lat` decimal(10,7),
	`center_lng` decimal(10,7),
	`radius_miles` decimal(6,2) DEFAULT '15.00',
	`coastal_exposure_level` enum('none','low','moderate','high','extreme') NOT NULL DEFAULT 'none',
	`logistics_complexity` enum('standard','moderate','complex','extreme') NOT NULL DEFAULT 'standard',
	`labor_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`logistics_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`material_modifier` decimal(6,4) NOT NULL DEFAULT '1.0000',
	`contingency_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
	`min_profit_shield_pct` decimal(5,2) NOT NULL DEFAULT '35.00',
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `geo_zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `geo_zones_zone_name_unique` UNIQUE(`zone_name`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `zone_modifier_snapshot` json;--> statement-breakpoint
CREATE INDEX `idx_gz_coastal` ON `geo_zones` (`coastal_exposure_level`);--> statement-breakpoint
CREATE INDEX `idx_gz_active` ON `geo_zones` (`is_active`);