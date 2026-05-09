import type {
  AdminIncidentGroup,
  AdminOperatorActionId,
  AdminOperatorActionPreview,
  AdminOperatorPlaybook,
  AdminRuntimeGovernanceState,
  AdminRuntimeVisibility,
} from "./types";

export type OperatorActionContextItem = {
  label: string;
  tone?: "critical" | "default" | "warning";
  value: string;
};

export type OperatorActionContextSection = {
  items: OperatorActionContextItem[];
  title: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const extractOperatorActionPreview = (value: unknown): AdminOperatorActionPreview | null => {
  if (!isRecord(value) || !isRecord(value.preview)) {
    return null;
  }

  return value.preview as AdminOperatorActionPreview;
};

export const resolveOperatorPreviewRiskLevel = (
  severity: AdminOperatorActionPreview["severity"],
  duplicateRisk: AdminOperatorActionPreview["duplicateRisk"],
) => {
  if (severity === "critical" || duplicateRisk === "high") {
    return "critical" as const;
  }

  if (severity === "high" || duplicateRisk === "medium") {
    return "high" as const;
  }

  return duplicateRisk === "low" ? "low" as const : "medium" as const;
};

export const resolveOperatorIdempotencyState = ({
  duplicateRisk,
  hasIdempotencyKey,
  warnings,
}: {
  duplicateRisk: AdminOperatorActionPreview["duplicateRisk"];
  hasIdempotencyKey: boolean;
  warnings: string[];
}) => {
  const normalizedWarnings = warnings.map((warning) => warning.toLowerCase());
  const duplicateDetected = normalizedWarnings.some((warning) =>
    warning.includes("already queued") ||
    warning.includes("already processed") ||
    warning.includes("already running") ||
    warning.includes("already exists"),
  );

  if (duplicateDetected) {
    return "duplicate_detected" as const;
  }

  if (duplicateRisk === "high") {
    return "duplicate_risk" as const;
  }

  if (hasIdempotencyKey) {
    return "guarded" as const;
  }

  return "not_available" as const;
};

export const resolveOperatorRollbackSummary = ({
  reversible,
  severity,
}: {
  reversible: boolean;
  severity: AdminOperatorActionPreview["severity"];
}) =>
  reversible
    ? "Rollback is available through a follow-up governed action."
    : severity === "critical"
      ? "No guaranteed rollback path exists after execution."
      : "Rollback is limited and may require manual remediation.";

const pushPlaybook = (
  playbooks: AdminOperatorPlaybook[],
  playbook: AdminOperatorPlaybook | null,
) => {
  if (!playbook || playbooks.some((candidate) => candidate.key === playbook.key)) {
    return;
  }

  playbooks.push(playbook);
};

export const resolveOperatorPlaybooks = ({
  actionId,
  incident,
  preview,
  runtimeGovernance,
  runtimeVisibility,
}: {
  actionId: AdminOperatorActionId;
  incident?: Pick<AdminIncidentGroup, "escalationLevel" | "severityApprovalRequired" | "slaBreached" | "unresolvedCount"> | null;
  preview: Pick<AdminOperatorActionPreview, "duplicateRisk" | "warnings">;
  runtimeGovernance?: Partial<AdminRuntimeGovernanceState> | null;
  runtimeVisibility?: Partial<AdminRuntimeVisibility> | null;
}) => {
  const playbooks: AdminOperatorPlaybook[] = [];

  if (["dead_letter_replay", "job_retry", "incident_retry"].includes(actionId)) {
    pushPlaybook(playbooks, {
      guidance:
        "Replay only when the dependency fault is understood, duplicate risk is acceptable, and downstream workers are healthy.",
      key: "safe_replay_conditions",
      severity: preview.duplicateRisk === "high" ? "critical" : "info",
      title: "Safe replay conditions",
    });
  }

  if (actionId === "refund_process" && preview.duplicateRisk !== "low") {
    pushPlaybook(playbooks, {
      guidance:
        "Escalate or peer-review refunds with duplicate or over-refund risk before financial state is changed.",
      key: "refund_escalation_required",
      severity: preview.duplicateRisk === "high" ? "critical" : "warning",
      title: "Refund escalation required",
    });
  }

  if ((runtimeVisibility?.redisDegraded ?? false) && ["dead_letter_replay", "job_retry", "incident_retry", "run_due_jobs"].includes(actionId)) {
    pushPlaybook(playbooks, {
      guidance:
        "Redis is degraded. Avoid bulk replay or queue drain operations until dependency health returns to green.",
      key: "redis_degraded_avoid_bulk_replay",
      severity: "critical",
      title: "Redis degraded - avoid bulk replay",
    });
  }

  if ((runtimeVisibility?.paymentRetryRate ?? 0) >= 20 && actionId === "refund_process") {
    pushPlaybook(playbooks, {
      guidance:
        "Payment retry pressure is elevated. Investigate webhook churn or duplicate captures before overriding billing state.",
      key: "webhook_storm_detected",
      severity: "warning",
      title: "Webhook storm detected",
    });
  }

  if (runtimeGovernance?.maintenanceMode && ["governance_toggle", "emergency_control", "run_due_jobs"].includes(actionId)) {
    pushPlaybook(playbooks, {
      guidance:
        "Maintenance mode is active. Prefer targeted actions and confirm whether customer-visible writes are intentionally paused.",
      key: "maintenance_escalation_active",
      severity: "warning",
      title: "Maintenance escalation active",
    });
  }

  if (incident?.severityApprovalRequired) {
    pushPlaybook(playbooks, {
      guidance:
        "Critical incidents should not be closed quietly. Capture severity approval or an explicit handoff before remediation changes state.",
      key: "critical_incident_approval",
      severity: "warning",
      title: "Critical incident approval",
    });
  }

  if ((incident?.slaBreached ?? false) && ["incident_resolve", "incident_escalate", "incident_retry"].includes(actionId)) {
    pushPlaybook(playbooks, {
      guidance:
        "The incident has breached its SLA. Record remediation context, linked actions, and ownership before moving state again.",
      key: "incident_sla_breached",
      severity: "warning",
      title: "Incident SLA breached",
    });
  }

  return playbooks;
};
