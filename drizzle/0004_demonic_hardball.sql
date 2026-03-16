CREATE TABLE `estimate_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bundleId` int NOT NULL,
	`bundleName` varchar(255) NOT NULL,
	`channel` enum('residential','commercial','insurance') DEFAULT 'residential',
	`lineItems` json NOT NULL,
	`subtotalCost` decimal(14,2) NOT NULL,
	`subtotalPrice` decimal(14,2) NOT NULL,
	`grossProfit` decimal(14,2) NOT NULL,
	`grossProfitPct` decimal(5,2) NOT NULL,
	`discountApplied` decimal(5,2) NOT NULL,
	`discountAmount` decimal(14,2) NOT NULL,
	`finalTotalPrice` decimal(14,2) NOT NULL,
	`notes` text,
	`metadata` json,
	`status` enum('draft','sent_to_estimate','converted','archived') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `estimate_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bundles` ADD `presetCategory` varchar(128);--> statement-breakpoint
ALTER TABLE `bundles` ADD `presetTags` json;