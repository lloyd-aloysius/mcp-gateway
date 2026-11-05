CREATE TABLE `endpoint_tool_policies` (
	`endpoint_id` text NOT NULL,
	`backend_server_id` text NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `client_endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_server_id`) REFERENCES `backend_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoint_tool_policies_unique_idx` ON `endpoint_tool_policies` (`endpoint_id`,`backend_server_id`);