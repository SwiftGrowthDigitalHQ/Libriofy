import type {
  AdminIncidentGroup,
  AdminOperatorActionPreview,
  AdminOperatorRecentAction,
  AdminOperatorRelatedIncident,
  AdminOperatorTimelineEntry,
  AdminRuntimeGovernanceState,
  AdminRuntimeVisibility,
  AdminStatusSignal,
} from "./types";

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const buildRuntimeDependencyStatus = ({
  runtimeGovernance,
  runtimeVisibility,
}: {
  runtimeGovernance?: Partial<AdminRuntimeGovernanceState> | null;
  runtimeVisibility?: Partial<AdminRuntimeVisibility> | null;
}): AdminStatusSignal[] => [
  {
    detail: runtimeVisibility?.queueLagMs != null ? `${Math.round(runtimeVisibility.queueLagMs)}ms lag` : null,
    label: "Queue",
    status:
      runtimeGovernance?.queueProcessingEnabled === false
        ? "red"
        : (runtimeVisibility?.queueLagMs ?? 0) >= 5 * 60_000
          ? "yellow"
          : "green",
    value: runtimeGovernance?.queueProcessingEnabled === false ? "Paused" : "Running",
  },
  {
    detail:
      runtimeVisibility?.deadLetterJobs != null
        ? `${runtimeVisibility.deadLetterJobs} dead letters`
        : null,
    label: "Redis",
    status: runtimeVisibility?.redisDegraded ? "red" : "green",
    value: runtimeVisibility?.redisDegraded ? "Degraded" : "Healthy",
  },
  {
    detail:
      runtimeVisibility?.paymentRetryRate != null
        ? `${runtimeVisibility.paymentRetryRate.toFixed(2)}% retry rate`
        : null,
    label: "Billing",
    status:
      runtimeGovernance?.billingMutationsEnabled === false
        ? "red"
        : (runtimeVisibility?.paymentRetryRate ?? 0) >= 20
          ? "yellow"
          : "green",
    value: runtimeGovernance?.billingMutationsEnabled === false ? "Stopped" : "Enabled",
  },
  {
    detail:
      runtimeVisibility?.incidentSeverityCounts?.critical != null
        ? `${runtimeVisibility.incidentSeverityCounts.critical} critical incidents`
        : null,
    label: "Incidents",
    status:
      (runtimeVisibility?.incidentSeverityCounts?.critical ?? 0) > 0
        ? "red"
        : (runtimeVisibility?.incidentSeverityCounts?.error ?? 0) > 0
          ? "yellow"
          : "green",
    value:
      (runtimeVisibility?.incidentSeverityCounts?.critical ?? 0) > 0
        ? "Critical active"
        : (runtimeVisibility?.incidentSeverityCounts?.error ?? 0) > 0
          ? "Errors active"
          : "Quiet",
  },
];

export const buildPriorOperatorActions = (
  entries: AdminOperatorTimelineEntry[] | undefined,
  predicate: (entry: AdminOperatorTimelineEntry) => boolean,
  limit = 3,
): AdminOperatorRecentAction[] =>
  (entries ?? [])
    .filter(predicate)
    .slice(0, limit)
    .map((entry) => ({
      action: entry.action,
      actorEmail: entry.actorEmail,
      id: entry.id,
      occurredAt: entry.occurredAt,
      summary: entry.targetDisplay || entry.targetType || entry.action,
    }));

export const buildRelatedIncidents = (
  incidents: AdminIncidentGroup[] | undefined,
  incidentKeys: string[],
  limit = 3,
): AdminOperatorRelatedIncident[] =>
  incidentKeys
    .map((incidentKey) =>
      (incidents ?? []).find((incident) => normalizeText(incident.incidentKey) === normalizeText(incidentKey)),
    )
    .filter((incident): incident is AdminIncidentGroup => Boolean(incident))
    .slice(0, limit)
    .map((incident) => ({
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
    }));

export const hydrateOperatorPreview = (
  preview: AdminOperatorActionPreview,
  extras: Partial<AdminOperatorActionPreview>,
) => ({
  ...preview,
  ...extras,
  affectedEntities: extras.affectedEntities ?? preview.affectedEntities ?? [],
  dependencyStatus: extras.dependencyStatus ?? preview.dependencyStatus ?? [],
  playbooks: extras.playbooks ?? preview.playbooks ?? [],
  priorOperatorActions: extras.priorOperatorActions ?? preview.priorOperatorActions ?? [],
  relatedIncidents: extras.relatedIncidents ?? preview.relatedIncidents ?? [],
});
