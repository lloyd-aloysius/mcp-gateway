import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2), "--hostname", "127.0.0.1"], {
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: "127.0.0.1" },
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
