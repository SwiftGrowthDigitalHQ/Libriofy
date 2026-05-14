/**
 * External Alert Dispatcher
 * 
 * Sends critical alerts to external channels (Slack, Discord, email webhook).
 * Configure via environment variables:
 * - ALERT_SLACK_WEBHOOK_URL
 * - ALERT_DISCORD_WEBHOOK_URL
 * - ALERT_EMAIL_WEBHOOK_URL (generic webhook that accepts JSON)
 * 
 * Usage:
 *   await sendExternalAlert({ severity: "critical", title: "Redis Down", ... });
 */

type AlertSeverity = "critical" | "high" | "medium" | "low";

type ExternalAlert = {
  severity: AlertSeverity;
  title: string;
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
};

type EnvLike = Record<string, string | undefined>;

const readEnv = (env: EnvLike, key: string) => {
  const value = env[key];
  return value && value.trim() ? value.trim() : "";
};

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

const SEVERITY_COLOR: Record<AlertSeverity, number> = {
  critical: 0xff0000,
  high: 0xff8c00,
  medium: 0xffd700,
  low: 0x4169e1,
};

// Deduplication: don't send same alert within 5 minutes
const recentAlerts = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const isDuplicate = (alert: ExternalAlert): boolean => {
  const key = `${alert.severity}:${alert.title}:${alert.source ?? ""}`;
  const lastSent = recentAlerts.get(key);
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
    return true;
  }
  recentAlerts.set(key, Date.now());
  // Cleanup old entries
  if (recentAlerts.size > 100) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, v] of recentAlerts) {
      if (v < cutoff) recentAlerts.delete(k);
    }
  }
  return false;
};

const sendSlackAlert = async (webhookUrl: string, alert: ExternalAlert) => {
  const emoji = SEVERITY_EMOJI[alert.severity];
  const text = `${emoji} *[${alert.severity.toUpperCase()}] ${alert.title}*\n${alert.message}${alert.source ? `\n_Source: ${alert.source}_` : ""}`;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
};

const sendDiscordAlert = async (webhookUrl: string, alert: ExternalAlert) => {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${SEVERITY_EMOJI[alert.severity]} ${alert.title}`,
        description: alert.message,
        color: SEVERITY_COLOR[alert.severity],
        footer: { text: alert.source ?? "Libriofy" },
        timestamp: alert.timestamp ?? new Date().toISOString(),
      }],
    }),
  });
};

const sendGenericWebhookAlert = async (webhookUrl: string, alert: ExternalAlert) => {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...alert,
      timestamp: alert.timestamp ?? new Date().toISOString(),
      app: "libriofy",
    }),
  });
};

/**
 * Send an alert to all configured external channels.
 * Deduplicates identical alerts within 5 minutes.
 * Never throws — failures are logged but don't break the caller.
 */
export const sendExternalAlert = async (
  alert: ExternalAlert,
  env: EnvLike = process.env,
): Promise<void> => {
  // Only send critical/high in production to avoid noise
  const appEnv = readEnv(env, "APP_ENV") || readEnv(env, "NODE_ENV");
  if (appEnv !== "production" && appEnv !== "staging") {
    console.warn(`[alert] ${SEVERITY_EMOJI[alert.severity]} ${alert.title}: ${alert.message}`);
    return;
  }

  if (isDuplicate(alert)) {
    return;
  }

  const slackUrl = readEnv(env, "ALERT_SLACK_WEBHOOK_URL");
  const discordUrl = readEnv(env, "ALERT_DISCORD_WEBHOOK_URL");
  const genericUrl = readEnv(env, "ALERT_EMAIL_WEBHOOK_URL");

  const dispatches: Promise<void>[] = [];

  if (slackUrl) dispatches.push(sendSlackAlert(slackUrl, alert).catch(() => {}));
  if (discordUrl) dispatches.push(sendDiscordAlert(discordUrl, alert).catch(() => {}));
  if (genericUrl) dispatches.push(sendGenericWebhookAlert(genericUrl, alert).catch(() => {}));

  if (dispatches.length === 0) {
    // No external channels configured — log to console as fallback
    console.error(`[ALERT:${alert.severity}] ${alert.title}: ${alert.message}`);
    return;
  }

  await Promise.allSettled(dispatches);
};

/**
 * Pre-built alert helpers for common scenarios
 */
export const alerts = {
  redisDown: (error: string, env?: EnvLike) =>
    sendExternalAlert({ severity: "critical", title: "Redis Disconnected", message: `Redis connection failed: ${error}`, source: "redis" }, env),

  paymentWebhookFailed: (orderId: string, error: string, env?: EnvLike) =>
    sendExternalAlert({ severity: "critical", title: "Payment Webhook Failed", message: `Order ${orderId}: ${error}`, source: "razorpay-webhook" }, env),

  authSystemDown: (error: string, env?: EnvLike) =>
    sendExternalAlert({ severity: "critical", title: "Auth System Failure", message: error, source: "auth" }, env),

  highErrorRate: (route: string, rate: number, env?: EnvLike) =>
    sendExternalAlert({ severity: "high", title: "High Error Rate", message: `${route}: ${rate}% error rate in last 5 minutes`, source: "api" }, env),

  slowQuery: (route: string, durationMs: number, env?: EnvLike) =>
    sendExternalAlert({ severity: "medium", title: "Slow API Response", message: `${route} took ${durationMs}ms`, source: "performance" }, env),

  queueBacklog: (queueSize: number, env?: EnvLike) =>
    sendExternalAlert({ severity: "high", title: "Queue Backlog Growing", message: `${queueSize} jobs waiting in queue`, source: "bullmq" }, env),

  subscriptionExpired: (libraryId: string, env?: EnvLike) =>
    sendExternalAlert({ severity: "low", title: "Subscription Expired", message: `Library ${libraryId} subscription expired`, source: "billing" }, env),
};
