import { useMemo, useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { OperatorActionDialog, type OperatorActionDialogConfig } from "@/components/superAdmin/OperatorActionDialog";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics, useAutomationJobMutation, useAutomationJobs, useSecurity } from "@/hooks/superAdmin";
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
  AdminDeadLetterRow,
  AdminJobQueueRow,
  AdminOperatorActionPreview,
  AdminRuntimeTraceEvent,
} from "@/lib/superAdmin/types";

const AUTO_REFRESH_MS = 15_000;

const buildRelatedIncidentPreview = (
  traceFeed: AdminRuntimeTraceEvent[] | undefined,
  incidentKeys: string[],
) =>
  incidentKeys
    .map((incidentKey) => {
      const latest = (traceFeed ?? []).find((event) => event.incidentKey === incidentKey);
      return latest
        ? {
            incidentKey,
            lastSeenAt: latest.occurredAt,
            latestMessage: latest.message,
            severity: latest.severity ?? "WARNING",
            status: "open" as const,
          }
        : {
            incidentKey,
            lastSeenAt: null,
            latestMessage: null,
            severity: "WARNING" as const,
            status: "open" as const,
          };
    })
    .slice(0, 3);

const summarizeActions = (preview: AdminOperatorActionPreview["priorOperatorActions"]) =>
  preview?.length
    ? preview
        .map((action) => `${action.action} by ${action.actorEmail || "system"} at ${formatDateTime(action.occurredAt)}`)
        .join(" | ")
    : "No recent operator actions for this target.";

const buildQueueContextSections = ({
  job,
  preview,
  traceRequestId,
  traceTraceId,
}: {
  job?: AdminJobQueueRow | null;
  preview: AdminOperatorActionPreview;
  traceRequestId?: string | null;
  traceTraceId?: string | null;
}): OperatorActionContextSection[] => [
  {
    items: [
      {
        label: "Target",
        value: preview.targetDisplay || job?.jobType || "queue job",
      },
      {
        label: "Job ID",
        value: job?.id || preview.targetDisplay || "n/a",
      },
      {
        label: "Retry lineage",
        value: `${formatNumber(preview.retryHistory.length)} prior attempts`,
      },
      {
        label: "Request trace",
        value: [traceRequestId, traceTraceId].filter(Boolean).join(" / ") || "No request trace linked",
      },
    ],
    title: "Affected entities",
  },
  {
    items: [
      {
        label: "Related incidents",
        tone: preview.relatedIncidents?.length ? "warning" : "default",
        value:
          preview.relatedIncidents?.map((incident) => incident.incidentKey).join(", ") ||
          "No linked incidents",
      },
      {
        label: "Recent operator actions",
        value: summarizeActions(preview.priorOperatorActions),
      },
    ],
    title: "Operational context",
  },
];

