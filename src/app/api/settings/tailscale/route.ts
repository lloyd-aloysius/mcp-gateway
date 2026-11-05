import { withAdmin } from "@/server/http/admin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

type TailscaleStatus = {
  connected: boolean;
  hostname?: string;
  ip?: string;
};

async function getStatus(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], { timeout: 1500, maxBuffer: 256 * 1024 });
    const parsed = JSON.parse(stdout) as {
      Self?: { DNSName?: string; TailscaleIPs?: string[]; Online?: boolean };
    };
    const self = parsed.Self;
    if (!self || self.Online === false) return { connected: false };
    return {
      connected: true,
      hostname: self.DNSName?.replace(/\.$/, ""),
      ip: self.TailscaleIPs?.[0],
    };
  } catch {
    return { connected: false };
  }
}

function clientOrigin(): string | undefined {
  const value = process.env.MCP_GATEWAY_PUBLIC_MCP_ORIGIN ?? process.env.MCP_GATEWAY_OAUTH_RESOURCE_ORIGIN;
  try {
    const url = new URL(value ?? "");
    if (!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash &&
        ["https:", "http:"].includes(url.protocol)) return url.origin;
  } catch {
    // The browser falls back to its current origin for a local installation.
  }
}

export const GET = withAdmin(async () => NextResponse.json({ ...await getStatus(), clientOrigin: clientOrigin() }));
