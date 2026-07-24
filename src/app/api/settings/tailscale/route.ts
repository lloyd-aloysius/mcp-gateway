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
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
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

export async function GET() {
  return NextResponse.json(await getStatus());
}

export async function POST() {
  try {
    await execFileAsync("tailscale", ["up"]);
  } catch {
    // fall through — report current status either way
  }
  return NextResponse.json(await getStatus());
}
