import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const desiredHooksPath = ".githooks";
const hookFiles = ["pre-commit", "pre-push"];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

try {
  if (runGit(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    process.exit(0);
  }
} catch {
  console.warn("[hooks] Skipping git hook setup because this folder is not a git worktree.");
  process.exit(0);
}

let currentHooksPath = "";

try {
  currentHooksPath = runGit(["config", "--get", "core.hooksPath"]);
} catch {
  currentHooksPath = "";
}

if (currentHooksPath === desiredHooksPath) {
  for (const hookFile of hookFiles) {
    fs.chmodSync(path.join(process.cwd(), desiredHooksPath, hookFile), 0o755);
  }
  console.log(`[hooks] Git hooks already configured at ${desiredHooksPath}.`);
  process.exit(0);
}

runGit(["config", "core.hooksPath", desiredHooksPath]);
for (const hookFile of hookFiles) {
  fs.chmodSync(path.join(process.cwd(), desiredHooksPath, hookFile), 0o755);
}
console.log(`[hooks] Configured git hooks path to ${desiredHooksPath}.`);
