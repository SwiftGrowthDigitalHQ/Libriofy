import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, ".ops", "go-live-manual-checks.example.json");
const targetPath = path.join(projectRoot, ".ops", "go-live-manual-checks.json");

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const mergeTemplate = (template, current) => {
  if (!isPlainObject(template) || !isPlainObject(current)) {
    return current ?? template;
  }

  const merged = { ...template };

  for (const [key, templateValue] of Object.entries(template)) {
    if (!(key in current)) {
      continue;
    }

    const currentValue = current[key];
    merged[key] =
      isPlainObject(templateValue) && isPlainObject(currentValue)
        ? mergeTemplate(templateValue, currentValue)
        : currentValue;
  }

  return merged;
};

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Manual checks example file is missing: ${sourcePath}`);
}

fs.mkdirSync(path.dirname(targetPath), { recursive: true });

const template = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

if (!fs.existsSync(targetPath)) {
  fs.writeFileSync(targetPath, JSON.stringify(template, null, 2) + "\n");
  console.log(`Created ${targetPath}`);
} else {
  const current = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const merged = mergeTemplate(template, current);
  fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Updated ${targetPath} with the latest required fields`);
}
