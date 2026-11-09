import { z } from "zod";
import { CLIENT_ICON_IDS } from "./client-identity";

export const backendServerInputSchema = z.discriminatedUnion("connectionType", [
  z.object({
    connectionType: z.literal("stdio"),
    key: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, "letters, numbers, hyphens only"),
    name: z.string().min(1),
    description: z.string().optional(),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true),
  }),
  z.object({
    connectionType: z.enum(["http", "sse"]),
    key: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, "letters, numbers, hyphens only"),
    name: z.string().min(1),
    description: z.string().optional(),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true),
  }),
]);

export type BackendServerInput = z.infer<typeof backendServerInputSchema>;

export const backendServerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string().nullable()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string().nullable()).optional(),
  enabled: z.boolean().optional(),
});

export const clientEndpointInputSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  defaultPolicy: z.enum(["allow_all", "deny_all"]).default("deny_all"),
  enabled: z.boolean().default(true),
});

export const clientEndpointUpdateSchema = clientEndpointInputSchema
  .pick({ name: true, slug: true })
  .partial()
  .extend({
    defaultPolicy: z.enum(["allow_all", "deny_all"]).optional(),
    enabled: z.boolean().optional(),
  });

export type ClientEndpointInput = z.infer<typeof clientEndpointInputSchema>;

export const endpointRuleInputSchema = z.object({
  backendServerId: z.string().min(1),
  access: z.enum(["allow", "deny", "inherit"]),
});

export const toolToggleInputSchema = z.object({
  toolName: z.string().min(1),
  enabled: z.boolean(),
});

export const createEndpointClientSchema = z.object({
  clientId: z.string().trim().min(1).max(128).regex(/^[\x20-\x7e]+$/, "Use a printable ASCII client ID"),
  label: z.string().trim().max(120).nullable().optional(),
  icon: z.enum(CLIENT_ICON_IDS).default("auto"),
}).strict();
