// Runs a command with DATABASE_URL set from lib/db-url.js (for Prisma CLI and scripts).
// Usage: node scripts/with-db.mjs <command> [args...]
import { spawnSync } from "node:child_process";
import { databaseUrl } from "../lib/db-url.js";

const [cmd, ...args] = process.argv.slice(2);
const res = spawnSync(cmd, args, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl() }
});
process.exit(res.status ?? 1);
