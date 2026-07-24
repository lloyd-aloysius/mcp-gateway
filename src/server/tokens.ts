import { randomBytes, createHash } from "node:crypto";

const TOKEN_BYTES = 32;
const PREFIX_LENGTH = 8;

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `gwy_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, PREFIX_LENGTH),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
