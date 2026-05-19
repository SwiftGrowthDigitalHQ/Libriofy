import { useMemo, useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { OperatorActionDialog, type OperatorActionDialogConfig } from "@/components/superAdmin/OperatorActionDialog";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SuperAdminSnapshotNotice } from "@/components/superAdmin/SuperAdminSnapshotNotice";
import { useToast } from "@/hooks/use-toast";
import { useIncidents, useResolveIncident, useSecurity } from "@/hooks/superAdmin";
import {
  SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED,
  SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED,
  resolveSuperAdminSnapshotRefresh,
} from "@/lib/superAdmin/lightweightMode";
import {
  buildPriorOperatorActions,
  buildRuntimeDependencyStatus,
  hydrateOperatorPreview,
} from "@/lib/superAdmin/operatorPreview";
import {
  extractOperatorActionPreview,
  resolveOperatorPlaybooks,
  type OperatorActionContextSection,
} from "@/lib/superAdmin/operatorSafety";
import { formatDateTime, formatNumber, toBadgeVariant } from "@/lib/superAdmin/presentation";
import type {
  AdminAdaptiveRoutingRecommendation,
  AdminIncidentGroup,
  AdminOperationalPrediction,
} from "@/lib/superAdmin/types";

const STALE_INCIDENT_MS = 24 * 60 * 60 * 1000;

const resolveIncidentWorkflowState = (incident: AdminIncidentGroup) => {
  if (incident.unresolvedCount <= 0) {
    return "resolved";
  }

  if (incident.escalationLevel > 0) {
    return "escalated";
  }

  if (incident.acknowledgedAt) {
    return "acknowledged";
  }

  return "new";
};

