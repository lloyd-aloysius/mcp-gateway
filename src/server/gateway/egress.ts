import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

function publicIp(address: string): boolean {
  return ipaddr.process(address).range() === "unicast";
}

const publicAgent = new Agent({
  connect: {
    lookup(host, options, callback) {
      lookup(host, { all: true, family: options.family, hints: options.hints }, (error, records) => {
        if (error) return callback(error, "");
        const allowed = records.filter(({ address }) => publicIp(address));
        if (!allowed.length) {
          return callback(new Error("Backend hostname did not resolve to a public address"), "");
        }
        if (options.all) callback(null, allowed);
        else callback(null, allowed[0].address, allowed[0].family);
      });
    },
  },
});

function privateBackendAllowed(origin: string): boolean {
  return (process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS ?? "").split(",").some((value) => {
    try {
      return new URL(value.trim()).origin === origin;
    } catch {
      return false;
    }
  });
}

export function validateBackendUrl(input: string | URL): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Backend URL must use HTTP or HTTPS without embedded credentials");
  }

  if (!privateBackendAllowed(url.origin)) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || (isIP(host) !== 0 && !publicIp(host))) {
      throw new Error("Private or HTTP backend origins require an explicit allowlist entry");
    }
  }
  return url;
}

export function backendFetch(origin: string) {
  return (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = validateBackendUrl(input);
    if (url.origin !== origin) throw new Error("Cross-origin backend request rejected");
    const options = {
      ...init,
      redirect: "error" as const,
      ...(privateBackendAllowed(url.origin) ? {} : { dispatcher: publicAgent }),
    };
    return fetch(url, options);
  };
}
