import type { ClientEndpoint } from "../db/schema";

export function toPublicEndpoint(row: ClientEndpoint): Omit<ClientEndpoint, "tokenHash"> {
  const rest: Partial<ClientEndpoint> = { ...row };
  delete rest.tokenHash;
  return rest as Omit<ClientEndpoint, "tokenHash">;
}