const SuperAdminAutomation = () => {
  const { toast } = useToast();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [actionDialog, setActionDialog] = useState<OperatorActionDialogConfig | null>(null);
  const [jobType, setJobType] = useState("inactive_library_alert");
  const [search, setSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<AdminJobQueueRow | null>(null);
  const [selectedDeadLetter, setSelectedDeadLetter] = useState<AdminDeadLetterRow | null>(null);

  const refetchIntervalMs = autoRefreshEnabled ? AUTO_REFRESH_MS : false;
  const analyticsQuery = useAnalytics("Patna", refetchIntervalMs);
  const overviewQuery = useAutomationJobs({ refetchIntervalMs });
  const jobMutation = useAutomationJobMutation();
  const securityQuery = useSecurity({ refetchIntervalMs });
  const operationalIntelligence = analyticsQuery.data?.operationalIntelligence;
  const runtimeVisibility = analyticsQuery.data?.runtimeVisibility ?? securityQuery.data?.runtimeVisibility;
  const runtimeGovernance = analyticsQuery.data?.governance;

  const filteredJobs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (overviewQuery.data?.data.jobs ?? []).filter((job) => {
      if (!normalizedSearch) {
        return true;
      }

      return [
        job.jobType,
        job.status,
        job.lastError,
        job.claimedBy,
        job.claimToken,
        job.trace.originRequestId,
        job.trace.correlationId,
        job.trace.traceId,
        JSON.stringify(job.payload ?? {}),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [overviewQuery.data?.data.jobs, search]);

  const filteredDeadLetters = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (overviewQuery.data?.data.deadLetters ?? []).filter((row) => {
      if (!normalizedSearch) {
        return true;
      }

      return [
        row.jobType,
        row.errorMessage,
        row.jobId,
        row.sourceRequestId,
        row.sourceCorrelationId,
        row.sourceTraceId,
        JSON.stringify(row.payload ?? {}),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [overviewQuery.data?.data.deadLetters, search]);

  const handleEnqueue = async () => {
    try {
      await jobMutation.mutateAsync({
        action: "enqueue",
        jobType,
      });
      toast({ title: "Job enqueued" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to enqueue the job.",
        title: "Job failed",
        variant: "destructive",
      });
    }
  };

  const hydrateQueuePreview = ({
    basePreview,
    job,
    traceRequestId,
    traceTraceId,
  }: {
    basePreview: AdminOperatorActionPreview;
    job?: AdminJobQueueRow | null;
    traceRequestId?: string | null;
    traceTraceId?: string | null;
  }) =>
    hydrateOperatorPreview(basePreview, {
      affectedEntities: [
        {
          id: job?.id || traceRequestId || basePreview.targetDisplay || basePreview.title,
          kind: "job",
          label: job?.jobType || basePreview.targetDisplay || basePreview.title,
          status: job?.status ?? null,
        },
        ...(job?.relatedIncidentKeys ?? []).slice(0, 3).map((incidentKey) => ({
          id: incidentKey,
          kind: "incident",
          label: incidentKey,
          status: "linked",
        })),
      ],
      blastRadius: {
        affectedCount: Math.max(1, (job?.relatedIncidentKeys?.length ?? 0) + 1),
        scope: (job?.relatedIncidentKeys?.length ?? 0) > 1 ? "limited" : "single",
        summary:
          (job?.relatedIncidentKeys?.length ?? 0) > 0
            ? `1 job and ${job?.relatedIncidentKeys.length ?? 0} linked incidents`
            : "Single queue job",
      },
      dependencyStatus: buildRuntimeDependencyStatus({
        runtimeGovernance,
        runtimeVisibility,
      }),
      playbooks: resolveOperatorPlaybooks({
        actionId: basePreview.actionId,
        preview: basePreview,
        runtimeGovernance,
        runtimeVisibility,
      }),
      priorOperatorActions: buildPriorOperatorActions(
        securityQuery.data?.operatorTimeline,
        (entry) => entry.queueJobId === job?.id || String(entry.metadata.job_id || "") === job?.id,
      ),
      relatedIncidents: buildRelatedIncidentPreview(
        securityQuery.data?.traceFeed,
        job?.relatedIncidentKeys ?? [],
      ),
    });

  const openRunDueDialog = () => {
    setActionDialog({
      actionLabel: "Running due jobs",
      confirmButtonLabel: "Run due jobs",
      description:
        "Preview the due-job sweep first so the queue impact, dependencies, and replay guidance are visible before execution.",
      id: "run-due-jobs",
      initialReason: "Operator run after queue health review.",
      requestPreview: async (reason) => {
        const response = await jobMutation.mutateAsync({
          action: "run_due_now",
          dryRun: true,
          replayReason: reason || "Operator run after queue health review.",
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for due-job execution.");
        }

        return hydrateOperatorPreview(preview, {
          blastRadius: {
            affectedCount: overviewQuery.data?.data.summary.queuedJobs ?? 0,
            scope: (overviewQuery.data?.data.summary.queuedJobs ?? 0) > 10 ? "bulk" : "limited",
            summary: `${formatNumber(overviewQuery.data?.data.summary.queuedJobs ?? 0)} queued jobs may be claimed`,
          },
          dependencyStatus: buildRuntimeDependencyStatus({
            runtimeGovernance,
            runtimeVisibility,
          }),
          playbooks: resolveOperatorPlaybooks({
            actionId: preview.actionId,
            preview,
            runtimeGovernance,
            runtimeVisibility,
          }),
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.action === "jobs_run_due_now",
          ),
        });
      },
      sections: [
        {
          items: [
            {
              label: "Queued jobs",
              value: formatNumber(overviewQuery.data?.data.summary.queuedJobs ?? 0),
            },
            {
              label: "Running jobs",
              value: formatNumber(overviewQuery.data?.data.summary.runningJobs ?? 0),
            },
            {
              label: "Queue lag",
              tone: (runtimeVisibility?.queueLagMs ?? 0) >= 5 * 60_000 ? "warning" : "default",
              value: `${formatNumber(Math.round(runtimeVisibility?.queueLagMs ?? 0))} ms`,
            },
          ],
          title: "Blast radius",
        },
      ],
      title: "Run due jobs safely",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await jobMutation.mutateAsync({
          action: "run_due_now",
          actionToken: token,
          confirmationText,
          replayReason: reason || "Operator run after queue health review.",
        });
        toast({ title: "Due jobs executed" });
      },
    });
  };

  const openJobWorkflowDialog = ({
    action,
    defaultReason,
    description,
    job,
    successTitle,
  }: {
    action: "cancel" | "retry";
    defaultReason: string;
    description: string;
    job: AdminJobQueueRow;
    successTitle: string;
  }) => {
    const reasonField = action === "cancel" ? "cancelReason" : "replayReason";
    const previewAction = action === "cancel" ? "Queue cancellation" : "Retry queued job";
    setActionDialog({
      actionLabel: action === "cancel" ? "Cancelling job" : "Retrying job",
      confirmButtonLabel: action === "cancel" ? "Request cancellation" : "Queue retry",
      description,
      id: `${action}-${job.id}`,
      initialReason: defaultReason,
      requestPreview: async (reason) => {
        const response = await jobMutation.mutateAsync({
          action,
          dryRun: true,
          jobId: job.id,
          [reasonField]: reason || defaultReason,
        } as Parameters<typeof jobMutation.mutateAsync>[0]);
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error(`Impact preview unavailable for ${previewAction.toLowerCase()}.`);
        }

        return hydrateQueuePreview({
          basePreview: preview,
          job,
          traceRequestId: job.trace.originRequestId,
          traceTraceId: job.trace.traceId,
        });
      },
      sections: buildQueueContextSections({
        job,
        preview: hydrateQueuePreview({
          basePreview: {
            actionId: action === "cancel" ? "queue_cancel" : "job_retry",
            confirmationLabel: "",
            cooldownUntil: null,
            dryRun: true,
            duplicateRisk: action === "retry" && job.status === "queued" ? "high" : "medium",
            existingCaptureLineage: [],
            idempotencyKey: job.deduplicationKey,
            impacts: [],
            requiresReason: true,
            reversible: false,
            retryHistory: job.retryHistory,
            severity: action === "cancel" ? "high" : "high",
            summary: "",
            targetDisplay: job.jobType,
            title: previewAction,
            token: null,
            traceLineage: job.traceLineage,
            warnings: [],
          },
          job,
          traceRequestId: job.trace.originRequestId,
          traceTraceId: job.trace.traceId,
        }),
        traceRequestId: job.trace.originRequestId,
        traceTraceId: job.trace.traceId,
      }),
      title: action === "cancel" ? "Review queue cancellation" : "Review queue retry",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await jobMutation.mutateAsync({
          action,
          actionToken: token,
          confirmationText,
          jobId: job.id,
          [reasonField]: reason || defaultReason,
        } as Parameters<typeof jobMutation.mutateAsync>[0]);
        toast({ title: successTitle });
        setSelectedJob(null);
      },
    });
  };

  const openReplayDialog = (deadLetter: AdminDeadLetterRow) => {
    const matchingJob = overviewQuery.data?.data.jobs.find((job) => job.id === deadLetter.jobId) ?? null;
    setActionDialog({
      actionLabel: "Replaying job",
      confirmButtonLabel: "Replay job",
      description:
        "Replay is blocked behind a dry-run preview so duplicate risk, lineage, and queue health are visible before the job is re-enqueued.",
      id: `replay-${deadLetter.jobId}`,
      initialReason: "Operator replay from dead-letter queue.",
      requestPreview: async (reason) => {
        const response = await jobMutation.mutateAsync({
          action: "replay_dead_letter",
          dryRun: true,
          jobId: deadLetter.jobId,
          replayReason: reason || "Operator replay from dead-letter queue.",
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for dead-letter replay.");
        }

        return hydrateQueuePreview({
          basePreview: preview,
          job: matchingJob,
          traceRequestId: deadLetter.sourceRequestId,
          traceTraceId: deadLetter.sourceTraceId,
        });
      },
      sections: [
        ...buildQueueContextSections({
          job: matchingJob,
          preview: hydrateQueuePreview({
            basePreview: {
              actionId: "dead_letter_replay",
              confirmationLabel: "",
              cooldownUntil: null,
              dryRun: true,
              duplicateRisk: matchingJob?.deduplicationKey ? "medium" : "low",
              existingCaptureLineage: [],
              idempotencyKey: matchingJob?.deduplicationKey ?? null,
              impacts: [],
              requiresReason: true,
              reversible: false,
              retryHistory: matchingJob?.retryHistory ?? [],
              severity: "critical",
              summary: "",
              targetDisplay: deadLetter.jobType,
              title: "Dead-letter replay",
              token: null,
              traceLineage: deadLetter.traceLineage,
              warnings: [],
            },
            job: matchingJob,
            traceRequestId: deadLetter.sourceRequestId,
            traceTraceId: deadLetter.sourceTraceId,
          }),
          traceRequestId: deadLetter.sourceRequestId,
          traceTraceId: deadLetter.sourceTraceId,
        }),
        {
          items: [
            {
              label: "Dead-letter error",
              tone: "critical",
              value: deadLetter.errorMessage || "No error message captured",
            },
            {
              label: "Attempts exhausted",
              value: `${deadLetter.attempts}/${deadLetter.maxAttempts}`,
            },
          ],
          title: "Failure lineage",
        },
      ],
      title: "Review dead-letter replay",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await jobMutation.mutateAsync({
          action: "replay_dead_letter",
          actionToken: token,
          confirmationText,
          jobId: deadLetter.jobId,
          replayReason: reason || "Operator replay from dead-letter queue.",
        });
        toast({ title: "Dead-letter replay queued" });
        setSelectedDeadLetter(null);
      },
    });
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
              <Button onClick={openRunDueDialog} variant="outline">
                Run due jobs
              </Button>
            </>
          )}
          description="Operator controls for live queue inspection, claim ownership review, retries, dead-letter replay, and safe cancellation."
          title="Automation"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <ControlPlaneCard title="Queued jobs">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.summary.queuedJobs ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Running jobs">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.summary.runningJobs ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Active workers">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.summary.activeWorkers ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Retries">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.summary.retryCount ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Dead letters">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.summary.deadLetterJobs ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Queue status">
            <Badge variant={overviewQuery.data?.data.summary.paused ? "destructive" : "default"}>
              {overviewQuery.data?.data.summary.paused ? "Paused" : "Running"}
            </Badge>
            <p className="mt-3 text-sm text-muted-foreground">
              Redis: {overviewQuery.data?.data.summary.redisDegraded ? "degraded" : "healthy"}
            </p>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ControlPlaneCard title="Remediation planner">
            <div className="space-y-3 text-sm">
              {(operationalIntelligence?.remediationPlans ?? []).slice(0, 4).map((plan) => (
                <div key={plan.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{plan.title}</p>
                      <p className="text-xs text-muted-foreground">{plan.summary}</p>
                    </div>
                    <Badge variant={toBadgeVariant(plan.automationLevel)}>
                      {plan.automationLevel === "guarded_auto" ? "Guarded auto" : plan.automationLevel}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Preview: {plan.previewSummary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Rollback: {plan.rollbackSummary}</p>
                </div>
              ))}
              {(operationalIntelligence?.remediationPlans ?? []).length === 0 ? (
                <p className="text-muted-foreground">No remediation plans are elevated right now.</p>
              ) : null}
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Recommendation engine">
            <div className="space-y-3 text-sm">
              {(operationalIntelligence?.recommendations ?? []).map((recommendation) => (
                <div key={recommendation.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-foreground">{recommendation.title}</p>
                    <Badge variant={toBadgeVariant(recommendation.severity)}>{recommendation.severity}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{recommendation.summary}</p>
                  <p className="mt-2 text-xs text-foreground">{recommendation.primaryAction}</p>
                </div>
              ))}
              {(operationalIntelligence?.recommendations ?? []).length === 0 ? (
                <p className="text-muted-foreground">No workload-aware recommendations are pending.</p>
              ) : null}
            </div>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Queue control">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="job-type">Job type</Label>
                <Input
                  id="job-type"
                  onChange={(event) => setJobType(event.target.value)}
                  placeholder="inactive_library_alert"
                  value={jobType}
                />
              </div>
              <Button disabled={jobMutation.isPending} onClick={() => void handleEnqueue()}>
                Enqueue job
              </Button>
              <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                <p>Queue lag: {formatNumber(Math.round(overviewQuery.data?.data.summary.queueLagMs ?? 0))} ms</p>
                <p className="mt-1">Queue latency p95: {formatNumber(overviewQuery.data?.data.summary.queueLatencyP95Ms ?? 0)} ms</p>
                <p className="mt-1">Renewal automation: {overviewQuery.data?.data.settings.automationSubscriptionRenewalEnabled ? "enabled" : "disabled"}</p>
                <p className="mt-1">Payment reminders: {overviewQuery.data?.data.settings.automationPaymentReminderEnabled ? "enabled" : "disabled"}</p>
                <p className="mt-1">Inactive library alerts: {overviewQuery.data?.data.settings.automationInactiveLibraryAlertEnabled ? "enabled" : "disabled"}</p>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Queue operations">
            <div className="space-y-4">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by job type, request ID, claim owner, trace ID, or error"
                value={search}
              />
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Claim owner</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">{job.jobType}</p>
                            <p className="text-xs text-muted-foreground">{job.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={toBadgeVariant(job.status)}>{job.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {job.attempts}/{job.maxAttempts}
                        </TableCell>
                        <TableCell>{job.claimedBy || "unclaimed"}</TableCell>
                        <TableCell>{formatDateTime(job.scheduledFor)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button onClick={() => setSelectedJob(job)} size="sm" variant="outline">
                              Inspect
                            </Button>
                            {job.status === "failed" || job.deadLetteredAt ? (
                              <Button
                                onClick={() =>
                                  openJobWorkflowDialog({
                                    action: "retry",
                                    defaultReason: "Operator retry from queue operations.",
                                    description:
                                      "Inspect retry lineage, duplicate risk, and dependency health before the failed job is returned to the queue.",
                                    job,
                                    successTitle: "Job retry queued",
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                Retry
                              </Button>
                            ) : null}
                            {job.status === "queued" || job.status === "running" ? (
                              <Button
                                onClick={() =>
                                  openJobWorkflowDialog({
                                    action: "cancel",
                                    defaultReason: "Cancelled by operator.",
                                    description:
                                      "Preview the cancellation first so active workers, linked traces, and live queue conditions are visible.",
                                    job,
                                    successTitle: "Job cancellation requested",
                                  })
                                }
                                size="sm"
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ControlPlaneCard>
        </div>

        <ControlPlaneCard title="Dead-letter queue">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Dead-lettered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeadLetters.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{row.jobType}</p>
                        <p className="text-xs text-muted-foreground">{row.jobId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{row.errorMessage || "n/a"}</TableCell>
                    <TableCell>
                      {row.attempts}/{row.maxAttempts}
                    </TableCell>
                    <TableCell>{formatDateTime(row.deadLetteredAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => setSelectedDeadLetter(row)} size="sm" variant="outline">
                          Inspect
                        </Button>
                        <Button
                          onClick={() => openReplayDialog(row)}
                          size="sm"
                        >
                          Replay
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ControlPlaneCard>

        <Sheet onOpenChange={(open) => !open && setSelectedJob(null)} open={!!selectedJob}>
          <SheetContent className="w-full sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle className="font-display">Job inspection</SheetTitle>
            </SheetHeader>

            {selectedJob ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-semibold text-foreground">{selectedJob.jobType}</p>
                    <Badge variant={toBadgeVariant(selectedJob.status)}>{selectedJob.status}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Claim owner</p>
                      <p className="font-medium text-foreground">{selectedJob.claimedBy || "unclaimed"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Claim token</p>
                      <p className="font-medium text-foreground">{selectedJob.claimToken || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Request ID</p>
                      <p className="font-medium text-foreground">{selectedJob.trace.originRequestId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Trace ID</p>
                      <p className="font-medium text-foreground">{selectedJob.trace.traceId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Retry history</p>
                      <p className="font-medium text-foreground">{formatNumber(selectedJob.retryHistory.length)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Related incidents</p>
                      <p className="font-medium text-foreground">{selectedJob.relatedIncidentKeys.join(", ") || "n/a"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Retry history</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedJob.retryHistory, null, 2)}
                  </pre>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Trace lineage</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedJob.traceLineage, null, 2)}
                  </pre>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Payload</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedJob.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>

        <Sheet onOpenChange={(open) => !open && setSelectedDeadLetter(null)} open={!!selectedDeadLetter}>
          <SheetContent className="w-full sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle className="font-display">Dead-letter inspection</SheetTitle>
            </SheetHeader>

            {selectedDeadLetter ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border p-4 text-sm">
                  <p className="font-semibold text-foreground">{selectedDeadLetter.jobType}</p>
                  <p className="mt-2 text-muted-foreground">{selectedDeadLetter.errorMessage || "No error message captured."}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-muted-foreground">Source request</p>
                      <p className="font-medium text-foreground">{selectedDeadLetter.sourceRequestId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Source trace</p>
                      <p className="font-medium text-foreground">{selectedDeadLetter.sourceTraceId || "n/a"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Trace lineage</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedDeadLetter.traceLineage, null, 2)}
                  </pre>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Replay payload</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedDeadLetter.payload, null, 2)}
                  </pre>
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

export default SuperAdminAutomation;
