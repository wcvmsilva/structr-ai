ALTER TABLE `bundle_items` MODIFY COLUMN `quantity` decimal(10,2) NOT NULL DEFAULT '1';--> statement-breakpoint
ALTER TABLE `bundle_items` ADD `catalogItemId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD `unitCostSnapshot` decimal(12,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD `unitPriceSnapshot` decimal(12,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD `lineTotalCost` decimal(14,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `bundle_items` ADD `lineTotalPrice` decimal(14,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `bundles` ADD `totalCost` decimal(14,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `bundles` ADD `totalPrice` decimal(14,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `bundles` ADD `itemCount` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `bundle_items` DROP COLUMN `assemblyId`;--> statement-breakpoint
ALTER TABLE `bundle_items` DROP COLUMN `isOptional`;