const SuperAdminIncidents = () => {
  const { toast } = useToast();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED);
  const [activeTab, setActiveTab] = useState("groups");
  const [actionDialog, setActionDialog] = useState<OperatorActionDialogConfig | null>(null);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [selectedIncident, setSelectedIncident] = useState<AdminIncidentGroup | null>(null);
  const refetchIntervalMs = resolveSuperAdminSnapshotRefresh(autoRefreshEnabled);

  const groupsQuery = useIncidents({
    query: {
      page: 1,
      pageSize: 20,
      scope: "groups",
      search,
      severity,
    },
    refetchIntervalMs,
  });
  const snapshotsQuery = useIncidents({
    enabled: activeTab === "snapshots",
    query: {
      page: 1,
      pageSize: 20,
      scope: "snapshots",
      search,
    },
    refetchIntervalMs,
  });
  const resolveIncident = useResolveIncident();
  const securityQuery = useSecurity({ refetchIntervalMs });
  const runtimeVisibility = securityQuery.data?.runtimeVisibility;

  const staleGroups = useMemo(
    () =>
      ("items" in (groupsQuery.data ?? {})
        ? groupsQuery.data.items.items.filter((group) => {
            const lastSeenAt = group.lastSeenAt ? new Date(group.lastSeenAt).getTime() : 0;
            return group.unresolvedCount > 0 && lastSeenAt > 0 && Date.now() - lastSeenAt >= STALE_INCIDENT_MS;
          })
        : []),
    [groupsQuery.data],
  );
  const selectedPrediction: AdminOperationalPrediction | null = null;
  const selectedRoutingRecommendation: AdminAdaptiveRoutingRecommendation | null = null;

  const handleResolve = async (incidentKey: string, note?: string) => {
    try {
      await resolveIncident.mutateAsync({
        action: "resolve_incident",
        incidentKey,
        resolutionNote: note,
      });
      toast({ title: "Incident group resolved" });
      setSelectedIncident(null);
      setResolutionNote("");
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to resolve the incident group.",
        title: "Resolution failed",
        variant: "destructive",
      });
    }
  };

  const handleAutoResolveStale = async () => {
    const results = await Promise.allSettled(
      staleGroups.map((group) =>
        resolveIncident.mutateAsync({
          action: "resolve_incident",
          incidentKey: group.incidentKey,
          resolutionNote: "Auto-resolved because the incident group was stale beyond the control-plane threshold.",
        }),
      ),
    );

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - succeeded;
    toast({
      description: failed > 0 ? `${failed} incident groups still need manual review.` : "All stale groups were resolved.",
      title: `${succeeded} stale incident groups processed`,
      variant: failed > 0 ? "destructive" : "default",
    });
  };

  const handleIncidentAction = async (
    body:
      | { action: "acknowledge_incident"; incidentKey: string; note?: string }
      | { action: "assign_incident"; assigneeEmail: string; incidentKey: string; note?: string }
      | { action: "escalate_incident"; escalationLevel?: number; incidentKey: string; note?: string }
      | { action: "add_incident_note"; incidentKey: string; note: string }
      | { action: "retry_from_incident"; incidentKey: string; note?: string },
    successTitle: string,
  ) => {
    try {
      await resolveIncident.mutateAsync(body);
      toast({ title: successTitle });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update the incident workflow.",
        title: "Incident workflow failed",
        variant: "destructive",
      });
    }
  };

  const buildIncidentSections = (incident: AdminIncidentGroup): OperatorActionContextSection[] => [
    {
      items: [
        {
          label: "Workflow state",
          tone:
            resolveIncidentWorkflowState(incident) === "escalated"
              ? "warning"
              : incident.unresolvedCount > 0
                ? "default"
                : "default",
          value: resolveIncidentWorkflowState(incident),
        },
        {
          label: "Owner",
          value: incident.ownerEmail || "Unassigned",
        },
        {
          label: "Escalation",
          value: `Level ${formatNumber(incident.escalationLevel)}`,
        },
        {
          label: "SLA",
          tone: incident.slaBreached ? "critical" : "default",
          value: incident.slaBreached ? "Breached" : `Target ${formatDateTime(incident.slaTargetAt)}`,
        },
      ],
      title: "Workflow",
    },
    {
      items: [
        {
          label: "Linked jobs",
          value: incident.linkedJobIds.join(", ") || "No linked jobs",
        },
        {
          label: "Linked traces",
          value: incident.linkedTraceIds.join(", ") || "No linked traces",
        },
        {
          label: "Recent notes",
          value: incident.operationalNotes.at(-1)?.note || "No note captured",
        },
      ],
      title: "Forensics",
    },
  ];

  const openIncidentActionDialog = ({
    action,
    confirmButtonLabel,
    defaultReason,
    incident,
    title,
  }: {
    action: "escalate_incident" | "resolve_incident" | "retry_from_incident";
    confirmButtonLabel: string;
    defaultReason: string;
    incident: AdminIncidentGroup;
    title: string;
  }) => {
    setActionDialog({
      actionLabel: confirmButtonLabel,
      confirmButtonLabel,
      description:
        "This incident workflow change is previewed server-side first so the open count, lineage, and remediation playbooks are explicit before state changes.",
      id: `${action}-${incident.incidentKey}`,
      initialReason: defaultReason,
      requestPreview: async (reason) => {
        const response = await resolveIncident.mutateAsync({
          action,
          dryRun: true,
          escalationLevel:
            action === "escalate_incident" ? incident.escalationLevel + 1 : undefined,
          incidentKey: incident.incidentKey,
          note: action === "retry_from_incident" ? reason || defaultReason : reason || defaultReason,
          resolutionNote: action === "resolve_incident" ? reason || defaultReason : undefined,
        } as Parameters<typeof resolveIncident.mutateAsync>[0]);
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for this incident action.");
        }

        return hydrateOperatorPreview(preview, {
          affectedEntities: [
            {
              id: incident.incidentKey,
              kind: "incident",
              label: incident.eventType,
              status: resolveIncidentWorkflowState(incident),
            },
            ...incident.linkedJobIds.slice(0, 3).map((jobId) => ({
              id: jobId,
              kind: "job",
              label: jobId,
              status: "linked",
            })),
          ],
          blastRadius: {
            affectedCount: Math.max(1, incident.unresolvedCount),
            scope: incident.unresolvedCount > 10 ? "limited" : "single",
            summary: `${formatNumber(incident.unresolvedCount)} unresolved events in this incident group`,
          },
          dependencyStatus: buildRuntimeDependencyStatus({
            runtimeVisibility,
          }),
          playbooks: resolveOperatorPlaybooks({
            actionId: preview.actionId,
            incident,
            preview,
            runtimeVisibility,
          }),
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.targetType === "incident_group" && entry.incidentKey === incident.incidentKey,
          ),
          relatedIncidents: [
            {
              incidentKey: incident.incidentKey,
              lastSeenAt: incident.lastSeenAt,
              latestMessage: incident.latestMessage,
              severity: incident.severity,
              status:
                incident.unresolvedCount <= 0
                  ? "resolved"
                  : incident.acknowledgedAt
                    ? "acknowledged"
                    : "open",
            },
          ],
        });
      },
      sections: buildIncidentSections(incident),
      title,
      onConfirm: async ({ confirmationText, reason, token }) => {
        await resolveIncident.mutateAsync({
          action,
          actionToken: token,
          confirmationText,
          escalationLevel:
            action === "escalate_incident" ? incident.escalationLevel + 1 : undefined,
          incidentKey: incident.incidentKey,
          note: action === "retry_from_incident" ? reason || defaultReason : reason || defaultReason,
          resolutionNote: action === "resolve_incident" ? reason || defaultReason : undefined,
        } as Parameters<typeof resolveIncident.mutateAsync>[0]);
        toast({ title: confirmButtonLabel });
      },
    });
  };

  const handleRefresh = async () => {
    const refreshes: Array<Promise<unknown>> = [groupsQuery.refetch(), securityQuery.refetch()];

    if (activeTab === "snapshots") {
      refreshes.push(snapshotsQuery.refetch());
    }

    await Promise.all(refreshes);
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Auto-refresh</span>
                <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
              </div>
              <Button onClick={() => void handleRefresh()} variant="outline">
                Refresh snapshot
              </Button>
              <Button disabled={staleGroups.length === 0 || resolveIncident.isPending} onClick={handleAutoResolveStale} variant="outline">
                Auto-resolve stale ({staleGroups.length})
              </Button>
            </>
          }
          description="Incident ownership, acknowledgement, escalation, note capture, linked traces, and retry-from-incident operations."
          title="Incidents"
        />

        <SuperAdminSnapshotNotice
          description="Incident coordination snapshots refresh periodically while live attendance subscriptions stay isolated from admin troubleshooting traffic."
          generatedAt={securityQuery.data?.generatedAt}
          refreshIntervalMs={refetchIntervalMs}
          title="Live governance monitoring temporarily reduced."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ControlPlaneCard title="Open groups">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber("summary" in (groupsQuery.data ?? {}) ? groupsQuery.data.summary.unresolved : 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Critical groups">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber("summary" in (groupsQuery.data ?? {}) ? groupsQuery.data.summary.critical : 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Escalated groups">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber("summary" in (groupsQuery.data ?? {}) ? groupsQuery.data.summary.escalated : 0)}
            </p>
          </ControlPlaneCard>
        </div>

        <ControlPlaneCard title="Incident console">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search incident key, event type, or message"
                value={search}
              />
              <Input
                onChange={(event) => setSeverity(event.target.value)}
                placeholder="Severity filter (INFO, WARNING, ERROR, CRITICAL)"
                value={severity}
              />
            </div>

            <Tabs onValueChange={setActiveTab} value={activeTab}>
              <TabsList>
                <TabsTrigger value="groups">Incident Groups</TabsTrigger>
                <TabsTrigger value="snapshots">Metric Snapshots</TabsTrigger>
              </TabsList>

              <TabsContent value="groups">
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Open</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Last Seen</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {"items" in (groupsQuery.data ?? {}) &&
                        groupsQuery.data.items.items.map((group) => (
                          <TableRow key={group.incidentKey}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{group.eventType}</p>
                                <p className="text-xs text-muted-foreground">{group.incidentKey}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(group.severity)}>{group.severity}</Badge>
                            </TableCell>
                            <TableCell>{formatNumber(group.unresolvedCount)}</TableCell>
                            <TableCell>{formatNumber(group.totalOccurrences)}</TableCell>
                            <TableCell>{formatDateTime(group.lastSeenAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button onClick={() => setSelectedIncident(group)} size="sm" variant="outline">
                                  Details
                                </Button>
                                <Button
                                  onClick={() =>
                                    void handleIncidentAction(
                                      { action: "acknowledge_incident", incidentKey: group.incidentKey, note: "Acknowledged from incident console." },
                                      "Incident acknowledged",
                                    )
                                  }
                                  size="sm"
                                  variant="outline"
                                >
                                  Acknowledge
                                </Button>
                                <Button
                                  onClick={() =>
                                    openIncidentActionDialog({
                                      action: "resolve_incident",
                                      confirmButtonLabel: "Resolve incident",
                                      defaultReason: "Resolved from incident console after review.",
                                      incident: group,
                                      title: "Review incident resolution",
                                    })
                                  }
                                  size="sm"
                                >
                                  Resolve
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="snapshots">
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead>Window</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Captured</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {"items" in (snapshotsQuery.data ?? {}) &&
                        snapshotsQuery.data.items.items.map((snapshot) => (
                          <TableRow key={`${snapshot.metricKey}-${snapshot.capturedAt}`}>
                            <TableCell>{snapshot.metricKey}</TableCell>
                            <TableCell>{snapshot.metricWindow}</TableCell>
                            <TableCell>{formatNumber(snapshot.metricValue)}</TableCell>
                            <TableCell>{formatDateTime(snapshot.capturedAt)}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ControlPlaneCard>

        <Sheet onOpenChange={(open) => !open && setSelectedIncident(null)} open={!!selectedIncident}>
          <SheetContent className="w-full sm:max-w-xl">
            <SheetHeader>
              <SheetTitle className="font-display">Incident detail</SheetTitle>
            </SheetHeader>

            {selectedIncident ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-semibold text-foreground">{selectedIncident.eventType}</p>
                    <Badge variant={toBadgeVariant(selectedIncident.severity)}>{selectedIncident.severity}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{selectedIncident.latestMessage || "No incident message captured."}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">First seen</p>
                      <p className="font-medium text-foreground">{formatDateTime(selectedIncident.firstSeenAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last seen</p>
                      <p className="font-medium text-foreground">{formatDateTime(selectedIncident.lastSeenAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Open count</p>
                      <p className="font-medium text-foreground">{formatNumber(selectedIncident.unresolvedCount)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total occurrences</p>
                      <p className="font-medium text-foreground">{formatNumber(selectedIncident.totalOccurrences)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Owner</p>
                      <p className="font-medium text-foreground">{selectedIncident.ownerEmail || "unassigned"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Backup owner</p>
                      <p className="font-medium text-foreground">{selectedIncident.backupOwnerEmail || "none"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Escalation</p>
                      <p className="font-medium text-foreground">Level {formatNumber(selectedIncident.escalationLevel)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Workflow state</p>
                      <p className="font-medium text-foreground">{resolveIncidentWorkflowState(selectedIncident)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">SLA status</p>
                      <p className="font-medium text-foreground">
                        {selectedIncident.slaBreached ? "Breached" : formatDateTime(selectedIncident.slaTargetAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Scope</p>
                      <p className="font-medium text-foreground">
                        {[selectedIncident.tenantLabel, selectedIncident.organizationLabel, selectedIncident.teamLabel, selectedIncident.regionLabel]
                          .filter(Boolean)
                          .join(" / ") || "Global"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Ownership health</p>
                      <p className="font-medium text-foreground">
                        {selectedIncident.unresolvedOwnership ? "Needs owner" : "Owned"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Operational note</p>
                  <Textarea
                    onChange={(event) => setResolutionNote(event.target.value)}
                    rows={4}
                    value={resolutionNote}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Assign owner</p>
                  <Input
                    onChange={(event) => setAssignmentEmail(event.target.value)}
                    placeholder="owner@libriofy.com"
                    value={assignmentEmail}
                  />
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Linked jobs</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedIncident.linkedJobIds.join(", ") || "No linked jobs"}
                  </p>
                  <p className="mt-3 text-sm font-medium text-foreground">Linked traces</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selectedIncident.linkedTraceIds.join(", ") || "No linked traces"}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Coordination</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-muted-foreground">Cross-team escalation</p>
                      <p className="mt-1 font-medium text-foreground">
                        {selectedIncident.crossTeamEscalation ? "Active" : "No cross-team route"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-muted-foreground">After-hours routing</p>
                      <p className="mt-1 font-medium text-foreground">
                        {selectedIncident.afterHoursEscalated ? "Triggered" : "Not triggered"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-muted-foreground">Delegated remediator</p>
                      <p className="mt-1 font-medium text-foreground">
                        {selectedIncident.delegatedRemediatorEmail || "None"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-muted-foreground">Governance links</p>
                      <p className="mt-1 font-medium text-foreground">
                        {selectedIncident.approvalLinkedRequestIds?.length || selectedIncident.governanceActionIds?.length
                          ? `${selectedIncident.approvalLinkedRequestIds?.length ?? 0} approvals / ${selectedIncident.governanceActionIds?.length ?? 0} actions`
                          : "No governance links"}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedPrediction || selectedRoutingRecommendation ? (
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-medium text-foreground">Adaptive guidance</p>
                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-muted-foreground">Predicted escalation risk</p>
                          {selectedPrediction ? (
                            <Badge variant={toBadgeVariant(selectedPrediction.severity)}>{selectedPrediction.severity}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 font-medium text-foreground">
                          {selectedPrediction ? `${formatNumber(selectedPrediction.confidencePercent)}% confidence` : "No elevated risk"}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {selectedPrediction?.recommendedActions[0] || "No predictive action needed."}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-muted-foreground">Recommended responder</p>
                          {selectedRoutingRecommendation ? (
                            <Badge variant={toBadgeVariant(selectedRoutingRecommendation.severity)}>
                              {selectedRoutingRecommendation.severity}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 font-medium text-foreground">
                          {selectedRoutingRecommendation?.recommendedResponder || "Manual review"}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Route: {selectedRoutingRecommendation?.recommendedRoute.join(" -> ") || "No synthesized route"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED ? (
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-sm font-medium text-foreground">Adaptive guidance</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Predictive incident routing is paused in lightweight mode. Use manual operator review for escalations.
                    </p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Operational notes</p>
                  <div className="mt-3 space-y-3">
                    {selectedIncident.operationalNotes.length ? (
                      selectedIncident.operationalNotes.map((note) => (
                        <div key={note.id} className="rounded-lg border border-border bg-muted/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{note.action}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(note.createdAt)}</p>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{note.note}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No structured notes captured yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Ownership transitions</p>
                  <div className="mt-3 space-y-3">
                    {selectedIncident.ownershipTransitions?.length ? (
                      selectedIncident.ownershipTransitions.map((transition, index) => (
                        <div key={`${transition.at}-${index}`} className="rounded-lg border border-border bg-muted/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{transition.type.replaceAll("_", " ")}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(transition.at)}</p>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {(transition.from || "unassigned")} {"->"} {transition.to || "unassigned"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[transition.teamLabel, transition.regionLabel, transition.note].filter(Boolean).join(" | ") || "No extra lineage"}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No ownership transitions captured yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Remediation actions</p>
                  <div className="mt-3 space-y-3">
                    {selectedIncident.remediationActions?.length ? (
                      selectedIncident.remediationActions.map((action) => (
                        <div key={action.id} className="rounded-lg border border-border bg-muted/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{action.type}</p>
                            <Badge variant={toBadgeVariant(action.severity || action.status)}>
                              {action.severity || action.status}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {action.message || "No remediation message recorded."}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No remediation actions linked yet.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Trace lineage</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedIncident.traceLineage, null, 2)}
                  </pre>
                </div>

                <div className="flex justify-end gap-2">
                  <Button onClick={() => setSelectedIncident(null)} variant="outline">
                    Close
                  </Button>
                  <Button
                    onClick={() =>
                      void handleIncidentAction(
                        { action: "add_incident_note", incidentKey: selectedIncident.incidentKey, note: resolutionNote || "Operator note added from incident sheet." },
                        "Incident note added",
                      )
                    }
                    variant="outline"
                  >
                    Save note
                  </Button>
                  <Button
                    onClick={() =>
                      void handleIncidentAction(
                        { action: "assign_incident", assigneeEmail: assignmentEmail, incidentKey: selectedIncident.incidentKey, note: resolutionNote || undefined },
                        "Incident assigned",
                      )
                    }
                    variant="outline"
                  >
                    Assign
                  </Button>
                  <Button
                    onClick={() =>
                      openIncidentActionDialog({
                        action: "escalate_incident",
                        confirmButtonLabel: "Escalate incident",
                        defaultReason: resolutionNote || "Escalated from incident sheet.",
                        incident: selectedIncident,
                        title: "Review incident escalation",
                      })
                    }
                    variant="outline"
                  >
                    Escalate
                  </Button>
                  <Button
                    onClick={() =>
                      openIncidentActionDialog({
                        action: "retry_from_incident",
                        confirmButtonLabel: "Retry incident job",
                        defaultReason: resolutionNote || "Retry triggered from incident sheet.",
                        incident: selectedIncident,
                        title: "Review incident retry",
                      })
                    }
                    variant="outline"
                  >
                    Retry job
                  </Button>
                  <Button
                    onClick={() =>
                      openIncidentActionDialog({
                        action: "resolve_incident",
                        confirmButtonLabel: "Resolve incident",
                        defaultReason: resolutionNote || "Resolved from incident sheet.",
                        incident: selectedIncident,
                        title: "Review incident resolution",
                      })
                    }
                  >
                    Resolve incident
                  </Button>
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>

        <OperatorActionDialog
          config={actionDialog}
          onOpenChange={(open) => {
            if (!open) {
              setActionDialog(null);
            }
          }}
        />
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminIncidents;
