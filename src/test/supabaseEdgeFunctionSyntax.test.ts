// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(__dirname, "..", "..");
const functionsRoot = path.join(workspaceRoot, "supabase", "functions");

const collectEdgeFunctionFiles = (dir: string, acc: string[] = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectEdgeFunctionFiles(fullPath, acc);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      acc.push(fullPath);
    }
  }

  return acc;
};

describe("supabase edge function syntax", () => {
  it("keeps every edge function parser-safe for deployment", async () => {
    const files = collectEdgeFunctionFiles(functionsRoot).sort();
    expect(files.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");

      try {
        await transform(source, {
          format: "esm",
          loader: "ts",
          sourcefile: path.relative(workspaceRoot, file),
          target: "es2022",
        });
      } catch (error) {
        const buildError = error as { errors?: Array<{ location?: { column: number; line: number }; text: string }> };
        const messages = (buildError.errors ?? [{ text: String(error) }]).map((entry) =>
          `${entry.location ? `${entry.location.line}:${entry.location.column}: ` : ""}${entry.text}`,
        );
        failures.push(`${path.relative(workspaceRoot, file)}\n${messages.join("\n")}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
