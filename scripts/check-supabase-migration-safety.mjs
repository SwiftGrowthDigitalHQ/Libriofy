import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

const LEGACY_RELEASE_SAFETY_EXEMPTIONS = new Set([
  "20260309180000_library_owner_saas_subscription_system.sql",
  "20260311133000_multi_role_notifications.sql",
  "20260313120000_locker_management_system.sql",
  "20260313203000_whatsapp_renewal_reminder_system.sql",
  "20260314190000_partner_sales_system.sql",
  "20260326152000_student_photo_uploads.sql",
  "20260507143000_queue_runtime_and_billing_resilience.sql",
  "20260510170000_super_admin_auth_runtime_repair.sql",
  "20260511103000_auth_runtime_integrity_hardening.sql",
]);

const issues = [];

const pushIssue = (fileName, message) => {
  issues.push({ fileName, message });
};

const pushReleaseSafetyIssue = (fileName, message) => {
  if (LEGACY_RELEASE_SAFETY_EXEMPTIONS.has(fileName)) {
    return;
  }

  pushIssue(fileName, message);
};

const stripLineComments = (source) => source.replace(/--.*$/gm, "");

const splitTopLevel = (source) => {
  const segments = [];
  let current = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];

    if (character === "'" && !inDoubleQuote && previous !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (character === '"' && !inSingleQuote && previous !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth = Math.max(depth - 1, 0);
      } else if (character === "," && depth === 0) {
        if (current.trim()) {
          segments.push(current.trim());
        }
        current = "";
        continue;
      }
    }

    current += character;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
};

const extractFunctionParameterLists = (source) => {
  const parameterLists = [];
  const matcher = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_."]+)\s*\(/gim;
  let match = matcher.exec(source);

  while (match) {
    const functionName = match[1];
    const startIndex = matcher.lastIndex - 1;
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let parameterText = "";

    for (let index = startIndex; index < source.length; index += 1) {
      const character = source[index];
      const previous = source[index - 1];

      if (character === "'" && !inDoubleQuote && previous !== "\\") {
        inSingleQuote = !inSingleQuote;
      } else if (character === '"' && !inSingleQuote && previous !== "\\") {
        inDoubleQuote = !inDoubleQuote;
      }

      if (!inSingleQuote && !inDoubleQuote) {
        if (character === "(") {
          depth += 1;
          if (depth === 1) {
            continue;
          }
        } else if (character === ")") {
          depth -= 1;
          if (depth === 0) {
            parameterLists.push({ functionName, parameterText });
            break;
          }
        }
      }

      if (depth >= 1) {
        parameterText += character;
      }
    }

    match = matcher.exec(source);
  }

  return parameterLists;
};

const parameterHasDefault = (parameterSource) =>
  /\bDEFAULT\b/i.test(parameterSource) || /:=/.test(parameterSource) || /=\s*(?:[^=]|$)/.test(parameterSource);

for (const fileName of migrationFiles) {
  const filePath = path.join(migrationsDir, fileName);
  const source = fs.readFileSync(filePath, "utf8");
  const uncommentedSource = stripLineComments(source);

  for (const { functionName, parameterText } of extractFunctionParameterLists(uncommentedSource)) {
    const parameters = splitTopLevel(parameterText);
    let sawOptionalParameter = false;

    for (const parameterSource of parameters) {
      const normalized = parameterSource.replace(/\s+/g, " ").trim();
      if (!normalized || normalized.toUpperCase() === "VARIADIC") {
        continue;
      }

      const hasDefault = parameterHasDefault(normalized);
      if (hasDefault) {
        sawOptionalParameter = true;
        continue;
      }

      if (sawOptionalParameter) {
        pushIssue(
          fileName,
          `Function ${functionName} has a required parameter after an optional one: "${normalized}".`,
        );
        break;
      }
    }
  }

  if (/(^|[^.\w])gen_random_bytes\s*\(/im.test(uncommentedSource)) {
    pushIssue(fileName, "Use extensions.gen_random_bytes(...) instead of an unqualified gen_random_bytes(...) call.");
  }

  if (/(^|[^.\w])digest\s*\(/im.test(uncommentedSource)) {
    pushIssue(fileName, "Use extensions.digest(...) instead of an unqualified digest(...) call.");
  }

  if (/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.subscriptions\b/im.test(uncommentedSource)) {
    pushIssue(
      fileName,
      "Rebuilding public.subscriptions must use DROP VIEW IF EXISTS + CREATE VIEW to avoid column-removal conflicts.",
    );
  }

  if (/ALTER\s+TABLE[\s\S]+?\bDROP\s+COLUMN\b/im.test(uncommentedSource)) {
    pushReleaseSafetyIssue(
      fileName,
      "DROP COLUMN is not release-safe without an explicit expand/contract migration plan and rollback handling.",
    );
  }

  if (/ALTER\s+TABLE[\s\S]+?\bALTER\s+COLUMN\b[\s\S]+?\bTYPE\b/im.test(uncommentedSource)) {
    pushReleaseSafetyIssue(
      fileName,
      "ALTER COLUMN TYPE can break backward compatibility and must be isolated behind an explicit compatibility plan.",
    );
  }

  if (/ALTER\s+TABLE[\s\S]+?\bADD\s+COLUMN\b[\s\S]+?\bNOT\s+NULL\b/im.test(uncommentedSource) && !/\bDEFAULT\b/im.test(uncommentedSource)) {
    pushReleaseSafetyIssue(
      fileName,
      "Adding a NOT NULL column without a DEFAULT/backfill path is not release-safe for rolling deployments.",
    );
  }
}

if (issues.length > 0) {
  console.error("Unsafe Supabase migration patterns detected.");
  for (const issue of issues) {
    console.error(`- ${issue.fileName}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`Supabase migration safety checks passed for ${migrationFiles.length} migration files.`);
