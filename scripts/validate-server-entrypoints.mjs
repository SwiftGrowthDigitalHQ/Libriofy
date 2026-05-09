import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const SERVER_ENTRYPOINTS = [
  "server/index.ts",
  "server/vercelHandler.ts",
  "api/_handler.ts",
  "api/[...route].ts",
  "api/admin/[...route].ts",
  "api/ai/[...route].ts",
  "api/attendance/[...route].ts",
  "api/auth/[...route].ts",
  "api/auth/refresh.ts",
  "api/auth/super-admin/login.ts",
  "api/auth/super-admin/verify.ts",
  "api/auth/super-admin/verify-otp.ts",
  "api/health/[...route].ts",
  "api/observability/[...route].ts",
];

export const validateServerEntrypoints = async (projectRoot = process.cwd()) => {
  const entryPoints = SERVER_ENTRYPOINTS
    .map((relativePath) => path.join(projectRoot, relativePath))
    .filter((absolutePath) => fs.existsSync(absolutePath));

  if (entryPoints.length === 0) {
    throw new Error("No server entrypoints were found to validate.");
  }

  await build({
    entryPoints,
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "test"),
    },
    format: "esm",
    logLevel: "silent",
    outdir: path.join(projectRoot, ".server-validation"),
    platform: "node",
    sourcemap: false,
    target: "node22",
    write: false,
  });
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await validateServerEntrypoints();
    console.log("Server runtime entrypoint validation passed.");
  } catch (error) {
    if (error && typeof error === "object" && Array.isArray(error.errors)) {
      console.error("Server runtime entrypoint validation failed:");
      for (const buildError of error.errors) {
        console.error(`- ${buildError.text}`);
      }
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
