import { isAbsolute } from "node:path";

export function stdioLaunch(key: string, command: string, args: string[]) {
  const sandboxed = (process.env.MCP_GATEWAY_SANDBOX_BACKENDS ?? "").split(",")
    .some((value) => value.trim() === key);
  if (!sandboxed) return { command, args };

  const launcher = process.env.MCP_GATEWAY_STDIO_LAUNCHER;
  if (!launcher || !isAbsolute(launcher) || !isAbsolute(command)) {
    throw new Error("Sandboxed backends require absolute launcher and executable paths");
  }
  return { command: launcher, args: [command, ...args] };
}
