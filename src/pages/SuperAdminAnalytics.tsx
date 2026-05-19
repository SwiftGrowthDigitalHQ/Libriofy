import { useDeferredValue, useState } from "react";
import { AlertTriangle } from "lucide-react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { SuperAdminSnapshotNotice } from "@/components/superAdmin/SuperAdminSnapshotNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useControlPlane } from "@/hooks/superAdmin";
import { SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED } from "@/lib/superAdmin/lightweightMode";
import {
  formatInr,
  formatNumber,
  formatOperationalTimestamp,
  formatPercent,
  toBadgeVariant,
} from "@/lib/superAdmin/presentation";
import type { AdminOperationalIntelligenceSnapshot } from "@/lib/superAdmin/types";

const describeSystemStatus = (status?: string | null) => {
  if (status === "green") {
    return "Healthy";
  }

  if (status === "yellow") {
    return "Degraded";
  }

  if (status === "red") {
    return "Critical";
  }

  return "Telemetry reconnecting";
};

const SuperAdminAnalytics = () => {
  const [cityInput, setCityInput] = useState("");
  const deferredCity = useDeferredValue(cityInput.trim());
  const platformQuery = useControlPlane();

  const platform = platformQuery.data;
  const overview = platform?.analytics;
  const healthCenter = platform?.statusSignals ?? [];
  const operationalIntelligence: AdminOperationalIntelligenceSnapshot | null = null;
  const systemStatus = platform?.systemStatus;
  const security = platform?.security;
  const controlPlaneError = platformQuery.error;
  const revenueRows = (platform?.analytics.revenueByCity ?? []).filter((point) => {
    const normalizedSearch = deferredCity.toLowerCase();
    if (!normalizedSearch) {
      return true;
    }

    return [point.city, point.state].some((value) => value.toLowerCase().includes(normalizedSearch));
  });
  const systemStatusLabel = describeSystemStatus(systemStatus);
  const dailyActiveLibrariesValue = overview
    ? formatNumber(overview.dailyActiveLibraries)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const studentsTodayValue = overview
    ? formatNumber(overview.activeStudentsToday)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const conversionValue = overview
    ? formatPercent(overview.conversionRate, 2)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const securityFailedLoginsValue = security
    ? formatNumber(security.failedLoginAttempts24h)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={(
            <Button onClick={() => void platformQuery.refetch()} variant="outline">
              Refresh snapshot
            </Button>
          )}
          description="Platform-wide growth, monetization, delivery, and health analytics through the centralized control-plane API."
          title="Analytics"
        />

        <SuperAdminSnapshotNotice
          description="Platform-wide analytics are served from cached control-plane snapshots so attendance and auth remain protected from admin analytics fanout."
          generatedAt={platform?.generatedAt}
          title="Operational analytics running in lightweight mode."
        />

        {controlPlaneError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Analytics aggregation is temporarily degraded</AlertTitle>
            <AlertDescription>
              {controlPlaneError.message}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ControlPlaneCard title="Daily active libraries">
            <p className="text-2xl font-bold font-display text-foreground">{dailyActiveLibrariesValue}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {overview
                ? overview.dailyActiveLibraries > 0
                  ? `${formatNumber(overview.activeStudentsToday)} students have already scanned today.`
                  : overview.attendanceLibrariesYesterday && overview.attendanceLibrariesYesterday > 0
                    ? `${formatNumber(overview.attendanceLibrariesYesterday)} libraries were active yesterday.`
                    : overview.lastAttendanceAt
                      ? `Last attendance activity ${formatOperationalTimestamp(overview.lastAttendanceAt)}.`
                      : "Waiting for the first attendance activity."
                : "Daily activity telemetry is syncing."}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Students today">
            <p className="text-2xl font-bold font-display text-foreground">{studentsTodayValue}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {overview
                ? overview.activeStudentsToday > 0
                  ? `${formatNumber(overview.dailyActiveLibraries)} libraries are reporting live attendance today.`
                  : overview.activeStudentsYesterday && overview.activeStudentsYesterday > 0
                    ? `${formatNumber(overview.activeStudentsYesterday)} students were seen yesterday.`
                    : "No student scans have landed today yet."
                : "Student telemetry is syncing."}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Conversion rate">
            <p className="text-2xl font-bold font-display text-foreground">{conversionValue}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {overview
                ? overview.conversionRate > 0
                  ? `${formatNumber(overview.activeSubscriptionCount ?? 0)} subscribed libraries out of ${formatNumber(overview.activeLibraryCount ?? 0)} active libraries.`
                  : "No onboarding conversions have been recorded yet."
                : "Conversion telemetry is syncing."}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="System status">
            <Badge variant={toBadgeVariant(systemStatus ?? "warning")}>{systemStatusLabel}</Badge>
            <p className="mt-2 text-sm text-muted-foreground">
              {healthCenter.length > 0
                ? `${healthCenter.filter((signal) => signal.status === "green").length} healthy signals, ${healthCenter.filter((signal) => signal.status !== "green").length} needing attention.`
                : "Operational health signals are reconnecting."}
            </p>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
          <ControlPlaneCard title="Revenue by city">
            <div className="space-y-4">
              <Input
                onChange={(event) => setCityInput(event.target.value)}
                placeholder="Filter by city or state"
                value={cityInput}
              />
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>City</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Libraries</TableHead>
                      <TableHead>Transactions</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueRows.length > 0 ? (
                      revenueRows.map((point) => (
                        <TableRow key={`${point.state}-${point.city}`}>
                          <TableCell>{point.city}</TableCell>
                          <TableCell>{point.state}</TableCell>
                          <TableCell>{formatNumber(point.libraries)}</TableCell>
                          <TableCell>{formatNumber(point.transactionCount)}</TableCell>
                          <TableCell>{formatInr(point.totalRevenue)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell className="py-8 text-sm text-muted-foreground" colSpan={5}>
                          {deferredCity
                            ? `No revenue snapshot rows match "${deferredCity}" yet.`
                            : "Revenue analytics will appear here after the first approved transactions land."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Health center">
            <div className="space-y-3">
              {healthCenter.length > 0 ? (
                healthCenter.map((signal) => (
                  <div key={signal.label} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{signal.label}</p>
                      <Badge variant={toBadgeVariant(signal.status)}>{signal.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{signal.value}</p>
                    {signal.detail ? <p className="mt-1 text-xs text-muted-foreground">{signal.detail}</p> : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Telemetry is reconnecting. Database, queue, deployment, and auth health will populate automatically after the next successful sync.
                </p>
              )}
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ControlPlaneCard title="Communication">
            <p className="text-sm text-muted-foreground">
              Realtime telemetry temporarily paused to preserve platform performance. Delivery analytics refresh on demand.
            </p>
          </ControlPlaneCard>

          <ControlPlaneCard title="Billing pulse">
            <p className="text-sm text-muted-foreground">
              Billing analytics are in lightweight mode. Use the billing console to refresh a current snapshot only when needed.
            </p>
          </ControlPlaneCard>

          <ControlPlaneCard title="Security pulse">
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Failed logins (24h)</p>
              <p className="text-2xl font-bold font-display text-foreground">{securityFailedLoginsValue}</p>
              <p className="text-muted-foreground">
                {security
                  ? security.suspiciousIps.length > 0
                    ? `Suspicious IPs: ${formatNumber(security.suspiciousIps.length)}`
                    : "No suspicious IPs are elevated right now."
                  : "Security telemetry is syncing."}
              </p>
              <p className="text-muted-foreground">
                {security
                  ? `IP whitelist: ${security.ipWhitelistEnabled ? "Enabled" : "Disabled"}`
                  : "IP access controls are syncing."}
              </p>
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ControlPlaneCard title="Governance flow">
            <p className="text-sm text-muted-foreground">
              Live governance monitoring temporarily reduced. Manual refresh is available whenever an operator needs a fresh audit snapshot.
            </p>
          </ControlPlaneCard>

          <ControlPlaneCard title="Operational coordination">
            <p className="text-sm text-muted-foreground">
              Cross-team operational coordination widgets are paused in lightweight mode to prevent platform-wide invalidation storms.
            </p>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_1fr]">
          <ControlPlaneCard title="Operational intelligence">
            <div className="space-y-3">
              {SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED ? (
                <p className="text-sm text-muted-foreground">
                  Predictive analytics are paused here so cached attendance and auth workloads keep priority on Nano compute.
                </p>
              ) : null}
              {(operationalIntelligence?.predictions ?? []).slice(0, 5).map((prediction) => (
                <div key={prediction.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{prediction.title}</p>
                      <p className="text-xs text-muted-foreground">{prediction.summary}</p>
                    </div>
                    <Badge variant={toBadgeVariant(prediction.severity)}>{prediction.severity}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Confidence {formatPercent(prediction.confidencePercent, 0)}</span>
                    <span>Horizon {formatNumber(prediction.horizonMinutes)} min</span>
                    <span>Signal {prediction.signal}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {(prediction.evidence ?? []).slice(0, 2).join(" ") || "No leading indicators captured."}
                  </p>
                </div>
              ))}
              {!SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED && (operationalIntelligence?.predictions ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No predictive risks are elevated right now.</p>
              ) : null}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Governance health">
            <div className="space-y-3">
              {SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED ? (
                <p className="text-sm text-muted-foreground">
                  Governance health scoring is temporarily reduced. Snapshot-based controls remain available in Settings.
                </p>
              ) : null}
              {(operationalIntelligence?.governanceHealth ?? []).map((score) => (
                <div key={score.key} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{score.label}</p>
                    <Badge variant={toBadgeVariant(score.status)}>{score.status}</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-bold font-display text-foreground">{formatNumber(score.score)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{score.summary}</p>
                </div>
              ))}
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ControlPlaneCard title="Adaptive routing">
            <div className="space-y-3 text-sm">
              {SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED ? (
                <p className="text-muted-foreground">
                  Adaptive routing is paused. Incident responders should use manual review until full analytics are re-enabled.
                </p>
              ) : null}
              {(operationalIntelligence?.routingRecommendations ?? []).slice(0, 4).map((recommendation) => (
                <div key={recommendation.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{recommendation.recommendedResponder || "Manual review"}</p>
                      <p className="text-xs text-muted-foreground">
                        {recommendation.incidentKey || recommendation.targetId || "Operational route"}
                      </p>
                    </div>
                    <Badge variant={toBadgeVariant(recommendation.severity)}>{recommendation.severity}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Route: {recommendation.recommendedRoute.join(" -> ") || "No route synthesized"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Workload {formatNumber(recommendation.workloadScore)}</span>
                    <span>Timezone {formatNumber(recommendation.timezoneScore)}</span>
                    <span>Region {formatNumber(recommendation.regionHealthScore)}</span>
                  </div>
                </div>
              ))}
              {!SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED && (operationalIntelligence?.routingRecommendations ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No adaptive reroutes are needed right now.</p>
              ) : null}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Simulation readiness">
            <div className="space-y-3 text-sm">
              {SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED ? (
                <p className="text-muted-foreground">
                  Release and failover simulations are paused on this dashboard while the platform recovers Nano headroom.
                </p>
              ) : null}
              {(operationalIntelligence?.simulations ?? []).map((simulation) => (
                <div key={simulation.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{simulation.title}</p>
                    <Badge variant={toBadgeVariant(simulation.readiness)}>{simulation.readiness}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{simulation.summary}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Expected outcome: {simulation.expectedOutcome}</p>
                </div>
              ))}
            </div>
          </ControlPlaneCard>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminAnalytics;
