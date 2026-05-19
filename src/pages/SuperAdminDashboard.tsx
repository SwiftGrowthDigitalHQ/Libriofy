import { useMemo } from "react";
import { AlertTriangle, BarChart3, Building2, Flag, ShieldCheck, Zap } from "lucide-react";
import RevenueChart from "@/components/dashboard/RevenueChart";
import StatsCard from "@/components/dashboard/StatsCard";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { SuperAdminSnapshotNotice } from "@/components/superAdmin/SuperAdminSnapshotNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { useControlPlane } from "@/hooks/superAdmin";
import {
  formatDateTime,
  formatInr,
  formatNumber,
  formatOperationalTimestamp,
  formatPercent,
  toBadgeVariant,
} from "@/lib/superAdmin/presentation";

const buildMonthlyChartData = (series: Array<{ date: string; totalRevenue: number }>) => {
  const byMonth = new Map<string, number>();

  series.forEach((point) => {
    if (!point.date) {
      return;
    }

    const monthKey = point.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + point.totalRevenue);
  });

  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-6)
    .map(([month, revenue]) => ({
      month: new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "short" }),
      revenue: Number(revenue.toFixed(2)),
    }));
};

const buildDailyRevenueData = (
  series: Array<{ activeLibraries: number; date: string; label: string; totalRevenue: number }>,
) => {
  const currentMonth = new Map<string, number>();
  const previousMonth = new Map<string, number>();
  const now = new Date();
  const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const previousDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousKey = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}`;

  series.forEach((point) => {
    const [year, month, day] = point.date.split("-");
    if (!year || !month || !day) {
      return;
    }

    const monthKey = `${year}-${month}`;
    if (monthKey === currentKey) {
      currentMonth.set(day, point.totalRevenue);
    } else if (monthKey === previousKey) {
      previousMonth.set(day, point.totalRevenue);
    }
  });

  return [...currentMonth.entries()].map(([day, currentMonthRevenue]) => ({
    currentMonthRevenue,
    day,
    label: day,
    previousMonthRevenue: previousMonth.get(day) ?? 0,
  }));
};

const SuperAdminDashboard = () => {
  const platformQuery = useControlPlane();

  const platform = platformQuery.data;
  const overview = platform?.analytics;
  const statusSignals = platform?.statusSignals ?? [];
  const controlPlaneError = platformQuery.error;
  const releaseGovernance = platform?.releaseGovernance;
  const evolution = releaseGovernance?.evolution;
  const releaseSimulations = releaseGovernance?.simulations ?? [];
  const activeLibrariesValue = platform
    ? formatNumber(overview?.activeLibraryCount ?? overview?.dailyActiveLibraries ?? 0)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const studentsTodayValue = platform
    ? formatNumber(overview?.activeStudentsToday ?? 0)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const revenueThisMonthValue = platform
    ? formatInr(overview?.revenueThisMonth ?? 0)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";
  const queuedJobsValue = platform
    ? formatNumber(platform.automation.queuedJobs)
    : platformQuery.isLoading
      ? "Syncing"
      : "Telemetry reconnecting";

  const monthlyRevenueData = useMemo(
    () => buildMonthlyChartData(overview?.series ?? []),
    [overview?.series],
  );
  const dailyRevenueData = useMemo(
    () => buildDailyRevenueData(overview?.series ?? []),
    [overview?.series],
  );

  const topLibraries = useMemo(
    () =>
      [...(platform?.libraries ?? [])]
        .sort((left, right) => right.monthlyRevenue - left.monthlyRevenue || right.activeStudents - left.activeStudents)
        .slice(0, 6),
    [platform?.libraries],
  );

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={(
            <Button onClick={() => void platformQuery.refetch()} variant="outline">
              Refresh snapshot
            </Button>
          )}
          description="Infrastructure-grade visibility into platform growth, reliability, and control-plane pressure."
          title="Control Plane Dashboard"
        />

        <SuperAdminSnapshotNotice
          description="Platform health snapshots refresh on demand while attendance scans, student presence, and auth continue to operate in realtime."
          generatedAt={platform?.generatedAt}
          title="Platform health snapshots refresh periodically."
        />

        {controlPlaneError && !platform ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Control-plane telemetry is temporarily unavailable</AlertTitle>
            <AlertDescription>
              {controlPlaneError.message}
            </AlertDescription>
          </Alert>
        ) : null}

        {platform && overview?.activeStudentsToday === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Attendance systems are quiet right now</AlertTitle>
            <AlertDescription>
              {overview.lastAttendanceAt
                ? `No student scans have landed today. The last successful attendance activity was ${formatOperationalTimestamp(overview.lastAttendanceAt)}.`
                : "No attendance activity has been recorded yet. Live student telemetry will appear here automatically after the first scan."}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard
            change={
              overview
                ? overview.activeSubscriptionCount && overview.activeSubscriptionCount > 0
                  ? `${formatNumber(overview.activeSubscriptionCount)} subscriptions active or trial`
                  : overview.trialLibraryCount && overview.trialLibraryCount > 0
                    ? `${formatNumber(overview.trialLibraryCount)} libraries are still in trial`
                    : "Libraries created through onboarding will appear here automatically"
                : undefined
            }
            icon={Building2}
            title="Active Libraries"
            trend="up"
            value={activeLibrariesValue}
          />
          <StatsCard
            change={
              overview
                ? overview.activeStudentsToday > 0
                  ? `${formatNumber(overview.dailyActiveLibraries)} libraries scanned today`
                  : overview.activeStudentsYesterday && overview.activeStudentsYesterday > 0
                    ? `${formatNumber(overview.activeStudentsYesterday)} students scanned yesterday`
                    : overview.lastAttendanceAt
                      ? `Last scan ${formatOperationalTimestamp(overview.lastAttendanceAt)}`
                      : "Waiting for the first attendance scan"
                : undefined
            }
            icon={BarChart3}
            title="Students Today"
            trend="up"
            value={studentsTodayValue}
          />
          <StatsCard
            change={
              overview
                ? overview.revenueThisMonth > 0
                  ? `${formatNumber(overview.approvedTransactionsThisMonth ?? 0)} approved transactions this month`
                  : overview.lastPaymentAt
                    ? `Last approved payment ${formatOperationalTimestamp(overview.lastPaymentAt)}`
                    : "Revenue analytics unlock after the first approved transaction"
                : undefined
            }
            icon={ShieldCheck}
            title="Revenue This Month"
            trend="up"
            value={revenueThisMonthValue}
          />
          <StatsCard
            change={
              platform
                ? platform.automation.failedJobs > 0
                  ? `${formatNumber(platform.automation.failedJobs)} jobs need intervention`
                  : platform.automation.queuedJobs > 0
                    ? "Background automation is flowing normally"
                    : "Automation queues are clear"
                : undefined
            }
            icon={Zap}
            title="Queued Jobs"
            trend="down"
            value={queuedJobsValue}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
          <RevenueChart
            dailyData={dailyRevenueData}
            data={monthlyRevenueData}
            subtitle="Daily control-plane revenue with previous-month comparison."
            title="Platform Revenue"
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Health Center</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {statusSignals.length > 0 ? (
                statusSignals.map((signal) => (
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
                  Telemetry is reconnecting. Live database, auth, queue, and runtime health signals will populate here automatically on the next successful sync.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Release Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {releaseGovernance ? (
              <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={toBadgeVariant(releaseGovernance?.health.status ?? "warning")}>
                {releaseGovernance.health.status} health
              </Badge>
              <Badge variant="outline">{releaseGovernance.lineage.releaseId ?? "Untracked release"}</Badge>
              <Badge variant="outline">{releaseGovernance.lineage.phase ?? "rolling"}</Badge>
              <Badge variant="outline">{releaseGovernance.lineage.channel ?? "development"}</Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Health score</p>
                <p className="mt-2 text-2xl font-bold font-display text-foreground">
                  {formatNumber(releaseGovernance?.health.score ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {releaseGovernance?.health.summary ?? "Release health unavailable."}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Schema readiness</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {releaseGovernance?.schema.readiness ?? "unknown"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pending migrations: {formatNumber(releaseGovernance?.schema.pendingMigrations.length ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rollout progress</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {formatPercent(releaseGovernance?.rollouts.progressPercentage ?? 0, 2)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(releaseGovernance?.rollouts.stagedFlags ?? 0)} staged flags
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rollback</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {releaseGovernance?.rollback.ready ? "Ready" : "Blocked"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Target {releaseGovernance?.rollback.targetReleaseId ?? "not set"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active releases</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {formatNumber(evolution?.activeReleases.length ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stale runtimes: {formatNumber(evolution?.staleRuntimeCount ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tenant evolution</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {evolution?.tenants.healthStatus ?? "unknown"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(evolution?.tenants.promotionReadyTenants ?? 0)} ready for promotion | readiness {formatNumber(evolution?.tenants.averageReadinessScore ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(evolution?.tenants.activeTenants ?? 0)} active | {formatNumber(evolution?.tenants.blockedTenants ?? 0)} blocked
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Canary lifecycle</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {evolution?.canary.lifecycle ?? "idle"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Health {formatNumber(evolution?.canary.healthScore ?? 0)} | anomalies {formatNumber(evolution?.canary.anomalyCount ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Guardrails</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {formatNumber(evolution?.guardrails.blockedRules ?? 0)} blocked
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatNumber(evolution?.guardrails.warningRules ?? 0)} warning rules
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.9fr]">
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Compatibility matrix</p>
                <div className="mt-3 space-y-2">
                  {(releaseGovernance?.compatibility ?? []).slice(0, 6).map((entry) => (
                    <div key={entry.contract} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{entry.contract.replaceAll("_", " ")}</p>
                        <p className="text-xs text-muted-foreground">{entry.detail}</p>
                      </div>
                      <Badge variant={entry.status === "incompatible" ? "destructive" : entry.status === "warning" ? "secondary" : "outline"}>
                        {entry.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Warnings and blockers</p>
                <div className="mt-3 space-y-2">
                  {(releaseGovernance?.warnings.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">No active release warnings are recorded.</p>
                  ) : (
                    (releaseGovernance?.warnings ?? []).slice(0, 6).map((warning) => (
                      <div key={warning} className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-sm text-foreground">{warning}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1.2fr_1.75fr]">
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Active release tracks</p>
                <div className="mt-3 space-y-2">
                  {(evolution?.activeReleases ?? []).slice(0, 5).map((track) => (
                    <div key={`${track.role}-${track.releaseId ?? "untracked"}`} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{track.role.replaceAll("_", " ")}</p>
                        <Badge variant={track.status === "incompatible" ? "destructive" : track.status === "warning" ? "secondary" : "outline"}>
                          {track.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {track.releaseId ?? "untracked"} | runtime {track.runtimeVersion ?? "n/a"} | schema {track.schemaVersion ?? "n/a"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{track.summary}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Tenant rollout</p>
                <div className="mt-3 space-y-2">
                  {(evolution?.tenants.records ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tenant-scoped evolution is active.</p>
                  ) : (
                    (evolution?.tenants.records ?? []).slice(0, 5).map((tenant) => (
                      <div key={tenant.tenantId} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{tenant.tenantLabel}</p>
                          <Badge variant={toBadgeVariant(tenant.healthStatus)}>{tenant.healthStatus}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {tenant.stage.replaceAll("_", " ")} | {formatPercent(tenant.rolloutPercentage, 2)} | {tenant.releaseId ?? "pending"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tenant.region ?? "No region"} | rollback {tenant.rollbackIsolated ? "isolated" : "shared"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tenant.progressionStatus.replaceAll("_", " ")} | compatibility {formatNumber(tenant.compatibilityScore)} | readiness {formatNumber(tenant.readinessScore)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Migration {tenant.migrationReadiness} | {tenant.auditLineage.join(" -> ")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Forecasts and guardrails</p>
                <div className="mt-3 space-y-2">
                  {(evolution?.forecasting.forecasts ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No forecasted evolution risks are active.</p>
                  ) : (
                    (evolution?.forecasting.forecasts ?? []).slice(0, 4).map((forecast) => (
                      <div key={forecast.id} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{forecast.title}</p>
                          <Badge variant={forecast.severity === "critical" ? "destructive" : forecast.severity === "high" ? "secondary" : "outline"}>
                            {forecast.severity}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{forecast.summary}</p>
                      </div>
                    ))
                  )}
                  {(evolution?.guardrails.rules ?? []).slice(0, 3).map((rule) => (
                    <div key={rule.key} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{rule.summary}</p>
                        <Badge variant={rule.status === "block" ? "destructive" : rule.status === "warn" ? "secondary" : "outline"}>
                          {rule.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{rule.detail}</p>
                    </div>
                  ))}
                  {releaseSimulations.slice(0, 3).map((simulation) => (
                    <div key={simulation.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{simulation.title}</p>
                        <Badge
                          variant={toBadgeVariant(
                            simulation.readiness === "blocked"
                              ? "critical"
                              : simulation.readiness === "caution"
                                ? "warning"
                                : "healthy",
                          )}
                        >
                          {simulation.readiness}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Safety {formatNumber(simulation.safetyScore)} | rollback {formatNumber(simulation.rollbackViabilityScore)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{simulation.blastRadius.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Release governance telemetry is unavailable right now, so rollback and rollout diagnostics are temporarily hidden.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Recent Incident Groups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(platform?.incidents ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No active incidents are grouped right now.</p>
              ) : (
                platform?.incidents.slice(0, 6).map((incident) => (
                  <div key={incident.incidentKey} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{incident.eventType}</p>
                        <p className="text-xs text-muted-foreground">{incident.latestMessage || incident.incidentKey}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={toBadgeVariant(incident.severity)}>{incident.severity}</Badge>
                        <Badge variant="outline">{incident.unresolvedCount} open</Badge>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Last seen {formatDateTime(incident.lastSeenAt)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Flag Rollouts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(platform?.featureFlags ?? []).slice(0, 6).map((flag) => (
                <div key={flag.key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{flag.name}</p>
                      <p className="text-xs text-muted-foreground">{flag.description || flag.key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={flag.enabled ? "default" : "destructive"}>
                        {flag.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge variant="outline">{flag.rolloutPercentage}% rollout</Badge>
                      <Badge variant="secondary">{flag.rollout.stage.replaceAll("_", " ")}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {flag.rollout.summary} • Source {flag.source} • Updated {formatDateTime(flag.updatedAt)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Top Libraries</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {topLibraries.map((library) => (
                <div key={library.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{library.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {library.city || "Unknown city"} • {library.activeStudents} students • {library.totalSeats} seats
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">{formatInr(library.monthlyRevenue)}</p>
                    <Badge variant={library.enabled ? "default" : "outline"}>
                      {library.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Attention Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-foreground">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <p className="text-sm font-medium">Critical incidents</p>
                </div>
                <p className="mt-2 text-2xl font-bold font-display text-foreground">
                  {platform?.incidents.filter((incident) => incident.severity === "CRITICAL").length ?? 0}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Grouped CRITICAL incident families awaiting action.</p>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Suspicious IPs</p>
                </div>
                <p className="mt-2 text-2xl font-bold font-display text-foreground">
                  {platform?.security.suspiciousIps.length ?? 0}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">OTP and access anomalies from the last 24 hours.</p>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-foreground">
                  <Flag className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Inactive libraries</p>
                </div>
                <p className="mt-2 text-2xl font-bold font-display text-foreground">
                  {platform?.automation.inactiveLibraries.length ?? 0}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Libraries past the current inactivity automation threshold.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDashboard;
