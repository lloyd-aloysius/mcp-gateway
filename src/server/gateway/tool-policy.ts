import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { backendServerTools, endpointToolPolicies, endpointToolRules } from "../db/schema";
import { BUILTIN_GATEWAY_TOOLS_SERVER_KEY } from "./seed-builtin-server";

export async function getToolPolicy(endpointId: string, backendServerId: string, backendKey: string) {
  const [toggles, rules, [policy]] = await Promise.all([
    getDb().select({ toolName: backendServerTools.toolName }).from(backendServerTools)
      .where(and(eq(backendServerTools.backendServerId, backendServerId), eq(backendServerTools.enabled, false))),
    getDb().select().from(endpointToolRules)
      .where(and(eq(endpointToolRules.endpointId, endpointId), eq(endpointToolRules.backendServerId, backendServerId))),
    getDb().select({ mode: endpointToolPolicies.mode }).from(endpointToolPolicies)
      .where(and(eq(endpointToolPolicies.endpointId, endpointId), eq(endpointToolPolicies.backendServerId, backendServerId))).limit(1),
  ]);
  const disabled = new Set(toggles.map((row) => row.toolName));
  if (backendKey === BUILTIN_GATEWAY_TOOLS_SERVER_KEY) disabled.add("add_backend_server");
  const decisions = new Map(rules.map((rule) => [rule.toolName, rule.access]));
  const mode = policy?.mode ?? (rules.some((rule) => rule.access === "allow") ? "allowlist" : "inherit");

  return {
    rules,
    mode,
    denial(toolName: string): string | null {
      if (disabled.has(toolName)) return "Tool disabled";
      if (decisions.get(toolName) === "deny") return "Denied by tool rule";
      if (mode === "allowlist" && decisions.get(toolName) !== "allow") return "Tool is outside the endpoint allowlist";
      return null;
    },
  };
}
