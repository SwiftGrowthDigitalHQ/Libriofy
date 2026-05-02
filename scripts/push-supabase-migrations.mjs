import { spawnSync } from "node:child_process";

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const commandArgs = ["supabase", "db", "push", "--linked", "--include-all", "--yes"];

if (process.env.SUPABASE_DB_PASSWORD?.trim()) {
  commandArgs.push("--password", process.env.SUPABASE_DB_PASSWORD.trim());
}

const result = spawnSync(npxCommand, commandArgs, {
  cwd: process.cwd(),
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
