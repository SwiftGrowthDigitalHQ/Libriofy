import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const migrationsDir = path.join(projectRoot, "supabase", "migrations");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const localVersions = fs
  .readdirSync(migrationsDir)
  .map((fileName) => {
    const match = fileName.match(/^(\d{14})_.*\.sql$/);
    return match?.[1] ?? null;
  })
  .filter((value) => typeof value === "string")
  .sort((left, right) => left.localeCompare(right));

const commandArgs = ["supabase", "migration", "list", "--linked"];
if (process.env.SUPABASE_DB_PASSWORD?.trim()) {
  commandArgs.push("--password", process.env.SUPABASE_DB_PASSWORD.trim());
}

const result = spawnSync(npxCommand, commandArgs, {
  cwd: projectRoot,
  encoding: "utf8",
  env: process.env,
  shell: process.platform === "win32",
});

const commandOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(commandOutput.trim() || "Unable to read linked Supabase migration history.");
  process.exit(result.status ?? 1);
}

const remoteVersions = [];

for (const line of commandOutput.split(/\r?\n/)) {
  const match = line.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/);
  if (!match) {
    continue;
  }

  const [, localVersion, remoteVersion] = match;
  if (remoteVersion) {
    remoteVersions.push(remoteVersion);
  } else if (localVersion && !localVersions.includes(localVersion)) {
    // If the CLI ever emits a remote-only row in the first column, keep it visible below.
    remoteVersions.push(localVersion);
  }
}

const uniqueRemoteVersions = [...new Set(remoteVersions)].sort((left, right) => left.localeCompare(right));
const missingOnRemote = localVersions.filter((version) => !uniqueRemoteVersions.includes(version));
const unexpectedOnRemote = uniqueRemoteVersions.filter((version) => !localVersions.includes(version));

if (missingOnRemote.length > 0 || unexpectedOnRemote.length > 0) {
  console.error("Supabase migration history mismatch detected.");

  if (missingOnRemote.length > 0) {
    console.error("Missing on linked database:");
    for (const version of missingOnRemote) {
      console.error(`  - ${version}`);
    }
  }

  if (unexpectedOnRemote.length > 0) {
    console.error("Present on linked database but missing locally:");
    for (const version of unexpectedOnRemote) {
      console.error(`  - ${version}`);
    }
  }

  process.exit(1);
}

console.log(`Linked Supabase migration history matches local migrations (${localVersions.length} versions).`);
