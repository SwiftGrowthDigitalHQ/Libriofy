import { useMemo } from "react";
import { AlertTriangle, BarChart3, Building2, Flag, ShieldCheck, Zap } from "lucide-react";
import RevenueChart from "@/components/dashboard/RevenueChart";
import StatsCard from "@/components/dashboard/StatsCard";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { useAnalytics, useControlPlane } from "@/hooks/superAdmin";
import { formatDateTime, formatInr, formatNumber, formatPercent, toBadgeVariant } from "@/lib/superAdmin/presentation";

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
  const analyticsQuery = useAnalytics();

  const platform = platformQuery.data;
  const analytics = analyticsQuery.data;
  const releaseGovernance = platform?.releaseGovernance;

  const monthlyRevenueData = useMemo(
    () => buildMonthlyChartData(platform?.analytics.series ?? []),
    [platform?.analytics.series],
  );
  const dailyRevenueData = useMemo(
    () => buildDailyRevenueData(platform?.analytics.series ?? []),
    [platform?.analytics.series],
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
          description="Infrastructure-grade visibility into platform growth, reliability, and control-plane pressure."
          title="Control Plane Dashboard"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard
            change={`${platform?.systemStatus ?? "unknown"} system`}
            icon={Building2}
            title="Active Libraries"
            trend="up"
            value={formatNumber(platform?.analytics.dailyActiveLibraries ?? 0)}
          />
          <StatsCard
            change={`${formatPercent(platform?.analytics.conversionRate ?? 0, 2)} conversion`}
            icon={BarChart3}
            title="Students Today"
            trend="up"
            value={formatNumber(platform?.analytics.activeStudentsToday ?? 0)}
          />
          <StatsCard
            change={`Prev ${formatInr(platform?.analytics.revenuePreviousMonth ?? 0)}`}
            icon={ShieldCheck}
            title="Revenue This Month"
            trend="up"
            value={formatInr(platform?.analytics.revenueThisMonth ?? 0)}
          />
          <StatsCard
            change={`${platform?.automation.failedJobs ?? 0} failed jobs`}
            icon={Zap}
            title="Queued Jobs"
            trend="down"
            value={formatNumber(platform?.automation.queuedJobs ?? 0)}
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
              {(analytics?.healthCenter ?? platform?.statusSignals ?? []).map((signal) => (
                <div key={signal.label} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{signal.label}</p>
                    <Badge variant={toBadgeVariant(signal.status)}>{signal.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{signal.value}</p>
                  {signal.detail ? <p className="mt-1 text-xs text-muted-foreground">{signal.detail}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Release Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={toBadgeVariant(releaseGovernance?.health.status ?? "warning")}>
                {releaseGovernance?.health.status ?? "unknown"} health
              </Badge>
              <Badge variant="outline">{releaseGovernance?.lineage.releaseId ?? "Untracked release"}</Badge>
              <Badge variant="outline">{releaseGovernance?.lineage.phase ?? "rolling"}</Badge>
              <Badge variant="outline">{releaseGovernance?.lineage.channel ?? "development"}</Badge>
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
                  {analytics?.incidents.critical ?? 0}
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
