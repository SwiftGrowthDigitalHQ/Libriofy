import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const migrationsDir = path.join(projectRoot, "supabase", "migrations");
const typesPath = path.join(projectRoot, "src", "integrations", "supabase", "types.ts");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractBraceBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find marker: ${marker}`);
  }

  const braceStart = source.indexOf("{", markerIndex + marker.length - 1);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace after marker: ${marker}`);
  }

  let depth = 0;

  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(braceStart + 1, index);
      }
    }
  }

  throw new Error(`Could not find closing brace for marker: ${marker}`);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function collectMatches(source, expression) {
  return uniqueSorted([...source.matchAll(expression)].map((match) => match[1]));
}

function formatList(values) {
  return values.map((value) => `  - ${value}`).join("\n");
}

function collectTypeSnapshot() {
  const typesSource = readFile(typesPath);
  const publicBlock = extractBraceBlock(typesSource, "public: {");

  return {
    tables: collectMatches(
      extractBraceBlock(publicBlock, "Tables: {"),
      /^\s{6}([a-zA-Z0-9_]+): \{$/gm,
    ),
    views: collectMatches(
      extractBraceBlock(publicBlock, "Views: {"),
      /^\s{6}([a-zA-Z0-9_]+): \{$/gm,
    ),
    enums: collectMatches(
      extractBraceBlock(publicBlock, "Enums: {"),
      /^\s{6}([a-zA-Z0-9_]+):/gm,
    ),
  };
}

function collectMigrationSchema() {
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  const combinedSql = migrationFiles
    .map((fileName) => readFile(path.join(migrationsDir, fileName)))
    .join("\n");

  return {
    tables: collectMatches(
      combinedSql,
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gim,
    ),
    views: collectMatches(
      combinedSql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.([a-zA-Z0-9_]+)/gim,
    ),
    enums: collectMatches(
      combinedSql,
      /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)\s+AS\s+ENUM/gim,
    ),
  };
}

function diff(sourceOfTruth, snapshot) {
  return {
    missingFromTypes: sourceOfTruth.filter((name) => !snapshot.includes(name)),
    extraInTypes: snapshot.filter((name) => !sourceOfTruth.includes(name)),
  };
}

function collectDriftReport() {
  const migrations = collectMigrationSchema();
  const snapshot = collectTypeSnapshot();

  return {
    tables: diff(migrations.tables, snapshot.tables),
    views: diff(migrations.views, snapshot.views),
    enums: diff(migrations.enums, snapshot.enums),
  };
}

function hasDrift(report) {
  return Object.values(report).some(
    (entry) => entry.missingFromTypes.length > 0 || entry.extraInTypes.length > 0,
  );
}

function printDriftReport(report) {
  console.error("Supabase schema/type drift detected.");
  console.error("Migrations are the source of truth. Update src/integrations/supabase/types.ts.");

  for (const [section, entry] of Object.entries(report)) {
    if (entry.missingFromTypes.length === 0 && entry.extraInTypes.length === 0) {
      continue;
    }

    console.error(`\n${section.toUpperCase()}`);

    if (entry.missingFromTypes.length > 0) {
      console.error("Missing from generated types:");
      console.error(formatList(entry.missingFromTypes));
    }

    if (entry.extraInTypes.length > 0) {
      console.error("Present in generated types but missing from migrations:");
      console.error(formatList(entry.extraInTypes));
    }
  }
}

const driftReport = collectDriftReport();

if (hasDrift(driftReport)) {
  printDriftReport(driftReport);
  process.exit(1);
}

console.log("Supabase schema snapshot is in sync with migrations for public tables, views, and enums.");
