CREATE TABLE `endpoint_tool_rules` (
	`endpoint_id` text NOT NULL,
	`backend_server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`access` text NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `client_endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_server_id`) REFERENCES `backend_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoint_tool_rules_unique_idx` ON `endpoint_tool_rules` (`endpoint_id`,`backend_server_id`,`tool_name`);