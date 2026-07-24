// `npm start` for a git-clone deployment. Delegates entirely to bin/cli.mjs
// (the same entry point `npx mcp-gateway` uses) so there's exactly one
// tested code path for running the built app, instead of two that could
// silently drift apart. See bin/cli.mjs for the actual startup logic
// (including .env loading and PORT/HOST handling).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(dir, "..", "bin", "cli.mjs");

const child = spawn(process.execPath, [cli], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
