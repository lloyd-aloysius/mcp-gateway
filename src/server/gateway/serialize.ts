import { isOAuthEndpoint } from "./oauth";
import type { ClientEndpoint } from "../db/schema";

export function toPublicEndpoint(row: ClientEndpoint) {
  const { tokenHash: _tokenHash, ...rest } = row;
  return { ...rest, authMode: isOAuthEndpoint(row.slug) ? "oauth" as const : "bearer" as const };
}
