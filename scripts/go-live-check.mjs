import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return "";
  }

  return args[index + 1];
};

const projectRoot = process.cwd();
const strict = hasFlag("--strict");
const json = hasFlag("--json");
const envOnly = hasFlag("--env-only");
const appEnvPath = path.resolve(projectRoot, getFlagValue("--app-env-file") || ".env");
const opsEnvPath = path.resolve(projectRoot, getFlagValue("--ops-env-file") || ".env.ops");
const manualChecksPath = path.resolve(
  projectRoot,
  getFlagValue("--manual-file") || ".ops/go-live-manual-checks.json",
);
const expectedReleaseShaFlag = getFlagValue("--expected-release");
const taskPrefix = getFlagValue("--task-prefix") || "Libriofy";
const ciWorkflowPath = path.join(projectRoot, ".github", "workflows", "ci-cd.yml");
const frontendReleaseManifestPath = path.join(projectRoot, "dist", "release.json");
const frontendIndexPath = path.join(projectRoot, "dist", "index.html");
const serverBuildPath = path.join(projectRoot, "dist-server", "index.mjs");
const packageLockPath = path.join(projectRoot, "package-lock.json");
const LIBRIOFY_PUBLIC_APP_URL = "https://www.libriofy.com";
const LIBRIOFY_AUTH_EMAIL = "hello@libriofy.com";

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries = {};

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
};

const appEnv = {
  ...parseEnvFile(appEnvPath),
  ...process.env,
};

const opsEnv = {
  ...parseEnvFile(opsEnvPath),
  ...process.env,
};

