import { useMemo, useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuperAdminSnapshotNotice } from "@/components/superAdmin/SuperAdminSnapshotNotice";
import { useAutomationJobs, useControlPlane, useSecurity } from "@/hooks/superAdmin";
import {
  SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED,
  resolveSuperAdminSnapshotRefresh,
} from "@/lib/superAdmin/lightweightMode";
import { formatDateTime, formatNumber, formatPercent, toBadgeVariant } from "@/lib/superAdmin/presentation";
import type { AdminRuntimeTraceEvent } from "@/lib/superAdmin/types";

const matchesTraceSearch = (event: AdminRuntimeTraceEvent, search: string) => {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return [
    event.type,
    event.status,
    event.source,
    event.message,
    event.actorEmail,
    event.requestId,
    event.correlationId,
    event.traceId,
    event.queueJobId,
    event.paymentReference,
    event.incidentKey,
    JSON.stringify(event.metadata ?? {}),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedSearch));
};

const SuperAdminObservability = () => {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED);
  const [search, setSearch] = useState("");
  const [selectedTrace, setSelectedTrace] = useState<AdminRuntimeTraceEvent | null>(null);

  const refetchIntervalMs = resolveSuperAdminSnapshotRefresh(autoRefreshEnabled);
  const securityQuery = useSecurity({ refetchIntervalMs });
  const jobsQuery = useAutomationJobs<"overview">({ refetchIntervalMs });
  const platformQuery = useControlPlane(refetchIntervalMs);

  const traceFeed = useMemo(
    () => (securityQuery.data?.traceFeed ?? []).filter((event) => matchesTraceSearch(event, search)),
    [search, securityQuery.data?.traceFeed],
  );
  const alerts = useMemo(
    () => (securityQuery.data?.alerts ?? []).filter((event) => matchesTraceSearch(event, search)),
    [search, securityQuery.data?.alerts],
  );
  const slowRequests = useMemo(
    () => (securityQuery.data?.slowRequests ?? []).filter((event) => matchesTraceSearch(event, search)),
    [search, securityQuery.data?.slowRequests],
  );
  const operatorActions = useMemo(
    () => (securityQuery.data?.operatorActions ?? []).filter((event) => matchesTraceSearch(event, search)),
    [search, securityQuery.data?.operatorActions],
  );
  const operatorTimeline = useMemo(
    () =>
      (securityQuery.data?.operatorTimeline ?? []).filter((entry) =>
        matchesTraceSearch(
          {
            actorEmail: entry.actorEmail,
            correlationId: entry.correlationId,
            entityId: entry.targetType,
            id: entry.id,
            incidentKey: entry.incidentKey,
            message: entry.targetDisplay,
            metadata: entry.metadata,
            occurredAt: entry.occurredAt,
            paymentReference: entry.paymentReference,
            queueJobId: entry.queueJobId,
            requestId: entry.requestId,
            severity: entry.severity,
            source: entry.source,
            status: "SUCCESS",
            traceId: entry.traceId,
            type: entry.action,
          },
          search,
        ),
      ),
    [search, securityQuery.data?.operatorTimeline],
  );

  const runtime = securityQuery.data?.runtimeVisibility;
  const queueSummary = jobsQuery.data?.data.summary;
  const releaseGovernance = platformQuery.data?.releaseGovernance;
  const evolution = releaseGovernance?.evolution;
  const releaseSimulations = releaseGovernance?.simulations ?? [];

  const handleRefresh = async () => {
    await Promise.all([
      securityQuery.refetch(),
      jobsQuery.refetch(),
      platformQuery.refetch(),
    ]);
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={(
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Auto-refresh</span>
                <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
              </div>
              <Button onClick={() => void handleRefresh()} variant="outline">
                Refresh now
              </Button>
            </>
          )}
          description="Live queue, request, payment, and operator activity state sourced directly from runtime metrics, audit logs, and event traces."
          title="Observability"
        />

        <SuperAdminSnapshotNotice
          description="Realtime telemetry is paused for super-admin observability while attendance scans, presence, and auth continue to run live."
          generatedAt={platformQuery.data?.generatedAt ?? securityQuery.data?.generatedAt}
          refreshIntervalMs={refetchIntervalMs}
          title="Realtime telemetry temporarily paused to preserve platform performance."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <ControlPlaneCard title="Queue lag">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(Math.round(runtime?.queueLagMs ?? 0))} ms
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Active workers: {formatNumber(runtime?.activeWorkers ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Dead letters">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(runtime?.deadLetterJobs ?? 0)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Retries observed: {formatNumber(runtime?.retryCount ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="API latency">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(runtime?.apiLatencyP95Ms ?? 0)} ms
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Slow requests: {formatNumber(runtime?.slowRequests ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Payment retry rate">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatPercent(runtime?.paymentRetryRate ?? 0, 2)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Queue latency p95: {formatNumber(runtime?.queueLatencyP95Ms ?? 0)} ms
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Dependency state">
            <Badge variant={runtime?.redisDegraded ? "destructive" : "default"}>
              {runtime?.redisDegraded ? "Redis degraded" : "Redis healthy"}
            </Badge>
            <p className="mt-3 text-sm text-muted-foreground">
              Email failures: {formatPercent(runtime?.emailFailureRate ?? 0, 2)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              OTP failures: {formatNumber(runtime?.otpDeliveryFailures ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Release health">
            <Badge variant={toBadgeVariant(releaseGovernance?.health.status ?? "warning")}>
              {releaseGovernance?.health.status ?? "unknown"}
            </Badge>
            <p className="mt-3 text-2xl font-bold font-display text-foreground">
              {formatNumber(releaseGovernance?.health.score ?? 0)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {releaseGovernance?.lineage.phase ?? "rolling"} • {releaseGovernance?.lineage.releaseId ?? "untracked"}
            </p>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Operational summary">
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Critical incidents</span>
                <span className="font-medium text-foreground">
                  {formatNumber(runtime?.incidentSeverityCounts.critical ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Error incidents</span>
                <span className="font-medium text-foreground">
                  {formatNumber(runtime?.incidentSeverityCounts.error ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Queued jobs</span>
                <span className="font-medium text-foreground">
                  {formatNumber(queueSummary?.queuedJobs ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Paused queue</span>
                <Badge variant={queueSummary?.paused ? "destructive" : "default"}>
                  {queueSummary?.paused ? "Paused" : "Running"}
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Active sessions</span>
                <span className="font-medium text-foreground">
                  {formatNumber(securityQuery.data?.activeSessions ?? 0)}
                </span>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Trace console">
            <div className="space-y-4">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by event type, request ID, trace ID, job ID, payment reference, or metadata"
                value={search}
              />

              <Tabs defaultValue="alerts">
                <TabsList>
                  <TabsTrigger value="alerts">Alerts</TabsTrigger>
                  <TabsTrigger value="slow">Slow Requests</TabsTrigger>
                  <TabsTrigger value="trace">Trace Feed</TabsTrigger>
                  <TabsTrigger value="timeline">Operator Timeline</TabsTrigger>
                  <TabsTrigger value="operators">Operator Actions</TabsTrigger>
                  <TabsTrigger value="access">Access</TabsTrigger>
                </TabsList>

                <TabsContent value="alerts">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Alert</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Occurred</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alerts.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{event.type}</p>
                                <p className="text-xs text-muted-foreground">{event.message || "Active runtime alert"}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(event.severity || event.status)}>{event.severity || event.status}</Badge>
                            </TableCell>
                            <TableCell>{formatDateTime(event.occurredAt)}</TableCell>
                            <TableCell className="text-right">
                              <Button onClick={() => setSelectedTrace(event)} size="sm" variant="outline">
                                Drill down
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="slow">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Request</TableHead>
                          <TableHead>Route</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {slowRequests.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell>{event.requestId || event.id}</TableCell>
                            <TableCell>{String(event.metadata.route || event.metadata.request_path || "unknown")}</TableCell>
                            <TableCell>{formatNumber(Number(event.metadata.duration_ms || 0))} ms</TableCell>
                            <TableCell className="text-right">
                              <Button onClick={() => setSelectedTrace(event)} size="sm" variant="outline">
                                Inspect
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="trace">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Occurred</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {traceFeed.map((event) => (
                          <TableRow key={`${event.source}-${event.id}`}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{event.type}</p>
                                <p className="text-xs text-muted-foreground">{event.message || "No event message recorded."}</p>
                              </div>
                            </TableCell>
                            <TableCell>{event.source}</TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(event.severity || event.status)}>{event.severity || event.status}</Badge>
                            </TableCell>
                            <TableCell>{formatDateTime(event.occurredAt)}</TableCell>
                            <TableCell className="text-right">
                              <Button onClick={() => setSelectedTrace(event)} size="sm" variant="outline">
                                Trace
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="operators">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Actor</TableHead>
                          <TableHead>Request</TableHead>
                          <TableHead>Occurred</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {operatorActions.map((event) => (
                          <TableRow key={event.id} onClick={() => setSelectedTrace(event)}>
                            <TableCell>{event.type}</TableCell>
                            <TableCell>{event.actorEmail || "system"}</TableCell>
                            <TableCell>{event.requestId || event.traceId || "n/a"}</TableCell>
                            <TableCell>{formatDateTime(event.occurredAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="timeline">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Actor</TableHead>
                          <TableHead>Target</TableHead>
                          <TableHead>Incident</TableHead>
                          <TableHead>Trace</TableHead>
                          <TableHead>Correlation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {operatorTimeline.map((entry) => (
                          <TableRow
                            key={entry.id}
                            onClick={() =>
                              setSelectedTrace({
                                actorEmail: entry.actorEmail,
                                correlationId: entry.correlationId,
                                entityId: entry.targetType,
                                id: entry.id,
                                incidentKey: entry.incidentKey,
                                message: entry.targetDisplay,
                                metadata: entry.metadata,
                                occurredAt: entry.occurredAt,
                                paymentReference: entry.paymentReference,
                                queueJobId: entry.queueJobId,
                                requestId: entry.requestId,
                                severity: entry.severity,
                                source: entry.source,
                                status: "SUCCESS",
                                traceId: entry.traceId,
                                type: entry.action,
                              })
                            }
                          >
                            <TableCell>{entry.action}</TableCell>
                            <TableCell>{entry.actorEmail || "system"}</TableCell>
                            <TableCell>{entry.targetDisplay || entry.targetType || "n/a"}</TableCell>
                            <TableCell>{entry.incidentKey || "n/a"}</TableCell>
                            <TableCell>{entry.traceId || entry.requestId || "n/a"}</TableCell>
                            <TableCell>{entry.correlationId || "n/a"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="access">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Message</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Occurred</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {securityQuery.data?.recentAccessLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>{log.message}</TableCell>
                            <TableCell>{String(log.metadata.email || "n/a")}</TableCell>
                            <TableCell>{String(log.metadata.reason || "n/a")}</TableCell>
                            <TableCell>{formatDateTime(log.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.05fr_1.9fr]">
          <ControlPlaneCard title="Release compatibility">
            <div className="space-y-3">
              {(releaseGovernance?.compatibility ?? []).map((entry) => (
                <div key={entry.contract} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{entry.contract.replaceAll("_", " ")}</p>
                    <Badge variant={entry.status === "incompatible" ? "destructive" : entry.status === "warning" ? "secondary" : "outline"}>
                      {entry.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{entry.detail}</p>
                </div>
              ))}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Evolution oversight">
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Canary</p>
                  <Badge variant={toBadgeVariant(evolution?.canary.healthStatus ?? "warning")}>
                    {evolution?.canary.lifecycle ?? "idle"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Health {formatNumber(evolution?.canary.healthScore ?? 0)} • anomalies {formatNumber(evolution?.canary.anomalyCount ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Stale runtimes</p>
                  <Badge variant={(evolution?.staleRuntimeCount ?? 0) > 0 ? "destructive" : "outline"}>
                    {formatNumber(evolution?.staleRuntimeCount ?? 0)}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Guardrails: {formatNumber(evolution?.guardrails.blockedRules ?? 0)} blocked • {formatNumber(evolution?.guardrails.warningRules ?? 0)} warning
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Tenants</p>
                  <Badge variant={toBadgeVariant(evolution?.tenants.healthStatus ?? "warning")}>
                    {evolution?.tenants.healthStatus ?? "unknown"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatNumber(evolution?.tenants.promotionReadyTenants ?? 0)} ready | compatibility {formatNumber(evolution?.tenants.averageCompatibilityScore ?? 0)} | readiness {formatNumber(evolution?.tenants.averageReadinessScore ?? 0)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatNumber(evolution?.tenants.activeTenants ?? 0)} active • {formatNumber(evolution?.tenants.blockedTenants ?? 0)} blocked • {formatNumber(evolution?.tenants.canaryTenants ?? 0)} canary
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Forecasts</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(evolution?.forecasting.forecasts ?? []).length === 0
                    ? "No active evolution forecasts."
                    : `${evolution?.forecasting.forecasts.length ?? 0} active forecasted risk signals.`}
                </p>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Release forensics">
            <div className="space-y-3">
              {(releaseGovernance?.forensics.events ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No release forensics events are recorded yet.</p>
              ) : (
                (releaseGovernance?.forensics.events ?? []).slice(0, 8).map((event) => (
                  <div key={`${event.type}-${event.occurredAt}-${event.summary}`} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{event.summary}</p>
                        <p className="text-xs text-muted-foreground">{event.detail}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant={event.severity === "critical" ? "destructive" : event.severity === "high" ? "secondary" : "outline"}>
                          {event.severity}
                        </Badge>
                        <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Rollout chain</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(releaseGovernance?.forensics.rolloutChain ?? []).join(" -> ") || "No rollout chain recorded."}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Rollback chain</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(releaseGovernance?.forensics.rollbackChain ?? []).join(" -> ") || "No rollback chain recorded."}
                </p>
              </div>
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.2fr_1.75fr]">
          <ControlPlaneCard title="Active releases">
            <div className="space-y-3">
              {(evolution?.activeReleases ?? []).slice(0, 6).map((track) => (
                <div key={`${track.role}-${track.releaseId ?? "unknown"}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{track.role.replaceAll("_", " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {track.releaseId ?? "untracked"} • runtime {track.runtimeVersion ?? "n/a"} • schema {track.schemaVersion ?? "n/a"}
                      </p>
                    </div>
                    <Badge variant={track.status === "incompatible" ? "destructive" : track.status === "warning" ? "secondary" : "outline"}>
                      {track.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Tenant rollout">
            <div className="space-y-3">
              {(evolution?.tenants.records ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tenant rollout records are active.</p>
              ) : (
                (evolution?.tenants.records ?? []).slice(0, 6).map((tenant) => (
                  <div key={tenant.tenantId} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{tenant.tenantLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {tenant.stage.replaceAll("_", " ")} • {formatPercent(tenant.rolloutPercentage, 2)} • {tenant.releaseId ?? "pending"}
                        </p>
                      </div>
                      <Badge variant={toBadgeVariant(tenant.healthStatus)}>{tenant.healthStatus}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {tenant.progressionStatus.replaceAll("_", " ")} | compatibility {formatNumber(tenant.compatibilityScore)} | readiness {formatNumber(tenant.readinessScore)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Migration {tenant.migrationReadiness} | rollback {tenant.rollbackIsolated ? "isolated" : "shared"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Forecasts and conflicts">
            <div className="space-y-3">
              {(evolution?.forecasting.forecasts ?? []).slice(0, 4).map((forecast) => (
                <div key={forecast.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{forecast.title}</p>
                      <p className="text-xs text-muted-foreground">{forecast.summary}</p>
                    </div>
                    <Badge variant={forecast.severity === "critical" ? "destructive" : forecast.severity === "high" ? "secondary" : "outline"}>
                      {forecast.severity}
                    </Badge>
                  </div>
                </div>
              ))}
              {releaseSimulations.slice(0, 3).map((simulation) => (
                <div key={simulation.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{simulation.title}</p>
                      <p className="text-xs text-muted-foreground">{simulation.summary}</p>
                    </div>
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
              {(releaseGovernance?.forensics.migrationConflicts ?? []).slice(0, 2).map((conflict) => (
                <div key={conflict} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Migration conflict</p>
                  <p className="mt-2 text-xs text-muted-foreground">{conflict}</p>
                </div>
              ))}
              {(releaseGovernance?.forensics.staleRuntimeConflicts ?? []).slice(0, 2).map((conflict) => (
                <div key={conflict} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Stale runtime conflict</p>
                  <p className="mt-2 text-xs text-muted-foreground">{conflict}</p>
                </div>
              ))}
            </div>
          </ControlPlaneCard>
        </div>

        <Sheet onOpenChange={(open) => !open && setSelectedTrace(null)} open={!!selectedTrace}>
          <SheetContent className="w-full sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle className="font-display">Trace detail</SheetTitle>
            </SheetHeader>

            {selectedTrace ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-semibold text-foreground">{selectedTrace.type}</p>
                    <Badge variant={toBadgeVariant(selectedTrace.severity || selectedTrace.status)}>
                      {selectedTrace.severity || selectedTrace.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedTrace.message || "No event message recorded."}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Occurred</p>
                      <p className="font-medium text-foreground">{formatDateTime(selectedTrace.occurredAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Source</p>
                      <p className="font-medium text-foreground">{selectedTrace.source}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Request ID</p>
                      <p className="font-medium text-foreground">{selectedTrace.requestId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Correlation ID</p>
                      <p className="font-medium text-foreground">{selectedTrace.correlationId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Trace ID</p>
                      <p className="font-medium text-foreground">{selectedTrace.traceId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Queue job</p>
                      <p className="font-medium text-foreground">{selectedTrace.queueJobId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Payment reference</p>
                      <p className="font-medium text-foreground">{selectedTrace.paymentReference || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Incident key</p>
                      <p className="font-medium text-foreground">{selectedTrace.incidentKey || "n/a"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Event metadata</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedTrace.metadata ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminObservability;
