import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const zeroSha = "0000000000000000000000000000000000000000";
const schemaSyncScript = path.join(projectRoot, "scripts", "check-supabase-schema-sync.mjs");

const deliveryRelevantRoots = [
  ".githooks/",
  "api/",
  "public/",
  "scripts/",
  "server/",
  "src/",
  "supabase/",
];

const deliveryRelevantFiles = new Set([
  "components.json",
  "eslint.config.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "README.md",
  "tailwind.config.ts",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
]);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isDocumentationFile(filePath) {
  return filePath === "README.md" || filePath.startsWith("docs/") || filePath.endsWith(".md");
}

function isDeliveryRelevantFile(filePath) {
  return (
    deliveryRelevantFiles.has(filePath) ||
    deliveryRelevantRoots.some((prefix) => filePath.startsWith(prefix))
  );
}

function requiresDocumentation(filePath) {
  return isDeliveryRelevantFile(filePath) && !isDocumentationFile(filePath);
}

function getChangedFilesForStaged() {
  return uniqueSorted(
    splitLines(runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])),
  );
}

function getChangedFilesForRange(baseSha, headSha) {
  return uniqueSorted(
    splitLines(runGit(["diff", "--name-only", "--diff-filter=ACMR", baseSha, headSha])),
  );
}

function getChangedFilesForCommit(commitSha) {
  return uniqueSorted(
    splitLines(runGit(["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", commitSha])),
  );
}

function detectDefaultBaseRef() {
  try {
    return runGit(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  } catch {
    for (const candidate of ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
      try {
        runGit(["rev-parse", "--verify", candidate]);
        return candidate;
      } catch {
        // Try the next common default branch.
      }
    }
  }

  return null;
}

async function readStandardInput() {
  if (process.stdin.isTTY) {
    return "";
  }

  return await new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      resolve(buffer);
    });
  });
}

function collectChangedFilesForPrePush(pushSpec) {
  const defaultBaseRef = detectDefaultBaseRef();
  const changedFiles = new Set();
  const pushLines = splitLines(pushSpec);

  for (const line of pushLines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);

    if (!localRef || !localSha || localSha === zeroSha) {
      continue;
    }

    if (remoteRef && remoteSha && remoteSha !== zeroSha) {
      for (const filePath of getChangedFilesForRange(remoteSha, localSha)) {
        changedFiles.add(filePath);
      }
      continue;
    }

    if (defaultBaseRef) {
      const mergeBase = runGit(["merge-base", defaultBaseRef, localSha]);
      for (const filePath of getChangedFilesForRange(mergeBase, localSha)) {
        changedFiles.add(filePath);
      }
      continue;
    }

    for (const filePath of getChangedFilesForCommit(localSha)) {
      changedFiles.add(filePath);
    }
  }

  return uniqueSorted([...changedFiles]);
}

function formatList(items) {
  return items.map((item) => `  - ${item}`).join("\n");
}

function validateDocumentationCoverage(changedFiles, modeLabel) {
  const implementationFiles = changedFiles.filter(requiresDocumentation);

  if (implementationFiles.length === 0) {
    console.log(`[delivery-check] ${modeLabel}: no delivery-relevant non-doc files detected.`);
    return;
  }

  const documentationFiles = changedFiles.filter(isDocumentationFile);

  if (documentationFiles.length > 0) {
    console.log(`[delivery-check] ${modeLabel}: documentation changes detected.`);
    console.log(formatList(documentationFiles));
    return;
  }

  console.error(`[delivery-check] ${modeLabel}: documentation update is required.`);
  console.error("Changed delivery-relevant files:");
  console.error(formatList(implementationFiles));
  console.error("Update the relevant docs in docs/system-blueprint/ or README.md before commit/push.");
  process.exit(1);
}

function runSchemaSyncCheck() {
  console.log("[delivery-check] Running Supabase schema sync guard...");
  execFileSync("node", [schemaSyncScript], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

function parseFilesModeArguments(args) {
  const files = args.slice(1);

  if (files.length === 0) {
    throw new Error("The --files mode requires at least one file path.");
  }

  return uniqueSorted(files);
}

function parseRangeModeArguments(args) {
  const [, baseSha, headSha] = args;

  if (!baseSha || !headSha) {
    throw new Error("The --range mode requires both <baseSha> and <headSha>.");
  }

  return {
    baseSha,
    headSha,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (!mode || !["--staged", "--pre-push", "--files", "--range"].includes(mode)) {
    throw new Error(
      "Usage: node ./scripts/check-delivery-requirements.mjs --staged | --pre-push | --files <file...> | --range <baseSha> <headSha>",
    );
  }

  runSchemaSyncCheck();

  let changedFiles = [];
  let modeLabel = mode;

  if (mode === "--staged") {
    changedFiles = getChangedFilesForStaged();
    modeLabel = "staged changes";
  } else if (mode === "--pre-push") {
    changedFiles = collectChangedFilesForPrePush(await readStandardInput());
    modeLabel = "push range";
  } else if (mode === "--range") {
    const { baseSha, headSha } = parseRangeModeArguments(args);
    changedFiles = getChangedFilesForRange(baseSha, headSha);
    modeLabel = `git range ${baseSha}..${headSha}`;
  } else {
    changedFiles = parseFilesModeArguments(args);
    modeLabel = "explicit file set";
  }

  validateDocumentationCoverage(changedFiles, modeLabel);
  console.log("[delivery-check] All delivery requirements passed.");
}

try {
  await main();
} catch (error) {
  console.error(
    `[delivery-check] ${error instanceof Error ? error.message : "Unexpected validation failure."}`,
  );
  process.exit(1);
}
