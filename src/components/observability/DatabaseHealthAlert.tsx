import { resolveMissingDatabaseEntities, type DatabaseHealthPayload } from "@/lib/observability/databaseHealth.shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

type DatabaseHealthAlertProps = {
  errorMessage?: string | null;
  health?: DatabaseHealthPayload | null;
  viewer: "library_admin" | "super_admin";
};

const describeHealthIssue = (health: DatabaseHealthPayload, viewer: DatabaseHealthAlertProps["viewer"]) => {
  const missingEntities = resolveMissingDatabaseEntities(health).map((entity) => `public.${entity}`).join(", ");

  if (health.status === "failed") {
    return viewer === "super_admin"
      ? "Database connectivity or schema validation failed. Investigate Supabase credentials and schema health before continuing."
      : "Critical database validation failed. Some features may be unavailable. Contact your administrator or support immediately.";
  }

  if (viewer === "super_admin") {
    return `Critical database entities are missing: ${missingEntities}. Run the Supabase migration sync before continuing.`;
  }

  return `Critical database entities are missing: ${missingEntities}. Some admin tools are running in degraded mode. Contact your administrator or support.`;
};

export const DatabaseHealthAlert = ({ errorMessage, health, viewer }: DatabaseHealthAlertProps) => {
  if (!errorMessage && (!health || health.status === "ok")) {
    return null;
  }

  const title = errorMessage
    ? "Database health monitoring is unavailable"
    : health?.status === "failed"
      ? "Database health check failed"
      : "Database degraded mode is active";

  const description = errorMessage
    ? "The app could not validate critical database schema state. Treat this as a deployment warning until the health endpoint is working again."
    : health
      ? describeHealthIssue(health, viewer)
      : null;

  return (
    <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-950">
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
};
