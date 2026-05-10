import {
  resolveMissingDatabaseContracts,
  resolveMissingDatabaseEntities,
  type DatabaseHealthPayload,
} from "@/lib/observability/databaseHealth.shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";
import type { RecentObservabilitySignal } from "@/lib/observability/types";

type DatabaseHealthAlertProps = {
  errorMessage?: string | null;
  health?: DatabaseHealthPayload | null;
  viewer: "library_admin" | "super_admin";
};

const describeHealthIssue = (health: DatabaseHealthPayload, viewer: DatabaseHealthAlertProps["viewer"]) => {
  const missingEntities = resolveMissingDatabaseEntities(health).map((entity) => `public.${entity}`).join(", ");
  const missingContracts = resolveMissingDatabaseContracts(health);

  if (health.status === "failed") {
    return viewer === "super_admin"
      ? "Database connectivity or schema validation failed. Investigate Supabase credentials and schema health before continuing."
      : "Critical database validation failed. Some features may be unavailable. Contact your administrator or support immediately.";
  }

  if (missingContracts.length > 0 && missingEntities) {
    return viewer === "super_admin"
      ? `Critical auth runtime contracts and database entities are missing: ${missingContracts.join(", ")}; ${missingEntities}. Apply the latest Supabase auth migrations before continuing.`
      : "Critical auth runtime contracts and database entities are missing. Some admin tools are running in degraded mode. Contact your administrator or support.";
  }

  if (missingContracts.length > 0) {
    return viewer === "super_admin"
      ? `Critical auth runtime contracts are missing: ${missingContracts.join(", ")}. Apply the latest Supabase auth migrations before continuing.`
      : "Critical auth runtime contracts are missing. Some admin tools are running in degraded mode. Contact your administrator or support.";
  }

  if (viewer === "super_admin") {
    return `Critical database entities are missing: ${missingEntities}. Run the Supabase migration sync before continuing.`;
  }

  return `Critical database entities are missing: ${missingEntities}. Some admin tools are running in degraded mode. Contact your administrator or support.`;
};

const formatSignalTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

const formatSignalLabel = (signal: RecentObservabilitySignal, viewer: DatabaseHealthAlertProps["viewer"]) => {
  const title = viewer === "super_admin" ? `${signal.event_type}: ${signal.message || "No details recorded."}` : signal.message || signal.event_type;
  return `${title} (${formatSignalTime(signal.created_at)})`;
};

export const DatabaseHealthAlert = ({ errorMessage, health, viewer }: DatabaseHealthAlertProps) => {
  const recentCriticalErrors = health?.recent_critical_errors ?? [];
  const systemWarnings = health?.system_warnings ?? [];
  const hasSignals = recentCriticalErrors.length > 0 || systemWarnings.length > 0;

  if (!errorMessage && (!health || (health.status === "ok" && !hasSignals))) {
    return null;
  }

  const title = errorMessage
    ? "Database health monitoring is unavailable"
    : health?.status === "failed"
      ? "Database health check failed"
      : health?.status === "degraded"
        ? "Database degraded mode is active"
        : "Recent system incidents";

  const description = errorMessage
    ? "The app could not validate critical database schema state. Treat this as a deployment warning until the health endpoint is working again."
    : health
      ? health.status === "ok"
        ? "Database checks are currently passing, but recent critical incidents or warnings still need attention."
        : describeHealthIssue(health, viewer)
      : null;

  return (
    <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-950">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{description}</p>
        {recentCriticalErrors.length > 0 ? (
          <div>
            <p className="font-medium">Last critical errors</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {recentCriticalErrors.map((signal) => (
                <li key={`${signal.event_type}-${signal.created_at}`}>{formatSignalLabel(signal, viewer)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {systemWarnings.length > 0 ? (
          <div>
            <p className="font-medium">System warnings</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {systemWarnings.map((signal) => (
                <li key={`${signal.event_type}-${signal.created_at}`}>{formatSignalLabel(signal, viewer)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};
