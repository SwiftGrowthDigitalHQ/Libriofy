import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SERVER_ONLY_PACKAGES = new Set([
  "@sentry/node",
  "bullmq",
  "compression",
  "cors",
  "express",
  "helmet",
  "ioredis",
]);
const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, "")),
]);
const CLIENT_GRAPH_ROOTS = [
  "src/main.tsx",
  "src/App.tsx",
  "src/lib/authApi.ts",
];
const CLIENT_SAFE_EXPORTS = [
  "src/hooks/useDatabaseHealth.ts",
  "src/lib/attendanceSync.ts",
  "src/lib/deviceFingerprint.ts",
  "src/lib/observability/alertService.client.ts",
  "src/lib/observability/eventLogger.client.ts",
  "src/lib/observability/internalLogger.client.ts",
  "src/lib/observability/paymentObservability.client.ts",
];

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^"'`]*?\bfrom\s*["']([^"']+)["']/g,
  /\bexport\s+[^"'`]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const normalizeRepoPath = (projectRoot, filePath) =>
  path.relative(projectRoot, filePath).split(path.sep).join("/");

const classifyContract = (projectRoot, filePath) => {
  const relativePath = normalizeRepoPath(projectRoot, filePath);
  if (relativePath.includes(".client.")) {
    return "client";
  }

  if (relativePath.includes(".server.")) {
    return "server";
  }

  if (relativePath.includes(".shared.") || /(?:^|\/)types\.ts$/.test(relativePath)) {
    return "shared";
  }

  return "neutral";
};

const isServerOnlyTarget = (projectRoot, filePath) => {
  const relativePath = normalizeRepoPath(projectRoot, filePath);
  return relativePath.startsWith("server/") || relativePath.startsWith("api/") || relativePath.includes(".server.");
};

const fileExists = (filePath) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const directoryExists = (filePath) => {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
};

const resolveSourceFile = (rawPath) => {
  if (fileExists(rawPath)) {
    return rawPath;
  }

  const extension = path.extname(rawPath);
  if (extension) {
    const basename = rawPath.slice(0, -extension.length);
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      const candidate = `${basename}${candidateExtension}`;
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  } else {
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      const candidate = `${rawPath}${candidateExtension}`;
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  if (directoryExists(rawPath)) {
    for (const candidateExtension of SOURCE_EXTENSIONS) {
      const candidate = path.join(rawPath, `index${candidateExtension}`);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const resolveImportSpecifier = (projectRoot, importerPath, specifier) => {
  if (specifier.startsWith("node:")) {
    return { kind: "builtin", specifier };
  }

  if (BUILTIN_MODULES.has(specifier)) {
    return { kind: "builtin", specifier };
  }

  if (specifier.startsWith("@/")) {
    const resolved = resolveSourceFile(path.join(projectRoot, "src", specifier.slice(2)));
    return resolved ? { kind: "file", path: resolved } : { kind: "unresolved", specifier };
  }

  if (specifier.startsWith(".")) {
    const resolved = resolveSourceFile(path.resolve(path.dirname(importerPath), specifier));
    return resolved ? { kind: "file", path: resolved } : { kind: "unresolved", specifier };
  }

  return { kind: "package", specifier };
};

const collectImportSpecifiers = (filePath, importCache) => {
  const cached = importCache.get(filePath);
  if (cached) {
    return cached;
  }

  const source = fs.readFileSync(filePath, "utf8");
  const specifiers = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  }

  const collected = [...specifiers];
  importCache.set(filePath, collected);
  return collected;
};

const collectSourceFiles = (directoryPath, collected = []) => {
  if (!directoryExists(directoryPath)) {
    return collected;
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-server") {
        continue;
      }

      collectSourceFiles(fullPath, collected);
      continue;
    }

    if (
      SOURCE_EXTENSIONS.includes(path.extname(entry.name)) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.")
    ) {
      collected.push(fullPath);
    }
  }

  return collected;
};

const recordViolation = (violations, message) => {
  if (!violations.includes(message)) {
    violations.push(message);
  }
};

const createClientGraphRoots = (projectRoot) =>
  [...CLIENT_GRAPH_ROOTS, ...CLIENT_SAFE_EXPORTS]
    .map((relativePath) => path.join(projectRoot, relativePath))
    .filter((absolutePath) => fileExists(absolutePath));

const inspectClientGraph = (projectRoot, importCache, violations) => {
  const roots = createClientGraphRoots(projectRoot);
  const visited = new Set();

  const visit = (filePath, chain) => {
    const relativePath = normalizeRepoPath(projectRoot, filePath);
    const visitKey = `${relativePath}::${chain[0]}`;
    if (visited.has(visitKey)) {
      return;
    }

    visited.add(visitKey);

    for (const specifier of collectImportSpecifiers(filePath, importCache)) {
      const resolved = resolveImportSpecifier(projectRoot, filePath, specifier);
      if (resolved.kind === "builtin") {
        recordViolation(
          violations,
          `[browser-graph] ${[...chain, relativePath].join(" -> ")} imports Node builtin "${specifier}".`,
        );
        continue;
      }

      if (resolved.kind === "package") {
        if (SERVER_ONLY_PACKAGES.has(specifier)) {
          recordViolation(
            violations,
            `[browser-graph] ${[...chain, relativePath].join(" -> ")} imports server-only package "${specifier}".`,
          );
        }
        continue;
      }

      if (resolved.kind !== "file") {
        continue;
      }

      const targetRelativePath = normalizeRepoPath(projectRoot, resolved.path);
      if (isServerOnlyTarget(projectRoot, resolved.path)) {
        recordViolation(
          violations,
          `[browser-graph] ${[...chain, relativePath, targetRelativePath].join(" -> ")} crosses into a server-only module.`,
        );
        continue;
      }

      visit(resolved.path, [...chain, relativePath]);
    }
  };

  for (const root of roots) {
    visit(root, []);
  }

  return roots.map((root) => normalizeRepoPath(projectRoot, root));
};

const inspectExplicitContracts = (projectRoot, importCache, violations) => {
  const sourceFiles = collectSourceFiles(path.join(projectRoot, "src"));

  for (const filePath of sourceFiles) {
    const contract = classifyContract(projectRoot, filePath);
    if (contract === "neutral") {
      continue;
    }

    const relativePath = normalizeRepoPath(projectRoot, filePath);
    for (const specifier of collectImportSpecifiers(filePath, importCache)) {
      const resolved = resolveImportSpecifier(projectRoot, filePath, specifier);
      if (resolved.kind === "builtin") {
        if (contract !== "server") {
          recordViolation(
            violations,
            `[${contract}-contract] ${relativePath} imports Node builtin "${specifier}".`,
          );
        }
        continue;
      }

      if (resolved.kind === "package") {
        if (contract !== "server" && SERVER_ONLY_PACKAGES.has(specifier)) {
          recordViolation(
            violations,
            `[${contract}-contract] ${relativePath} imports server-only package "${specifier}".`,
          );
        }
        continue;
      }

      if (resolved.kind !== "file") {
        continue;
      }

      const targetRelativePath = normalizeRepoPath(projectRoot, resolved.path);
      const targetContract = classifyContract(projectRoot, resolved.path);

      if (contract === "client" && isServerOnlyTarget(projectRoot, resolved.path)) {
        recordViolation(
          violations,
          `[client-contract] ${relativePath} imports server-only module ${targetRelativePath}.`,
        );
      }

      if (contract === "server" && targetContract === "client") {
        recordViolation(
          violations,
          `[server-contract] ${relativePath} imports client-only module ${targetRelativePath}.`,
        );
      }

      if (contract === "shared" && targetContract !== "neutral" && targetContract !== "shared") {
        recordViolation(
          violations,
          `[shared-contract] ${relativePath} imports runtime-specific module ${targetRelativePath}.`,
        );
      }
    }
  }
};

export const validateRuntimeBoundaries = async (projectRoot = process.cwd()) => {
  const importCache = new Map();
  const violations = [];
  const roots = inspectClientGraph(projectRoot, importCache, violations);
  inspectExplicitContracts(projectRoot, importCache, violations);

  return {
    roots,
    violations,
  };
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await validateRuntimeBoundaries();
  if (result.violations.length > 0) {
    console.error("Runtime boundary validation failed:");
    for (const violation of result.violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Runtime boundary validation passed for ${result.roots.length} browser-safe entrypoints.`);
  }
}
