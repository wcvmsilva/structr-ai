CREATE TABLE `catalog_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`costItemId` varchar(64),
	`costGroupName` varchar(255) NOT NULL,
	`costItemName` varchar(512) NOT NULL,
	`description` text,
	`unit` varchar(32) NOT NULL,
	`unitCost` decimal(12,2) NOT NULL,
	`unitPrice` decimal(12,2) NOT NULL,
	`margin` varchar(16) DEFAULT '35%',
	`costCode` varchar(16) NOT NULL,
	`costType` varchar(64),
	`taxable` boolean DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_items_id` PRIMARY KEY(`id`)
);
