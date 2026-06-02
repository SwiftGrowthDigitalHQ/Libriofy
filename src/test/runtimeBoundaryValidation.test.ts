// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateRuntimeBoundaries } from "../../scripts/validate-runtime-boundaries.mjs";
import { validateServerEntrypoints } from "../../scripts/validate-server-entrypoints.mjs";

describe("runtime boundary integrity", () => {
  it("keeps browser-safe entrypoints free of server-only imports", async () => {
    const result = await validateRuntimeBoundaries();
    expect(result.violations).toEqual([]);
  });

  it("bundles express and serverless entrypoints cleanly", async () => {
    await expect(validateServerEntrypoints()).resolves.toBeUndefined();
  }, 60_000);
});