const readManualChecks = () => {
  if (!fs.existsSync(manualChecksPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(manualChecksPath, "utf8"));
};

const hasValue = (value) => Boolean(typeof value === "string" && value.trim());

const matchesCanonicalLibriofyUrl = (value) => {
  if (!hasValue(value)) {
    return false;
  }

  try {
    const parsed = new URL(String(value).trim());
    return parsed.protocol === "https:" && ["libriofy.com", "www.libriofy.com"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const matchesCanonicalLibriofyEmail = (value) => {
  if (!hasValue(value)) {
    return false;
  }

  const normalized = String(value).trim();
  const matched = normalized.match(/<([^>]+)>/);
  const address = String(matched?.[1] ?? normalized).trim().toLowerCase();
  return address === LIBRIOFY_AUTH_EMAIL;
};

const readSuperAdminEmailFrom = (env) => env.AUTH_EMAIL_FROM || env.RESEND_FROM_EMAIL || "";

const looksLikePlaceholder = (key, rawValue) => {
  const value = String(rawValue || "").trim();
  if (!value) {
    return true;
  }

  const genericPatterns = [
    /example\.com/i,
    /your-project\.supabase\.co/i,
    /your[_-]/i,
    /prod-host/i,
    /staging-host/i,
    /gdrive:libriofy-backups/i,
    /ops-backups/i,
    /x{6,}/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(value))) {
    return true;
  }

  if ((key === "VITE_RAZORPAY_KEY_ID" || key === "RAZORPAY_KEY_ID") && (!/^rzp_live_/i.test(value) || /(example|placeholder|your)/i.test(value))) {
    return true;
  }

  if ((key === "RELEASE_SHA" || key === "VITE_RELEASE_SHA" || key === "SENTRY_RELEASE") && value === "local") {
    return true;
  }

  if ((key === "RESTORE_DB_URL" || key === "RESTORE_STAGING_DB_URL") && /postgres:password@/i.test(value)) {
    return true;
  }

  if (key.endsWith("_URL") && /localhost|127\.0\.0\.1/i.test(value)) {
    return true;
  }

  return false;
};

const requirementLabel = (requirement) =>
  requirement.label ||
  requirement.key ||
  (requirement.anyOf ? requirement.anyOf.join("|") : "unknown_requirement");

const validateServerStartupEnv = (env) => {
  const requiredKeys = ["APP_ENV", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STUDENT_QR_PRIVATE_KEY"];
  const missing = requiredKeys.filter((key) => !hasValue(env[key]) || looksLikePlaceholder(key, env[key]));
  const hasBaseUrl = ["APP_URL", "PUBLIC_APP_URL", "SITE_URL"].some((key) => matchesCanonicalLibriofyUrl(env[key]));
  const hasJwtSecret = ["SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET"].some(
    (key) => hasValue(env[key]) && !looksLikePlaceholder(key, env[key]),
  );
  const hasSuperAdminEmailOtp = hasValue(env.RESEND_API_KEY) && matchesCanonicalLibriofyEmail(readSuperAdminEmailFrom(env));

  if (!hasBaseUrl) {
    missing.push(`APP_URL|PUBLIC_APP_URL|SITE_URL=${LIBRIOFY_PUBLIC_APP_URL}`);
  }

  if (!hasValue(env.REDIS_URL) || looksLikePlaceholder("REDIS_URL", env.REDIS_URL)) {
    missing.push("REDIS_URL");
  }

  if (!hasJwtSecret) {
    missing.push("SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET");
  }

  if (!hasSuperAdminEmailOtp) {
    missing.push(`RESEND_API_KEY+AUTH_EMAIL_FROM|RESEND_FROM_EMAIL=${LIBRIOFY_AUTH_EMAIL}`);
  }

  return {
    detail: missing.length === 0 ? "server startup validation would pass" : `missing ${missing.join(", ")}`,
    label: "startup validation passes",
    ok: missing.length === 0,
  };
};

const evaluateRequirements = (env, requirements) =>
  requirements.map((requirement) => {
    if (requirement.key) {
      const value = env[requirement.key];
      const ok = hasValue(value) && !looksLikePlaceholder(requirement.key, value);

      return {
        detail: ok ? "configured" : "missing or placeholder value",
        label: requirementLabel(requirement),
        ok,
      };
    }

    const values = requirement.anyOf || [];
    const matchingKey = values.find((key) => hasValue(env[key]) && !looksLikePlaceholder(key, env[key]));

    return {
      detail: matchingKey ? `configured via ${matchingKey}` : "no valid value found",
      label: requirementLabel(requirement),
      ok: Boolean(matchingKey),
    };
  });

const buildSection = (title, checks) => ({
  checks,
  ok: checks.every((check) => check.ok),
  title,
});

const findSection = (sectionsList, title) => sectionsList.find((section) => section.title === title) || null;

const buildReleaseTruth = (sectionsList) => {
  const verifiedTitles = ["Deployment", "Release Integrity", "Domain & HTTPS", "Database Safety", "Final Test"];
  const monitoredTitles = ["Monitoring", "Ops System"];

  const verified = verifiedTitles.every((title) => findSection(sectionsList, title)?.ok === true);
  const reproducible = findSection(sectionsList, "Reproducibility")?.ok === true;
  const monitored = monitoredTitles.every((title) => findSection(sectionsList, title)?.ok === true);

  return {
    monitored,
    ok: verified && reproducible && monitored,
    reproducible,
    verified,
  };
};

const checkCustomDomain = (urlValue) => {
  try {
    const parsed = new URL(urlValue);
    const vercelHost = ["vercel", "app"].join(".");
    const blockedHosts = [
      "localhost",
      "127.0.0.1",
      "example.com",
      vercelHost,
      "netlify.app",
      "onrender.com",
      "render.com",
    ];

    return blockedHosts.every((host) => !parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
};

const fetchHealth = async (name, url) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      duration_ms: Date.now() - startedAt,
      name,
      ok: response.ok,
      payload,
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown endpoint failure",
      name,
      ok: false,
      payload: null,
      status: 0,
      url,
    };
  }
};

const deriveBaseHealthUrl = (healthUrl) => {
  try {
    const parsed = new URL(healthUrl);
    parsed.pathname = "/health";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const deriveFrontendReleaseUrl = (frontendUrl) => {
  try {
    const parsed = new URL(frontendUrl);
    parsed.pathname = "/release.json";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const readTextFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
};

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const toAgeHours = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Number((diffMs / 1000 / 60 / 60).toFixed(2));
};

const toAgeDays = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Number((diffMs / 1000 / 60 / 60 / 24).toFixed(2));
};

const runOpsHealth = () => {
  const scriptPath = path.join(projectRoot, "scripts", "ops-health.mjs");
  const output = execFileSync("node", [scriptPath, "--", "--env-file", opsEnvPath, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  return JSON.parse(output);
};

const queryScheduledTask = (taskName) => {
  if (process.platform !== "win32") {
    return {
      detail: "Scheduled task verification is only automated on Windows",
      ok: false,
    };
  }

  try {
    const command = [
      "-NoProfile",
      "-Command",
      `$task = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction Stop; $task | Select-Object TaskName, State | ConvertTo-Json -Compress`,
    ];
    const raw = execFileSync("powershell", command, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const task = JSON.parse(raw);
    const state = String(task.State || "");
    const ok = state.toLowerCase() !== "disabled";

    return {
      detail: ok ? `state=${state}` : `task is disabled (${state})`,
      ok,
    };
  } catch {
    return {
      detail: "task not found",
      ok: false,
    };
  }
};

const evaluateFilePresence = (filePath, label) => ({
  detail: fs.existsSync(filePath) ? filePath : `${filePath} is missing`,
  label,
  ok: fs.existsSync(filePath),
});

const resolveVerifiedReleaseSha = (manualChecks) => {
  const candidates = [
    expectedReleaseShaFlag,
    manualChecks?.verified_release_sha,
    process.env.EXPECTED_RELEASE_SHA,
    appEnv.RELEASE_SHA,
    appEnv.VITE_RELEASE_SHA,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const firstValid = candidates.find((value) => !looksLikePlaceholder("RELEASE_SHA", value));
  return firstValid || "";
};

const evaluateVerifiedRelease = (verifiedReleaseSha, manualChecks) => ({
  detail: verifiedReleaseSha
    ? `verified release ${verifiedReleaseSha}`
    : manualChecks
      ? "verified_release_sha is missing or placeholder"
      : `manual file missing: ${manualChecksPath}`,
  label: "verified release declared",
  ok: Boolean(verifiedReleaseSha),
});

const evaluateVerifiedReleaseEvidence = (manualChecks) => {
  const verifiedByOk = hasValue(manualChecks?.verified_by);
  const verifiedAtOk = isValidIsoTimestamp(manualChecks?.verified_at_utc);
  const ok = verifiedByOk && verifiedAtOk;

  const failures = [];
  if (!verifiedByOk) failures.push("verified_by missing");
  if (!verifiedAtOk) failures.push("verified_at_utc missing");

  return {
    detail: ok
      ? `recorded by ${manualChecks.verified_by} at ${manualChecks.verified_at_utc}`
      : manualChecks
        ? failures.join(", ")
        : `manual file missing: ${manualChecksPath}`,
    label: "verified release evidence recorded",
    ok,
  };
};

const isValidIsoTimestamp = (value) =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime());

const evaluateManualCheck = (manualChecks, verifiedReleaseSha, key, label) => {
  const entry = manualChecks?.[key];
  const status = String(entry?.status || "pending").toLowerCase();
  const checkedAtOk = isValidIsoTimestamp(entry?.checked_at_utc);
  const checkedByOk = hasValue(entry?.checked_by);
  const environmentOk = ["staging", "production"].includes(String(entry?.environment || "").toLowerCase());
  const releaseOk = verifiedReleaseSha && String(entry?.release_sha || "").trim() === verifiedReleaseSha;
  const evidence = Array.isArray(entry?.evidence) ? entry.evidence : [];
  const evidenceOk =
    evidence.length > 0 && evidence.every((item) => typeof item === "string" && item.trim().length > 0);
  const ok = status === "pass" && checkedAtOk && checkedByOk && environmentOk && releaseOk && evidenceOk;

  const failures = [];
  if (status !== "pass") failures.push(`status=${status}`);
  if (!checkedAtOk) failures.push("checked_at_utc missing");
  if (!checkedByOk) failures.push("checked_by missing");
  if (!environmentOk) failures.push("environment must be staging or production");
  if (!releaseOk) failures.push("release_sha does not match verified release");
  if (!evidenceOk) failures.push("evidence missing");

  return {
    detail: ok
      ? `pass at ${entry.checked_at_utc} by ${entry.checked_by} (${entry.environment})`
      : manualChecks
        ? failures.join(", ")
        : `manual file missing: ${manualChecksPath}`,
    label,
    ok,
  };
};

const appEnvRequirements = [
  { key: "VITE_SUPABASE_URL" },
  { key: "VITE_SUPABASE_ANON_KEY" },
  { key: "VITE_AUTH_API_BASE" },
  { key: "VITE_API_BASE_URL" },
  { key: "VITE_SCAN_API_URL" },
  { key: "VITE_DEVICE_HEARTBEAT_API_URL" },
  { key: "VITE_STUDENT_QR_API_URL" },
  { anyOf: ["VITE_QR_PUBLIC_KEY", "VITE_STUDENT_QR_PUBLIC_KEY"], label: "VITE_QR_PUBLIC_KEY|VITE_STUDENT_QR_PUBLIC_KEY" },
  { key: "VITE_RAZORPAY_KEY_ID" },
  { key: "VITE_PUBLIC_APP_URL" },
  { key: "VITE_APP_URL" },
  { key: "VITE_APP_ENV" },
  { key: "VITE_RELEASE_SHA" },
  { key: "VITE_SENTRY_DSN" },
  { key: "SUPABASE_URL" },
  { key: "SUPABASE_SERVICE_ROLE_KEY" },
  { key: "STUDENT_QR_PRIVATE_KEY" },
  { key: "REDIS_URL" },
  { anyOf: ["SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET"], label: "SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET" },
  {
    anyOf: [
      "RESEND_API_KEY",
      "AUTH_EMAIL_FROM",
      "RESEND_FROM_EMAIL",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_WHATSAPP_FROM",
    ],
    label: "super admin OTP delivery config",
  },
  { anyOf: ["APP_URL", "PUBLIC_APP_URL", "SITE_URL"], label: `APP_URL|PUBLIC_APP_URL|SITE_URL=${LIBRIOFY_PUBLIC_APP_URL}` },
  { key: "APP_ENV" },
  { key: "RELEASE_SHA" },
  { key: "SENTRY_DSN" },
];

const opsEnvRequirements = [
  { key: "SUPABASE_URL" },
  { key: "SUPABASE_SERVICE_ROLE_KEY" },
  { key: "RESTORE_DB_URL" },
  { key: "RESTORE_STAGING_DB_URL" },
  { key: "BACKUP_REQUIRE_OFFSITE" },
  {
    anyOf: [
      "BACKUP_S3_URI",
      "BACKUP_RCLONE_REMOTE",
      "BACKUP_SUPABASE_BUCKET",
    ],
    label: "BACKUP_S3_URI|BACKUP_RCLONE_REMOTE|BACKUP_SUPABASE_BUCKET",
  },
  { key: "OPS_ALERT_WEBHOOK_URL" },
  { key: "HEALTHCHECK_PRODUCTION_FRONTEND_URL" },
  { key: "HEALTHCHECK_PRODUCTION_API_URL" },
  { key: "HEALTHCHECK_STAGING_FRONTEND_URL" },
  { key: "HEALTHCHECK_STAGING_API_URL" },
];

const envSection = buildSection("Env & Secrets", [
  validateServerStartupEnv(appEnv),
  ...evaluateRequirements(appEnv, appEnvRequirements).map((check) => ({
    ...check,
    label: `app:${check.label}`,
  })),
  ...evaluateRequirements(opsEnv, opsEnvRequirements).map((check) => ({
    ...check,
    label: `ops:${check.label}`,
  })),
]);

const sections = [envSection];

if (!envOnly) {
  const manualChecks = readManualChecks();
  const verifiedReleaseSha = resolveVerifiedReleaseSha(manualChecks);
  const opsHealthSummary = runOpsHealth();
  const localFrontendReleaseManifest = readJson(frontendReleaseManifestPath);
  const ciWorkflowSource = readTextFile(ciWorkflowPath);

  const endpointTargets = {
    production_api_ready: opsEnv.HEALTHCHECK_PRODUCTION_API_URL,
    staging_api_ready: opsEnv.HEALTHCHECK_STAGING_API_URL,
    production_frontend: opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL,
    staging_frontend: opsEnv.HEALTHCHECK_STAGING_FRONTEND_URL,
    production_api_health: deriveBaseHealthUrl(opsEnv.HEALTHCHECK_PRODUCTION_API_URL || ""),
    production_frontend_release: deriveFrontendReleaseUrl(opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL || ""),
  };

  const endpointChecks = Object.fromEntries(
    await Promise.all(
      Object.entries(endpointTargets)
        .filter(([, url]) => hasValue(url))
        .map(async ([name, url]) => [name, await fetchHealth(name, String(url))]),
    ),
  );

  const backupStatus = readJson(path.join(projectRoot, "backups", "logs", "latest-backup-status.json"));
  const drillStatus = readJson(path.join(projectRoot, "backups", "logs", "latest-restore-drill-status.json"));
  const alertStatus = readJson(path.join(projectRoot, "backups", "logs", "latest-alert-status.json"));

  const productionApiReadinessChecks = Array.isArray(endpointChecks.production_api_ready?.payload?.checks)
    ? endpointChecks.production_api_ready.payload.checks
    : Array.isArray(endpointChecks.production_api_ready?.payload?.readiness?.checks)
      ? endpointChecks.production_api_ready.payload.readiness.checks
      : [];

  const connectivityCheck = productionApiReadinessChecks.find((check) => check?.name === "supabase_connectivity");
  const productionApiRelease = String(endpointChecks.production_api_health?.payload?.release || "").trim();
  const productionFrontendRelease = String(endpointChecks.production_frontend_release?.payload?.release || "").trim();

  sections.push(
    buildSection("Deployment", [
      {
        label: "staging deploy success",
        ok: Boolean(endpointChecks.staging_frontend?.ok && endpointChecks.staging_api_ready?.ok),
        detail: `frontend=${endpointChecks.staging_frontend?.status ?? "missing"}, api=${endpointChecks.staging_api_ready?.status ?? "missing"}`,
      },
      {
        label: "production deploy success",
        ok: Boolean(endpointChecks.production_frontend?.ok && endpointChecks.production_api_ready?.ok),
        detail: `frontend=${endpointChecks.production_frontend?.status ?? "missing"}, api=${endpointChecks.production_api_ready?.status ?? "missing"}`,
      },
    ]),
  );

  sections.push(
    buildSection("Release Integrity", [
      evaluateVerifiedRelease(verifiedReleaseSha, manualChecks),
      evaluateVerifiedReleaseEvidence(manualChecks),
      {
        label: "production API release matches verified version",
        ok: Boolean(verifiedReleaseSha && endpointChecks.production_api_health?.ok && productionApiRelease === verifiedReleaseSha),
        detail: productionApiRelease
          ? `api release=${productionApiRelease}`
          : "production API release not available",
      },
      {
        label: "production frontend release matches verified version",
        ok: Boolean(
          verifiedReleaseSha &&
            endpointChecks.production_frontend_release?.ok &&
            productionFrontendRelease === verifiedReleaseSha,
        ),
        detail: productionFrontendRelease
          ? `frontend release=${productionFrontendRelease}`
          : "production frontend release manifest not available",
      },
    ]),
  );

  sections.push(
    buildSection("Reproducibility", [
      {
        label: "lockfile exists",
        ok: fs.existsSync(packageLockPath),
        detail: fs.existsSync(packageLockPath) ? packageLockPath : "package-lock.json is missing",
      },
      {
        label: "CI installs with npm ci",
        ok: ciWorkflowSource.includes("npm ci"),
        detail: ciWorkflowSource.includes("npm ci")
          ? "ci-cd workflow uses npm ci"
          : "ci-cd workflow does not contain npm ci",
      },
      {
        label: "CI builds production artifacts",
        ok: ciWorkflowSource.includes("npm run build:production"),
        detail: ciWorkflowSource.includes("npm run build:production")
          ? "ci-cd workflow builds production artifacts"
          : "ci-cd workflow does not run npm run build:production",
      },
      evaluateFilePresence(frontendIndexPath, "local frontend artifact exists"),
      evaluateFilePresence(frontendReleaseManifestPath, "local frontend release manifest exists"),
      evaluateFilePresence(serverBuildPath, "local server artifact exists"),
      {
        label: "local build matches verified release",
        ok: Boolean(
          verifiedReleaseSha &&
            localFrontendReleaseManifest &&
            String(localFrontendReleaseManifest.release || "").trim() === verifiedReleaseSha,
        ),
        detail: localFrontendReleaseManifest?.release
          ? `local release=${localFrontendReleaseManifest.release}`
          : "local release manifest has no release value",
      },
    ]),
  );

  sections.push(
    buildSection("Domain & HTTPS", [
      {
        label: "domain connected",
        ok:
          checkCustomDomain(opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL || "") &&
          checkCustomDomain(opsEnv.HEALTHCHECK_PRODUCTION_API_URL || "") &&
          opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL !== opsEnv.HEALTHCHECK_STAGING_FRONTEND_URL &&
          opsEnv.HEALTHCHECK_PRODUCTION_API_URL !== opsEnv.HEALTHCHECK_STAGING_API_URL,
        detail: "production and staging hosts must be distinct custom domains",
      },
      {
        label: "https active",
        ok:
          String(opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL || "").startsWith("https://") &&
          String(opsEnv.HEALTHCHECK_PRODUCTION_API_URL || "").startsWith("https://") &&
          Boolean(endpointChecks.production_frontend?.ok && endpointChecks.production_api_ready?.ok),
        detail: "production frontend and API URLs must use HTTPS and respond successfully",
      },
      {
        label: "/health endpoint returns 200",
        ok: Boolean(endpointChecks.production_api_health?.ok),
        detail: `status=${endpointChecks.production_api_health?.status ?? "missing"}`,
      },
    ]),
  );

  sections.push(
    buildSection("Database Safety", [
      {
        label: "production DB connected",
        ok: connectivityCheck?.status === "pass",
        detail: connectivityCheck?.detail || "supabase_connectivity check missing from readiness payload",
      },
      {
        label: "backup system active",
        ok: backupStatus?.status === "success" && (toAgeHours(backupStatus.completed_at_utc) ?? Infinity) <= 26,
        detail: backupStatus?.completed_at_utc
          ? `last backup ${toAgeHours(backupStatus.completed_at_utc)} hours ago`
          : "latest backup status missing",
      },
      {
        label: "restore drill tested",
        ok: drillStatus?.status === "success" && (toAgeDays(drillStatus.completed_at_utc) ?? Infinity) <= 35,
        detail: drillStatus?.completed_at_utc
          ? `last drill ${toAgeDays(drillStatus.completed_at_utc)} days ago`
          : "latest restore drill status missing",
      },
    ]),
  );

  sections.push(
    buildSection("Monitoring", [
      {
        label: "uptime monitor active",
        ok:
          fs.existsSync(path.join(projectRoot, ".github", "workflows", "uptime-monitor.yml")) &&
          hasValue(opsEnv.HEALTHCHECK_PRODUCTION_FRONTEND_URL) &&
          hasValue(opsEnv.HEALTHCHECK_PRODUCTION_API_URL) &&
          hasValue(opsEnv.HEALTHCHECK_STAGING_FRONTEND_URL) &&
          hasValue(opsEnv.HEALTHCHECK_STAGING_API_URL),
        detail: "workflow file and healthcheck URLs must exist",
      },
      {
        label: "error logging active",
        ok:
          hasValue(appEnv.VITE_SENTRY_DSN) &&
          !looksLikePlaceholder("VITE_SENTRY_DSN", appEnv.VITE_SENTRY_DSN) &&
          hasValue(appEnv.SENTRY_DSN) &&
          !looksLikePlaceholder("SENTRY_DSN", appEnv.SENTRY_DSN),
        detail: "frontend and backend Sentry DSNs must be configured",
      },
      {
        label: "alert system tested",
        ok: alertStatus?.status === "success" && (toAgeDays(alertStatus.completed_at_utc) ?? Infinity) <= 30,
        detail: alertStatus?.completed_at_utc
          ? `last alert test ${toAgeDays(alertStatus.completed_at_utc)} days ago`
          : "latest alert status missing",
      },
    ]),
  );

  sections.push(
    (() => {
      const scheduledTaskChecks = ["DailyBackup", "BackupHealthCheck", "MonthlyRestoreDrill"].map((suffix) => ({
        result: queryScheduledTask(`${taskPrefix}-${suffix}`),
        taskName: `${taskPrefix}-${suffix}`,
      }));

      return buildSection("Ops System", [
      {
        label: "ops:health returns OK",
        ok: opsHealthSummary.ok === true,
        detail: opsHealthSummary.ok ? "ops health summary is healthy" : opsHealthSummary.failures.join(" "),
      },
      {
        label: "backup schedule active",
        ok: scheduledTaskChecks.every((check) => check.result.ok),
        detail: scheduledTaskChecks
          .map((check) => `${check.taskName}:${check.result.detail}`)
          .join("; "),
      },
      {
        label: "last drill PASS",
        ok: drillStatus?.status === "success",
        detail: drillStatus?.completed_at_utc || "latest restore drill status missing",
      },
      ]);
    })(),
  );

  sections.push(
    buildSection("Final Test", [
      evaluateManualCheck(manualChecks, verifiedReleaseSha, "login_works", "login works"),
      evaluateManualCheck(manualChecks, verifiedReleaseSha, "qr_scan_works", "QR scan works"),
      evaluateManualCheck(manualChecks, verifiedReleaseSha, "payment_works", "payment works"),
    ]),
  );
}

const allChecks = sections.flatMap((section) =>
  section.checks.map((check) => ({
    ...check,
    section: section.title,
  })),
);

const failures = allChecks.filter((check) => !check.ok);
const releaseTruth = envOnly ? null : buildReleaseTruth(sections);
const report = {
  checked_at_utc: new Date().toISOString(),
  failures: failures.map((failure) => `${failure.section}: ${failure.label}`),
  manual_checks_file: manualChecksPath,
  verified_release_sha: envOnly ? null : resolveVerifiedReleaseSha(readManualChecks()),
  ok: failures.length === 0,
  release_truth: releaseTruth,
  sections,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const section of sections) {
    console.log(`${section.title}: ${section.ok ? "PASS" : "FAIL"}`);
    for (const check of section.checks) {
      console.log(`- [${check.ok ? "PASS" : "FAIL"}] ${check.label}: ${check.detail}`);
    }
  }

  if (releaseTruth) {
    console.log(`Release Truth: ${releaseTruth.ok ? "PASS" : "FAIL"}`);
    console.log(
      `- [${releaseTruth.verified ? "PASS" : "FAIL"}] verified: if it cannot be verified, it is not deployed`,
    );
    console.log(
      `- [${releaseTruth.reproducible ? "PASS" : "FAIL"}] reproducible: if it is not reproducible, it is not trusted`,
    );
    console.log(
      `- [${releaseTruth.monitored ? "PASS" : "FAIL"}] monitored: if it is not monitored, it is already broken`,
    );
  }

  console.log(`Overall: ${report.ok ? "PASS" : "FAIL"}`);
  if (!report.ok) {
    console.log(`Manual checks file: ${manualChecksPath}`);
  }
}

if (strict && !report.ok) {
  process.exit(1);
}
