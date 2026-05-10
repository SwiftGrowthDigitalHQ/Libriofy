import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const readEnv = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const loadEnvFile = () => {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envText = fs.readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadEnvFile();

const supabaseUrl = readEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for linked database health validation.");
  process.exit(1);
}

const criticalEntities = ["recovery_queue", "payments", "students"];
const relationChecks = [
  {
    columns: ["library_id", "student_id", "amount_due", "queue_status", "recovery_urgency_label", "last_payment_date"],
    name: "recovery_queue",
    requireRows: true,
  },
  {
    columns: ["id", "student_id", "amount", "status", "created_at"],
    name: "payments",
  },
  {
    columns: ["id", "library_id", "full_name", "phone", "seat_number"],
    name: "students",
  },
  {
    columns: ["id", "library_id", "plan_type", "whatsapp_enabled", "ai_call_enabled"],
    name: "subscriptions",
    requireRows: true,
  },
  {
    columns: ["id", "library_id", "plan_type", "whatsapp_enabled", "ai_call_enabled"],
    name: "library_subscriptions",
  },
  {
    columns: ["id", "route", "error_type", "source"],
    name: "app_error_logs",
  },
  {
    columns: ["library_id", "access_key", "rotated_at", "updated_at"],
    name: "library_access_keys",
  },
  {
    columns: ["device_id", "attempt_count", "locked_until", "updated_at"],
    name: "device_setup_attempts",
  },
  {
    columns: ["id", "device_id", "command_type", "status"],
    name: "device_commands",
  },
  {
    columns: ["id", "user_id", "login_method", "session_scope", "auth_level"],
    name: "auth_trusted_devices",
  },
];

const supabaseFetch = async (pathname, options = {}) => {
  const endpoint = new URL(pathname, supabaseUrl);
  const response = await fetch(endpoint, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
    },
    method: options.method ?? "GET",
  });

  const rawText = await response.text();

  let parsedBody = null;
  try {
    parsedBody = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsedBody = rawText;
  }

  return {
    body: parsedBody,
    ok: response.ok,
    rawText,
    status: response.status,
  };
};

const entityStatusResponse = await supabaseFetch("/rest/v1/rpc/get_schema_entity_status", {
  body: { p_entities: criticalEntities },
  method: "POST",
});

if (!entityStatusResponse.ok || !Array.isArray(entityStatusResponse.body)) {
  console.error("Critical schema entity RPC failed.");
  console.error(entityStatusResponse.rawText || `HTTP ${entityStatusResponse.status}`);
  process.exit(1);
}

const missingEntities = entityStatusResponse.body
  .filter((entry) => !entry?.exists_in_schema)
  .map((entry) => String(entry.entity_name));

if (missingEntities.length > 0) {
  console.error("Critical database entities are missing on the linked project:");
  for (const entityName of missingEntities) {
    console.error(`  - ${entityName}`);
  }
  process.exit(1);
}

const authRuntimeResponse = await supabaseFetch("/rest/v1/rpc/get_auth_runtime_status", {
  method: "POST",
});

if (!authRuntimeResponse.ok || !Array.isArray(authRuntimeResponse.body)) {
  console.error("Auth runtime health RPC failed.");
  console.error(authRuntimeResponse.rawText || `HTTP ${authRuntimeResponse.status}`);
  process.exit(1);
}

const failingAuthContracts = authRuntimeResponse.body.filter((entry) => !entry?.ok);

if (failingAuthContracts.length > 0) {
  console.error("Critical auth runtime contracts are missing on the linked project:");
  for (const contract of failingAuthContracts) {
    console.error(`  - ${String(contract.check_name)}: ${String(contract.detail || "Unknown failure")}`);
  }
  process.exit(1);
}

let failed = false;

for (const check of relationChecks) {
  const selectClause = check.columns.join(",");
  const response = await supabaseFetch(`/rest/v1/${check.name}?select=${encodeURIComponent(selectClause)}&limit=1`);
  const rowCount = Array.isArray(response.body) ? response.body.length : 0;

  if (!response.ok) {
    failed = true;
    console.error(`Linked database check failed for ${check.name}.`);
    console.error(response.rawText || `HTTP ${response.status}`);
    continue;
  }

  if (check.requireRows && rowCount === 0) {
    failed = true;
    console.error(`Linked database check expected at least one row from ${check.name}, but the query returned none.`);
  } else {
    console.log(
      `Validated ${check.name} columns (${check.columns.join(", ")})${rowCount > 0 ? ` with ${rowCount} row(s)` : " with an empty result set"}.`,
    );
  }
}

if (failed) {
  process.exit(1);
}

console.log("Linked Supabase schema health validation passed for critical tables, views, and supporting operational relations.");
