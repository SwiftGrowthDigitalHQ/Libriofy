import assert from "node:assert/strict";

import { validateRuntimeConfiguration } from "../src/lib/observability/runtimeGovernance.server.js";

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  APP_ENV: "production",
  APP_URL: "https://www.libriofy.com",
  AUTH_EMAIL_FROM: "hello@libriofy.com",
  REDIS_URL: "redis://runtime.test:6379",
  RESEND_API_KEY: "resend-key",
  SITE_URL: "https://www.libriofy.com",
  STUDENT_QR_PRIVATE_KEY: "qr-private-key",
  SUPABASE_JWT_SECRET: "jwt-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_URL: "https://libriofy.supabase.co",
  SENTRY_RELEASE: "release-2026-05-09",
  ...overrides,
});

const mapCommonStatuses = (checks: ReturnType<typeof validateRuntimeConfiguration>["checks"]) =>
  Object.fromEntries(
    checks
      .filter((check) => check.name !== "frontend_bundle")
      .map((check) => [check.name, check.status]),
  );

const expressConfig = validateRuntimeConfiguration(buildEnv(), {
  hasDist: true,
  target: "express",
});
const serverlessConfig = validateRuntimeConfiguration(buildEnv(), {
  target: "serverless",
});
const queueWorkerConfig = validateRuntimeConfiguration(buildEnv(), {
  target: "queue_worker",
});
const invalidQueueWorkerConfig = validateRuntimeConfiguration(
  buildEnv({
    VERCEL: "1",
  }),
  {
    target: "queue_worker",
  },
);

assert.equal(expressConfig.ok, true, "Express runtime contract should validate with canonical env.");
assert.equal(serverlessConfig.ok, true, "Serverless runtime contract should validate with canonical env.");
assert.deepEqual(
  mapCommonStatuses(expressConfig.checks),
  mapCommonStatuses(serverlessConfig.checks),
  "Express and serverless targets must share the same core config semantics.",
);
assert.equal(queueWorkerConfig.ok, true, "Queue worker contract should validate in a long-lived Node runtime.");
assert.equal(invalidQueueWorkerConfig.ok, false, "Queue worker contract must fail inside serverless runtimes.");
assert.ok(
  invalidQueueWorkerConfig.missing.includes("QUEUE_WORKER_RUNTIME=node_process"),
  "Queue worker validation must explain the runtime capability failure.",
);

console.log("Runtime consistency validation passed for express, serverless, and queue_worker contracts.");
