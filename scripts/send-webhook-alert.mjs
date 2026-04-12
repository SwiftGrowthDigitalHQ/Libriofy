const args = process.argv.slice(2);

const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return "";
  }

  return args[index + 1];
};

const webhookUrl = getFlagValue("--webhook") || process.env.OPS_ALERT_WEBHOOK_URL || "";
const title = getFlagValue("--title") || "Libriofy workflow alert";
const severity = getFlagValue("--severity") || "critical";
const message = getFlagValue("--message") || "A workflow reported a failure.";
const source = getFlagValue("--source") || "github-actions";

if (!webhookUrl) {
  console.log("[webhook-alert] OPS_ALERT_WEBHOOK_URL is not configured. Skipping alert.");
  process.exit(0);
}

const payload = {
  severity,
  title,
  message,
  source,
  timestamp_utc: new Date().toISOString(),
  metadata: {
    repository: process.env.GITHUB_REPOSITORY || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    ref: process.env.GITHUB_REF || null,
    sha: process.env.GITHUB_SHA || null,
  },
};

const response = await fetch(webhookUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Webhook alert failed with status ${response.status}: ${errorText}`);
}

console.log("[webhook-alert] Alert delivered.");
