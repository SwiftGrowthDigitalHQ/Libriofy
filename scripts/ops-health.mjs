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
const defaultOpsEnvPath = path.join(projectRoot, ".env.ops");
const opsEnvPath = getFlagValue("--env-file") || process.env.OPS_ENV_FILE || defaultOpsEnvPath;
const logsRoot = path.resolve(projectRoot, getFlagValue("--log-dir") || "backups/logs");
const strict = hasFlag("--strict");
const remoteOnly = hasFlag("--remote-only");
const json = hasFlag("--json");

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

const mergeEnv = () => {
  const fileEnv = parseEnvFile(opsEnvPath);
  return {
    ...fileEnv,
    ...process.env,
  };
};

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const toAge = (timestamp) => {
  if (!timestamp) {
    return null;
  }

  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Number((diffMs / 1000 / 60 / 60).toFixed(2));
};

const fetchHealth = async (name, url) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    const durationMs = Date.now() - startedAt;
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      category: "endpoint",
      duration_ms: durationMs,
      name,
      ok: response.ok,
      payload,
      status: response.status,
      url,
    };
  } catch (error) {
    return {
      category: "endpoint",
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown health check failure",
      name,
      ok: false,
      status: 0,
      url,
    };
  }
};

const env = mergeEnv();

const backupStatus = remoteOnly ? null : readJson(path.join(logsRoot, "latest-backup-status.json"));
const restoreStatus = remoteOnly ? null : readJson(path.join(logsRoot, "latest-restore-status.json"));
const drillStatus = remoteOnly ? null : readJson(path.join(logsRoot, "latest-restore-drill-status.json"));
const alertStatus = remoteOnly ? null : readJson(path.join(logsRoot, "latest-alert-status.json"));

const endpointTargets = [
  ["production_frontend", env.HEALTHCHECK_PRODUCTION_FRONTEND_URL],
  ["production_api", env.HEALTHCHECK_PRODUCTION_API_URL],
  ["staging_frontend", env.HEALTHCHECK_STAGING_FRONTEND_URL],
  ["staging_api", env.HEALTHCHECK_STAGING_API_URL],
]
  .filter(([, value]) => value)
  .map(([name, value]) => [name, String(value)]);

const endpointChecks = await Promise.all(endpointTargets.map(([name, url]) => fetchHealth(name, url)));

const summary = {
  checked_at_utc: new Date().toISOString(),
  failures: [],
  overall_status: "ok",
  ok: true,
  owner: env.OPS_OWNER_NAME || "system-owner",
  endpoints: endpointChecks,
  latest_alert: alertStatus,
  latest_backup: backupStatus
    ? {
        age_hours: toAge(backupStatus.completed_at_utc),
        archive_size_bytes: backupStatus.archive_size_bytes ?? null,
        backup_name: backupStatus.backup_name ?? null,
        completed_at_utc: backupStatus.completed_at_utc ?? null,
        status: backupStatus.status ?? null,
      }
    : null,
  latest_restore: restoreStatus
    ? {
        backup_name: restoreStatus.backup_name ?? null,
        completed_at_utc: restoreStatus.completed_at_utc ?? null,
        status: restoreStatus.status ?? null,
        target: restoreStatus.target ?? null,
      }
    : null,
  latest_restore_drill: drillStatus
    ? {
        age_hours: toAge(drillStatus.completed_at_utc),
        backup_source: drillStatus.backup_source ?? null,
        completed_at_utc: drillStatus.completed_at_utc ?? null,
        status: drillStatus.status ?? null,
      }
    : null,
  logs_root: logsRoot,
};

const failures = [];

if (!remoteOnly) {
  if (!backupStatus || backupStatus.status !== "success") {
    failures.push("Latest backup status is missing or not successful.");
  }

  if (!drillStatus || drillStatus.status !== "success") {
    failures.push("Latest restore drill status is missing or not successful.");
  }
}

for (const endpoint of endpointChecks) {
  if (!endpoint.ok) {
    failures.push(`Endpoint ${endpoint.name} is unhealthy.`);
  }
}

summary.failures = failures;
summary.ok = failures.length === 0;
summary.overall_status = failures.length === 0 ? "ok" : "fail";

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Checked: ${summary.checked_at_utc}`);
  console.log(`Owner: ${summary.owner}`);

  if (!remoteOnly) {
    console.log(
      `Backup: ${summary.latest_backup?.status || "missing"} (${summary.latest_backup?.completed_at_utc || "n/a"})`,
    );
    console.log(
      `Restore drill: ${summary.latest_restore_drill?.status || "missing"} (${summary.latest_restore_drill?.completed_at_utc || "n/a"})`,
    );
    console.log(
      `Last restore: ${summary.latest_restore?.status || "missing"} (${summary.latest_restore?.completed_at_utc || "n/a"})`,
    );
  }

  if (endpointChecks.length > 0) {
    console.log("Endpoints:");
    for (const endpoint of endpointChecks) {
      console.log(`- ${endpoint.name}: ${endpoint.ok ? "ok" : "failed"} (${endpoint.url})`);
    }
  }
}

if (strict && failures.length > 0) {
  console.error(failures.join(" "));
  process.exit(1);
}
