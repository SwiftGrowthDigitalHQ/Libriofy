import { shouldRecoverRunningJob } from "./queueRuntime.js";
import type {
  AdminAdaptiveRoutingRecommendation,
  AdminDeadLetterRow,
  AdminIncidentGroup,
  AdminJobQueueRow,
  AdminOperationalHealthScore,
  AdminOperationalIntelligenceSnapshot,
  AdminOperationalPrediction,
  AdminOperationalRecommendation,
  AdminOperationalRemediationPlan,
  AdminOperationalSeverity,
  AdminOperationalSimulation,
  AdminOperatorGovernanceSnapshot,
  AdminRuntimeGovernanceState,
  AdminRuntimeVisibility,
} from "./types.js";

type BillingOperationsSnapshot = {
  duplicatePayments: number;
  manualReviewPayments: number;
  paymentRetryRate: number;
  stuckPayments: number;
  verificationRetries: number;
  webhookRetries: number;
};

export type OperationalIntelligenceInput = {
  billingOperations: BillingOperationsSnapshot;
  deadLetters: AdminDeadLetterRow[];
  failedLoginCount: number;
  generatedAt?: string;
  incidents: AdminIncidentGroup[];
  jobs: AdminJobQueueRow[];
  operatorGovernance?: AdminOperatorGovernanceSnapshot | null;
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
  suspiciousIps: Array<{ failures: number; ip: string }>;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const round = (value: number) => Number(value.toFixed(2));

const severityRank = (severity: AdminOperationalSeverity) =>
  severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;

const byOperationalSeverity = <T extends { confidencePercent?: number; severity: AdminOperationalSeverity }>(
  left: T,
  right: T,
) =>
  severityRank(right.severity) - severityRank(left.severity) ||
  (right.confidencePercent ?? 0) - (left.confidencePercent ?? 0);

const toSeverity = (score: number): AdminOperationalSeverity => {
  if (score >= 85) {
    return "critical";
  }

  if (score >= 65) {
    return "high";
  }

  if (score >= 45) {
    return "medium";
  }

  return "low";
};

const toSignal = (score: number): AdminOperationalPrediction["signal"] => {
  if (score >= 70) {
    return "action";
  }

  if (score >= 40) {
    return "watch";
  }

  return "stable";
};

const toHealthStatus = (score: number): AdminOperationalHealthScore["status"] => {
  if (score >= 75) {
    return "healthy";
  }

  if (score >= 45) {
    return "warning";
  }

  return "critical";
};

const uniqueStrings = (values: Array<string | null | undefined>) => [...new Set(values.map(normalizeText).filter(Boolean))];

const getIncidentPriorityScore = (incident: AdminIncidentGroup) => {
  let score = 0;
  score += incident.severity === "CRITICAL" ? 35 : incident.severity === "ERROR" ? 25 : incident.severity === "WARNING" ? 10 : 0;
  score += incident.slaBreached ? 20 : 0;
  score += incident.unresolvedOwnership ? 15 : 0;
  score += incident.afterHoursEscalated ? 10 : 0;
  score += incident.crossTeamEscalation ? 8 : 0;
  score += Math.min(15, incident.unresolvedCount * 4);
  score += Math.min(10, incident.escalationLevel * 5);
  score += incident.ownerEmail ? 0 : 8;
  score += incident.acknowledgedAt ? 0 : 5;
  return clamp(score, 0, 98);
};

const buildIncidentEscalationPredictions = (incidents: AdminIncidentGroup[]) =>
  incidents
    .filter((incident) => incident.unresolvedCount > 0)
    .map<AdminOperationalPrediction>((incident) => {
      const score = getIncidentPriorityScore(incident);
      return {
        confidencePercent: score,
        evidence: uniqueStrings([
          incident.slaBreached ? "SLA target is breached." : null,
          incident.unresolvedOwnership ? "Ownership is unresolved." : null,
          incident.afterHoursEscalated ? "Follow-the-sun escalation is already active." : null,
          incident.crossTeamEscalation ? "Cross-team routing is already required." : null,
          incident.ownerEmail ? `Current owner ${incident.ownerEmail}.` : "No active owner is assigned.",
        ]),
        horizonMinutes: incident.severity === "CRITICAL" ? 30 : incident.severity === "ERROR" ? 60 : 180,
        id: `incident:${incident.incidentKey}`,
        impactedEntityId: incident.incidentKey,
        impactedEntityType: "incident",
        recommendedActions: uniqueStrings([
          incident.ownerEmail ? `Reconfirm ${incident.ownerEmail} as the active responder.` : "Assign a responder before escalating automation.",
          incident.retryableJobId ? `Review safe replay readiness for ${incident.retryableJobId}.` : null,
          incident.backupOwnerEmail ? `Stage backup handoff to ${incident.backupOwnerEmail}.` : "Prepare a standby responder if the incident crosses shifts.",
        ]),
        severity: toSeverity(score),
        signal: toSignal(score),
        summary: `${incident.eventType} is likely to escalate further within the next operational window unless ownership and remediation stay aligned.`,
        title: `Escalation risk for ${incident.incidentKey}`,
        type: "incident_escalation",
      };
    })
    .filter((prediction) => prediction.confidencePercent >= 45)
    .sort(byOperationalSeverity)
    .slice(0, 6);

const buildOverloadPredictions = (
  snapshot: AdminOperatorGovernanceSnapshot | null | undefined,
) =>
  (snapshot?.coordination.loadBalancing.operatorLoads ?? [])
    .map<AdminOperationalPrediction>((load) => {
      const score = clamp(
        Math.max(
          load.utilizationPercent,
          load.pendingApprovals * 20 + load.activeIncidents * 12 + load.delegatedRemediations * 10,
        ),
        0,
        99,
      );

      return {
        confidencePercent: round(score),
        evidence: uniqueStrings([
          `${load.activeIncidents} active incidents.`,
          `${load.pendingApprovals} pending approvals.`,
          `${load.delegatedRemediations} delegated remediations.`,
          load.overloaded ? "Current load is already above the safe threshold." : null,
          load.backupOperator ? `Backup operator ${load.backupOperator} is available.` : null,
        ]),
        horizonMinutes: load.overloaded ? 15 : 60,
        id: `operator:${load.principal}`,
        impactedEntityId: load.principal,
        impactedEntityType: "operator",
        recommendedActions: uniqueStrings([
          load.backupOperator ? `Pre-stage rerouting to ${load.backupOperator}.` : "Identify a standby operator for this workload slice.",
          "Reduce concurrent approvals before adding new incident ownership.",
          load.regions[0] ? `Rebalance traffic away from ${load.regions[0]} if queue pressure keeps rising.` : null,
        ]),
        severity: toSeverity(score),
        signal: toSignal(score),
        summary: `${load.principal} is approaching operator saturation and may become a routing bottleneck.`,
        title: `Overload forecast for ${load.principal}`,
        type: "operator_overload",
      };
    })
    .filter((prediction) => prediction.confidencePercent >= 55)
    .sort(byOperationalSeverity)
    .slice(0, 6);

const buildQueuePrediction = ({
  deadLetters,
  jobs,
  runtimeVisibility,
}: Pick<OperationalIntelligenceInput, "deadLetters" | "jobs" | "runtimeVisibility">) => {
  const queuedJobs = jobs.filter((job) => job.status === "queued").length;
  const score = clamp(
    queuedJobs * 1.2 +
      deadLetters.length * 10 +
      runtimeVisibility.retryCount * 0.6 +
      runtimeVisibility.queueLatencyP95Ms / 60 +
      runtimeVisibility.queueLagMs / 30_000,
    0,
    99,
  );

  if (score < 45) {
    return null;
  }

  return {
    confidencePercent: round(score),
    evidence: uniqueStrings([
      `${queuedJobs} queued jobs are waiting.`,
      `${deadLetters.length} dead-letter items are present.`,
      `Queue lag is ${Math.round(runtimeVisibility.queueLagMs)}ms.`,
      `Queue latency p95 is ${Math.round(runtimeVisibility.queueLatencyP95Ms)}ms.`,
    ]),
    horizonMinutes: runtimeVisibility.queueLagMs >= 15 * 60_000 ? 20 : 90,
    id: "queue:forecast",
    impactedEntityId: "queue",
    impactedEntityType: "queue",
    recommendedActions: [
      "Run a previewed due-job sweep before adding more replay traffic.",
      "Suppress retry storms if queue latency keeps climbing.",
      "Stage replay batches instead of bulk draining dead letters.",
    ],
    severity: toSeverity(score),
    signal: toSignal(score),
    summary: "Queue pressure is likely to convert into operator-facing incidents if throughput is not rebalanced.",
    title: "Queue backlog forecast",
    type: "queue_backlog",
  } satisfies AdminOperationalPrediction;
};

const buildPaymentPrediction = ({
  billingOperations,
}: Pick<OperationalIntelligenceInput, "billingOperations">) => {
  const score = clamp(
    billingOperations.paymentRetryRate * 1.7 +
      billingOperations.duplicatePayments * 14 +
      billingOperations.manualReviewPayments * 8 +
      billingOperations.stuckPayments * 18 +
      billingOperations.webhookRetries * 0.4,
    0,
    99,
  );

  if (score < 40) {
    return null;
  }

  return {
    confidencePercent: round(score),
    evidence: uniqueStrings([
      `${billingOperations.paymentRetryRate.toFixed(2)}% payment retry rate.`,
      `${billingOperations.stuckPayments} stuck payments.`,
      `${billingOperations.manualReviewPayments} manual-review payments.`,
      `${billingOperations.duplicatePayments} duplicate detections.`,
    ]),
    horizonMinutes: billingOperations.stuckPayments > 0 ? 30 : 120,
    id: "payment:forecast",
    impactedEntityId: "payments",
    impactedEntityType: "payment",
    recommendedActions: [
      "Hold bulk replays until dependency health is green.",
      "Review duplicate-risk previews before refund or capture retries.",
      "Escalate webhook reconciliation if stuck payments continue growing.",
    ],
    severity: toSeverity(score),
    signal: toSignal(score),
    summary: "Payment reconciliation drift is building and may produce visible billing incidents if left uncoordinated.",
    title: "Payment anomaly detection",
    type: "payment_anomaly",
  } satisfies AdminOperationalPrediction;
};

const buildAuthPrediction = ({
  failedLoginCount,
  runtimeVisibility,
  suspiciousIps,
}: Pick<OperationalIntelligenceInput, "failedLoginCount" | "runtimeVisibility" | "suspiciousIps">) => {
  const suspiciousFailures = suspiciousIps.reduce((sum, entry) => sum + entry.failures, 0);
  const score = clamp(
    failedLoginCount * 3 + runtimeVisibility.otpDeliveryFailures * 5 + suspiciousIps.length * 10 + suspiciousFailures,
    0,
    99,
  );

  if (score < 35) {
    return null;
  }

  return {
    confidencePercent: round(score),
    evidence: uniqueStrings([
      `${failedLoginCount} failed logins in the current operational window.`,
      `${runtimeVisibility.otpDeliveryFailures} OTP failures.`,
      `${suspiciousIps.length} suspicious IP clusters.`,
    ]),
    horizonMinutes: score >= 70 ? 20 : 90,
    id: "auth:forecast",
    impactedEntityId: "auth",
    impactedEntityType: "auth",
    recommendedActions: [
      "Prepare rate-limit tightening before the spike becomes operator-visible.",
      "Route auth review to the lowest-load security operator.",
      "Cross-check OTP delivery health before assuming malicious traffic alone.",
    ],
    severity: toSeverity(score),
    signal: toSignal(score),
    summary: "Authentication failures are trending toward an incident spike and may need proactive routing.",
    title: "Auth failure spike prediction",
    type: "auth_failure_spike",
  } satisfies AdminOperationalPrediction;
};

const buildGovernanceDriftPrediction = (
  snapshot: AdminOperatorGovernanceSnapshot | null | undefined,
) => {
  if (!snapshot) {
    return null;
  }

  const score = clamp(
    snapshot.synchronization.driftAlertCount * 22 +
      snapshot.synchronization.staleApprovalCount * 12 +
      snapshot.synchronization.tenantConsistencyGaps * 18 +
      (snapshot.synchronization.propagationHealth === "critical"
        ? 25
        : snapshot.synchronization.propagationHealth === "warning"
          ? 10
          : 0),
    0,
    99,
  );

  if (score < 35) {
    return null;
  }

  return {
    confidencePercent: round(score),
    evidence: uniqueStrings([
      `${snapshot.synchronization.driftAlertCount} drift alerts.`,
      `${snapshot.synchronization.staleApprovalCount} stale approvals.`,
      `${snapshot.synchronization.tenantConsistencyGaps} tenant consistency gaps.`,
      snapshot.synchronization.propagationHealthSummary,
    ]),
    horizonMinutes: snapshot.synchronization.propagationHealth === "critical" ? 30 : 180,
    id: "governance:forecast",
    impactedEntityId: snapshot.consistency.governanceVersion,
    impactedEntityType: "governance",
    recommendedActions: [
      "Reconcile invalidated governance snapshots before new emergency approvals.",
      "Preview approval-chain cleanup and stale elevation rollback together.",
      "Escalate tenant-isolation review if drift keeps widening.",
    ],
    severity: toSeverity(score),
    signal: toSignal(score),
    summary: "Governance state is drifting and could block or misroute coordinated operator actions.",
    title: "Governance drift forecast",
    type: "governance_drift",
  } satisfies AdminOperationalPrediction;
};

const buildPredictions = (input: OperationalIntelligenceInput) =>
  [
    ...buildIncidentEscalationPredictions(input.incidents),
    ...buildOverloadPredictions(input.operatorGovernance),
    buildGovernanceDriftPrediction(input.operatorGovernance),
    buildQueuePrediction(input),
    buildPaymentPrediction(input),
    buildAuthPrediction(input),
  ]
    .filter((value): value is AdminOperationalPrediction => Boolean(value))
    .sort(byOperationalSeverity)
    .slice(0, 12);

const resolveShiftScore = (status: string) => {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === "active") {
    return 100;
  }

  if (normalized === "standby") {
    return 88;
  }

  if (normalized === "backup" || normalized === "after_hours") {
    return 80;
  }

  if (normalized === "unknown") {
    return 60;
  }

  if (normalized === "away") {
    return 25;
  }

  if (normalized === "offline") {
    return 10;
  }

  return 50;
};

const buildDependencyHealthScore = (runtimeVisibility: AdminRuntimeVisibility, runtimeGovernance: AdminRuntimeGovernanceState) => {
  let score = 100;
  score -= runtimeVisibility.redisDegraded ? 35 : 0;
  score -= Math.min(25, runtimeVisibility.paymentRetryRate * 0.5);
  score -= Math.min(20, runtimeVisibility.emailFailureRate);
  score -= runtimeVisibility.queueLagMs >= 15 * 60_000 ? 20 : runtimeVisibility.queueLagMs >= 5 * 60_000 ? 10 : 0;
  score -= runtimeGovernance.stripeDependencyEnabled === false ? 25 : 0;
  return clamp(round(score), 0, 100);
};

const buildRoutingRecommendations = (input: OperationalIntelligenceInput) => {
  const coordination = input.operatorGovernance?.coordination;
  if (!coordination) {
    return [];
  }

  const dependencyHealthScore = buildDependencyHealthScore(input.runtimeVisibility, input.runtimeGovernance);
  const operatorLoads = coordination.loadBalancing.operatorLoads;

  return input.incidents
    .filter((incident) => incident.unresolvedCount > 0)
    .map<AdminAdaptiveRoutingRecommendation | null>((incident) => {
      const incidentRegion = normalizeText(incident.regionLabel);
      const regionCell =
        coordination.loadBalancing.heatmap.find((cell) => normalizeText(cell.label) === incidentRegion) ??
        coordination.loadBalancing.heatmap.find((cell) => normalizeText(cell.label) === "Global") ??
        null;

      const candidates = operatorLoads
        .map((load) => {
          const regionMatch = incidentRegion
            ? load.regions.some((region) => normalizeText(region) === incidentRegion)
            : false;
          const workloadScore = clamp(round(100 - load.utilizationPercent), 0, 100);
          const timezoneScore = resolveShiftScore(load.shiftState);
          const regionHealthScore = clamp(
            round(100 - Math.max(regionCell?.utilizationPercent ?? 0, regionMatch ? 0 : 12)),
            0,
            100,
          );
          const responseQualityScore = clamp(
            round(
              62 +
                load.delegatedRemediations * 8 -
                load.pendingApprovals * 7 -
                (load.overloaded ? 18 : 0) +
                (load.backupOperator ? 8 : 0) +
                (regionMatch ? 6 : 0),
            ),
            0,
            100,
          );
          const composite = round(
            workloadScore * 0.35 +
              timezoneScore * 0.2 +
              regionHealthScore * 0.15 +
              dependencyHealthScore * 0.1 +
              responseQualityScore * 0.2 +
              (regionMatch ? 6 : 0) +
              (incident.afterHoursEscalated && ["standby", "backup", "after_hours"].includes(load.shiftState) ? 6 : 0),
          );

          return {
            composite,
            load,
            regionHealthScore,
            regionMatch,
            responseQualityScore,
            timezoneScore,
            workloadScore,
          };
        })
        .sort((left, right) => right.composite - left.composite || left.load.principal.localeCompare(right.load.principal));

      const best = candidates[0];
      if (!best || best.composite < 45) {
        return null;
      }

      const recommendedRoute = uniqueStrings([
        incident.ownerEmail,
        best.load.principal,
        best.load.backupOperator,
      ]);

      return {
        confidencePercent: clamp(best.composite, 0, 99),
        dependencyHealthScore,
        id: `route:${incident.incidentKey}`,
        incidentKey: incident.incidentKey,
        rationale: uniqueStrings([
          best.regionMatch ? `Regional affinity matches ${incidentRegion || "the active region"}.` : "No exact regional match was available, so load balance dominated.",
          best.load.overloaded ? `${best.load.principal} is already overloaded.` : `${best.load.principal} still has safe headroom.`,
          incident.afterHoursEscalated ? "After-hours coordination is already active." : null,
          incident.crossTeamEscalation ? "Cross-team routing is already in play." : null,
          best.load.backupOperator ? `Backup chain is available through ${best.load.backupOperator}.` : null,
        ]),
        recommendedRegion: best.load.regions[0] ?? incident.regionLabel ?? null,
        recommendedResponder: best.load.principal,
        recommendedRoute,
        regionHealthScore: best.regionHealthScore,
        responseQualityScore: best.responseQualityScore,
        safeAutoAssign:
          Boolean(incident.unresolvedOwnership) &&
          best.composite >= 78 &&
          !best.load.overloaded &&
          best.timezoneScore >= 80 &&
          incident.severity !== "CRITICAL",
        severity: toSeverity(getIncidentPriorityScore(incident)),
        targetId: incident.incidentKey,
        targetType: "incident",
        timezoneScore: best.timezoneScore,
        workloadScore: best.workloadScore,
      };
    })
    .filter((value): value is AdminAdaptiveRoutingRecommendation => Boolean(value))
    .sort(byOperationalSeverity)
    .slice(0, 8);
};

const buildRecommendationEngine = ({
  predictions,
  remediationPlans,
  routingRecommendations,
}: {
  predictions: AdminOperationalPrediction[];
  remediationPlans: AdminOperationalRemediationPlan[];
  routingRecommendations: AdminAdaptiveRoutingRecommendation[];
}) => {
  const recommendations: AdminOperationalRecommendation[] = [];

  const topRoute = routingRecommendations[0];
  if (topRoute?.recommendedResponder) {
    recommendations.push({
      id: `recommendation:responder:${topRoute.id}`,
      kind: "responder",
      primaryAction: `Route to ${topRoute.recommendedResponder}`,
      rationale: topRoute.rationale,
      severity: topRoute.severity,
      summary: `Best-fit responder is ${topRoute.recommendedResponder} with ${topRoute.workloadScore}% workload headroom and ${topRoute.timezoneScore}% timezone readiness.`,
      targetId: topRoute.targetId,
      targetType: "incident",
      title: "Recommended responder",
    });
  }

  const topPrediction = predictions.find((prediction) => prediction.type === "incident_escalation");
  if (topPrediction) {
    recommendations.push({
      id: `recommendation:escalation:${topPrediction.id}`,
      kind: "escalation_path",
      primaryAction: topPrediction.recommendedActions[0] ?? "Re-stage the escalation path",
      rationale: topPrediction.evidence,
      severity: topPrediction.severity,
      summary: topPrediction.summary,
      targetId: topPrediction.impactedEntityId,
      targetType: "incident",
      title: "Recommended escalation path",
    });
  }

  const replayPlan = remediationPlans.find((plan) => plan.kind === "queue_replay");
  if (replayPlan) {
    recommendations.push({
      id: `recommendation:replay:${replayPlan.id}`,
      kind: "safe_replay",
      primaryAction: replayPlan.previewSummary,
      rationale: replayPlan.guardrails,
      severity: replayPlan.severity,
      summary: replayPlan.summary,
      targetId: replayPlan.linkedTargets[0]?.id ?? "queue",
      targetType: "queue",
      title: "Safe replay recommendation",
    });
  }

  const overloadPrediction = predictions.find((prediction) => prediction.type === "operator_overload");
  if (overloadPrediction) {
    recommendations.push({
      id: `recommendation:routing:${overloadPrediction.id}`,
      kind: "routing",
      primaryAction: overloadPrediction.recommendedActions[0] ?? "Rebalance routing away from the hottest operator",
      rationale: overloadPrediction.evidence,
      severity: overloadPrediction.severity,
      summary: overloadPrediction.summary,
      targetId: overloadPrediction.impactedEntityId,
      targetType: "operator",
      title: "Workload-aware routing suggestion",
    });
  }

  const nextPlan = remediationPlans.find((plan) => plan.kind !== "queue_replay");
  if (nextPlan) {
    recommendations.push({
      id: `recommendation:remediation:${nextPlan.id}`,
      kind: "remediation",
      primaryAction: nextPlan.previewSummary,
      rationale: nextPlan.guardrails,
      severity: nextPlan.severity,
      summary: nextPlan.summary,
      targetId: nextPlan.linkedTargets[0]?.id ?? null,
      targetType: nextPlan.linkedTargets[0]?.kind === "incident" ? "incident" : "queue",
      title: "Remediation suggestion",
    });
  }

  const dependencyPrediction = predictions.find((prediction) =>
    ["payment_anomaly", "queue_backlog", "auth_failure_spike", "governance_drift"].includes(prediction.type),
  );
  if (dependencyPrediction) {
    recommendations.push({
      id: `recommendation:dependency:${dependencyPrediction.id}`,
      kind: "dependency_warning",
      primaryAction: dependencyPrediction.recommendedActions[0] ?? "Review dependency risk before automation proceeds",
      rationale: dependencyPrediction.evidence,
      severity: dependencyPrediction.severity,
      summary: dependencyPrediction.summary,
      targetId: dependencyPrediction.impactedEntityId,
      targetType: dependencyPrediction.impactedEntityType === "payment" ? "payment" : "dependency",
      title: "Dependency-risk warning",
    });
  }

  return recommendations.sort(byOperationalSeverity).slice(0, 6);
};

const buildRemediationPlans = (input: OperationalIntelligenceInput) => {
  const nowMs = Date.parse(input.generatedAt || "");
  const runtimeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const plans: AdminOperationalRemediationPlan[] = [];
  const criticalIncidents = input.incidents.filter((incident) => incident.severity === "CRITICAL" && incident.unresolvedCount > 0).length;
  const recoverableJobs = input.jobs.filter(
    (job) =>
      job.status === "running" &&
      shouldRecoverRunningJob({
        nowMs: runtimeNowMs,
        payload: job.payload,
        startedAt: job.startedAt,
        visibilityTimeoutAt: job.visibilityTimeoutAt,
      }),
  );

  if (input.deadLetters.length > 0) {
    plans.push({
      auditTrail: [
        "Record replay preview, trace lineage, and duplicate-risk assessment.",
        "Record every re-enqueue decision with request and correlation IDs.",
        "Record any remediation failure and downstream escalation.",
      ],
      automationLevel:
        !input.runtimeGovernance.queueProcessingEnabled || input.runtimeVisibility.redisDegraded
          ? "blocked"
          : input.deadLetters.length <= 3 && criticalIncidents === 0
            ? "guarded_auto"
            : "manual",
      escalateOnFailure: true,
      guardrails: [
        "Require dry-run preview before replaying any dead-letter job.",
        "Block bulk replay when queue processing is paused or Redis is degraded.",
        "Escalate immediately if duplicate-risk or dependency-risk becomes non-trivial.",
      ],
      id: "remediation:queue_replay",
      kind: "queue_replay",
      linkedTargets: input.deadLetters.slice(0, 5).map((row) => ({ id: row.jobId, kind: "job" as const })),
      previewSummary: `Simulate replay ordering for ${input.deadLetters.length} dead-letter jobs and verify queue health before enqueue.`,
      rollbackSummary: "Cancel replayed jobs and preserve dead-letter lineage if downstream failures appear.",
      safeToAutoRun:
        input.deadLetters.length <= 3 &&
        input.runtimeGovernance.queueProcessingEnabled &&
        !input.runtimeVisibility.redisDegraded &&
        criticalIncidents === 0,
      severity: toSeverity(clamp(input.deadLetters.length * 18 + input.runtimeVisibility.queueLagMs / 45_000, 0, 99)),
      summary: `${input.deadLetters.length} dead-letter jobs can be replayed safely only behind preview, audit, and rollback controls.`,
      title: "Queue replay remediation",
    });
  }

  if (recoverableJobs.length > 0) {
    plans.push({
      auditTrail: [
        "Record stuck-job detection inputs, lease expiry, and chosen recovery path.",
        "Record recovered worker ownership and follow-up queue state.",
      ],
      automationLevel: input.runtimeVisibility.redisDegraded ? "manual" : "guarded_auto",
      escalateOnFailure: true,
      guardrails: [
        "Recover only jobs whose heartbeat or visibility window is stale.",
        "Do not recover jobs that still have an active operator claim.",
      ],
      id: "remediation:stuck_job_recovery",
      kind: "stuck_job_recovery",
      linkedTargets: recoverableJobs.slice(0, 5).map((job) => ({ id: job.id, kind: "job" as const })),
      previewSummary: `Simulate lease recovery for ${recoverableJobs.length} running jobs before mutating queue state.`,
      rollbackSummary: "Reinstate worker ownership or requeue the recovered jobs if recovery causes duplicate execution risk.",
      safeToAutoRun: !input.runtimeVisibility.redisDegraded && recoverableJobs.length <= 5,
      severity: toSeverity(clamp(recoverableJobs.length * 18 + input.runtimeVisibility.queueLatencyP95Ms / 55, 0, 99)),
      summary: `${recoverableJobs.length} running jobs appear stale enough for guarded recovery.`,
      title: "Stuck-job recovery",
    });
  }

  if (
    input.runtimeVisibility.redisDegraded ||
    input.runtimeVisibility.emailFailureRate >= 15 ||
    input.billingOperations.paymentRetryRate >= 20 ||
    input.runtimeGovernance.stripeDependencyEnabled === false
  ) {
    plans.push({
      auditTrail: [
        "Record dependency isolation mode and impacted automation surfaces.",
        "Record the exact fallback route taken for operator review.",
      ],
      automationLevel: "guarded_auto",
      escalateOnFailure: true,
      guardrails: [
        "Fallback must remain reversible and auditable.",
        "Do not widen degraded mode without explicit dependency evidence.",
      ],
      id: "remediation:dependency_fallback",
      kind: "degraded_dependency_fallback",
      linkedTargets: [{ id: "runtime_dependencies", kind: "queue" }],
      previewSummary: "Preview degraded-mode routing and dependency isolation before changing runtime behavior.",
      rollbackSummary: "Restore normal dependency routing once health signals return to green.",
      safeToAutoRun: true,
      severity: toSeverity(
        clamp(
          (input.runtimeVisibility.redisDegraded ? 50 : 0) +
            input.runtimeVisibility.emailFailureRate +
            input.billingOperations.paymentRetryRate,
          0,
          99,
        ),
      ),
      summary: "Dependency fallback can protect the runtime, but only if degraded-mode transitions stay previewed and reversible.",
      title: "Dependency fallback",
    });
  }

  const activeElevations = input.operatorGovernance?.activeElevations ?? [];
  const nearExpiryElevations = activeElevations.filter((elevation) => (elevation.countdownSeconds ?? Number.POSITIVE_INFINITY) <= 15 * 60);
  if (nearExpiryElevations.length > 0 || (input.operatorGovernance?.synchronization.staleApprovalCount ?? 0) > 0) {
    plans.push({
      auditTrail: [
        "Record which elevation windows or approvals were flagged as stale.",
        "Record cleanup preview, revocation timing, and any approval-chain follow-up.",
      ],
      automationLevel: "guarded_auto",
      escalateOnFailure: true,
      guardrails: [
        "Preview all grant removals before execution.",
        "Do not revoke an elevation that is still backing an active critical incident without reassignment.",
      ],
      id: "remediation:stale_elevation_cleanup",
      kind: "stale_elevation_cleanup",
      linkedTargets: nearExpiryElevations.slice(0, 5).map((entry) => ({ id: entry.grantId, kind: "operator" as const })),
      previewSummary: `Simulate cleanup for ${Math.max(nearExpiryElevations.length, input.operatorGovernance?.synchronization.staleApprovalCount ?? 0)} stale access paths before revocation.`,
      rollbackSummary: "Restore the revoked elevation only if cleanup breaks an active governed workflow.",
      safeToAutoRun: criticalIncidents === 0,
      severity: toSeverity(
        clamp(
          nearExpiryElevations.length * 18 + (input.operatorGovernance?.synchronization.staleApprovalCount ?? 0) * 15,
          0,
          99,
        ),
      ),
      summary: "Temporary elevations and stale approvals should be reconciled before they widen governance drift.",
      title: "Stale elevation cleanup",
    });
  }

  const abandonedIncidents = input.incidents.filter((incident) => incident.unresolvedOwnership && incident.unresolvedCount > 0);
  if (abandonedIncidents.length > 0) {
    plans.push({
      auditTrail: [
        "Record the ownership gap, recommended responder, and any follow-the-sun handoff.",
        "Record reassignment decision and notification lineage.",
      ],
      automationLevel: abandonedIncidents.some((incident) => incident.severity === "CRITICAL") ? "manual" : "guarded_auto",
      escalateOnFailure: true,
      guardrails: [
        "Always preview reassignment before changing ownership.",
        "Do not auto-assign critical incidents without an explicit approved routing path.",
      ],
      id: "remediation:incident_reassignment",
      kind: "abandoned_incident_reassignment",
      linkedTargets: abandonedIncidents.slice(0, 5).map((incident) => ({ id: incident.incidentKey, kind: "incident" as const })),
      previewSummary: `Simulate reassignment for ${abandonedIncidents.length} incidents with ownership gaps before notifying responders.`,
      rollbackSummary: "Return ownership to the prior responder or clear the assignment if the reroute proves unsafe.",
      safeToAutoRun: abandonedIncidents.every((incident) => incident.severity !== "CRITICAL"),
      severity: toSeverity(clamp(abandonedIncidents.length * 20 + criticalIncidents * 15, 0, 99)),
      summary: "Abandoned incident reassignment should stay guarded so follow-the-sun coordination remains explicit.",
      title: "Abandoned incident reassignment",
    });
  }

  const driftSignals =
    (input.operatorGovernance?.synchronization.driftAlertCount ?? 0) +
    (input.operatorGovernance?.synchronization.tenantConsistencyGaps ?? 0) +
    (input.operatorGovernance?.conflicts.filter((conflict) => conflict.kind === "governance_drift").length ?? 0);
  if (driftSignals > 0) {
    plans.push({
      auditTrail: [
        "Record divergence inputs, impacted tenants, and cache invalidation scope.",
        "Record the reconciliation preview and any post-run consistency checks.",
      ],
      automationLevel:
        input.operatorGovernance?.synchronization.propagationHealth === "critical" ? "manual" : "guarded_auto",
      escalateOnFailure: true,
      guardrails: [
        "Require a preview simulation before reconciling governance snapshots.",
        "Block auto-reconciliation when tenant isolation is already violated.",
      ],
      id: "remediation:governance_reconciliation",
      kind: "governance_drift_reconciliation",
      linkedTargets: [{ id: input.operatorGovernance?.consistency.governanceVersion ?? "governance", kind: "approval_request" }],
      previewSummary: `Simulate governance reconciliation for ${driftSignals} active drift signals before mutating approvals or grants.`,
      rollbackSummary: "Restore the previous governance snapshot if propagation health worsens after reconciliation.",
      safeToAutoRun:
        input.operatorGovernance?.synchronization.propagationHealth !== "critical" &&
        input.operatorGovernance?.analytics.tenantIsolationViolations === 0,
      severity: toSeverity(
        clamp(
          driftSignals * 18 +
            (input.operatorGovernance?.synchronization.propagationHealth === "critical" ? 20 : 0),
          0,
          99,
        ),
      ),
      summary: "Governance reconciliation should close drift without introducing opaque control-plane behavior.",
      title: "Governance drift reconciliation",
    });
  }

  return plans.sort(byOperationalSeverity);
};

const buildHealthScores = (input: OperationalIntelligenceInput) => {
  const snapshot = input.operatorGovernance;
  const totalOperators = Math.max(1, snapshot?.analytics.operatorWorkload.totalOperators ?? 0);
  const overloadedOperators = snapshot?.analytics.operatorWorkload.overloaded ?? 0;
  const escalatedIncidents = input.incidents.filter((incident) => incident.escalationLevel > 0).length;
  const breachedIncidents = input.incidents.filter((incident) => incident.slaBreached).length;
  const unresolvedOwnership = input.incidents.filter((incident) => incident.unresolvedOwnership).length;
  const approvalLatencyAverage = snapshot?.analytics.approvalLatencyMinutes.average ?? 0;
  const approvalLatencyP95 = snapshot?.analytics.approvalLatencyMinutes.p95 ?? 0;
  const driftAlertCount = snapshot?.synchronization.driftAlertCount ?? 0;
  const staleApprovalCount = snapshot?.synchronization.staleApprovalCount ?? 0;
  const tenantConsistencyGaps = snapshot?.synchronization.tenantConsistencyGaps ?? 0;
  const tenantIsolationViolations = snapshot?.analytics.tenantIsolationViolations ?? 0;
  const escalationBottlenecks = snapshot?.analytics.escalationBottlenecks ?? 0;
  const queueReplayRisk = input.deadLetters.length * 8 + (input.runtimeVisibility.redisDegraded ? 20 : 0) + input.runtimeVisibility.queueLagMs / 60_000;

  const tenantGovernanceHealth = clamp(100 - tenantIsolationViolations * 30 - driftAlertCount * 12 - staleApprovalCount * 8, 0, 100);
  const escalationEfficiency = clamp(100 - escalationBottlenecks * 16 - escalatedIncidents * 5 - unresolvedOwnership * 10, 0, 100);
  const approvalLatencyHealth = clamp(100 - approvalLatencyAverage * 2 - approvalLatencyP95 * 0.6, 0, 100);
  const operatorSaturation = clamp(100 - (overloadedOperators / totalOperators) * 100, 0, 100);
  const incidentAging = clamp(100 - breachedIncidents * 15 - unresolvedOwnership * 10 - escalatedIncidents * 6, 0, 100);
  const replaySafety = clamp(100 - queueReplayRisk, 0, 100);
  const operationalDrift = clamp(100 - driftAlertCount * 15 - staleApprovalCount * 10 - tenantConsistencyGaps * 15, 0, 100);

  return [
    {
      drivers: [
        `${tenantIsolationViolations} tenant isolation violations.`,
        `${driftAlertCount} drift alerts.`,
        `${staleApprovalCount} stale approvals.`,
      ],
      key: "tenant_governance_health",
      label: "Tenant governance health",
      score: round(tenantGovernanceHealth),
      status: toHealthStatus(tenantGovernanceHealth),
      summary: "Measures how safely governance remains segmented and synchronized across tenants.",
    },
    {
      drivers: [
        `${escalationBottlenecks} escalation bottlenecks.`,
        `${unresolvedOwnership} incidents without stable ownership.`,
      ],
      key: "escalation_efficiency",
      label: "Escalation efficiency",
      score: round(escalationEfficiency),
      status: toHealthStatus(escalationEfficiency),
      summary: "Measures whether escalation chains are flowing cleanly or stalling during coordination.",
    },
    {
      drivers: [
        `${approvalLatencyAverage.toFixed(2)} minute average approval latency.`,
        `${approvalLatencyP95.toFixed(2)} minute p95 approval latency.`,
      ],
      key: "approval_latency",
      label: "Approval latency",
      score: round(approvalLatencyHealth),
      status: toHealthStatus(approvalLatencyHealth),
      summary: "Measures how quickly governed actions can move without falling back to overrides.",
    },
    {
      drivers: [
        `${overloadedOperators} overloaded operators.`,
        `${totalOperators} total routed operators.`,
      ],
      key: "operator_saturation",
      label: "Operator saturation",
      score: round(operatorSaturation),
      status: toHealthStatus(operatorSaturation),
      summary: "Measures how much safe routing headroom remains across active operators.",
    },
    {
      drivers: [
        `${breachedIncidents} SLA-breached incidents.`,
        `${escalatedIncidents} escalated incidents.`,
      ],
      key: "incident_aging",
      label: "Incident aging",
      score: round(incidentAging),
      status: toHealthStatus(incidentAging),
      summary: "Measures how quickly incidents are aging toward deeper operational risk.",
    },
    {
      drivers: [
        `${input.deadLetters.length} dead-letter jobs.`,
        `${Math.round(input.runtimeVisibility.queueLagMs)}ms queue lag.`,
      ],
      key: "replay_safety",
      label: "Replay safety",
      score: round(replaySafety),
      status: toHealthStatus(replaySafety),
      summary: "Measures whether replay and queue recovery can stay safe under current runtime conditions.",
    },
    {
      drivers: [
        `${driftAlertCount} governance drift alerts.`,
        `${tenantConsistencyGaps} tenant consistency gaps.`,
      ],
      key: "operational_drift",
      label: "Operational drift",
      score: round(operationalDrift),
      status: toHealthStatus(operationalDrift),
      summary: "Measures how far runtime and governance state are diverging from the intended operating model.",
    },
  ] satisfies AdminOperationalHealthScore[];
};

const buildSimulations = ({
  predictions,
  remediationPlans,
  routingRecommendations,
  snapshot,
}: {
  predictions: AdminOperationalPrediction[];
  remediationPlans: AdminOperationalRemediationPlan[];
  routingRecommendations: AdminAdaptiveRoutingRecommendation[];
  snapshot: AdminOperatorGovernanceSnapshot | null | undefined;
}) => {
  const failoverPressure = snapshot?.coordination.regionalFailovers.length ?? 0;
  const incidentRisk = predictions.find((prediction) => prediction.type === "incident_escalation");
  const replayPlan = remediationPlans.find((plan) => plan.kind === "queue_replay");
  const governancePlan = remediationPlans.find((plan) => plan.kind === "governance_drift_reconciliation");
  const overloadRisk = predictions.find((prediction) => prediction.type === "operator_overload");

  return [
    {
      estimatedRisk: incidentRisk?.severity === "critical" ? "high" : incidentRisk?.severity === "high" ? "medium" : "low",
      expectedOutcome: "Forecast whether the current open incident set will breach more SLAs or require cross-region handoffs.",
      guardrails: [
        "Use live routing recommendations instead of mutating ownership automatically.",
        "Record predicted escalation drivers before any operator action.",
      ],
      id: "simulation:incident",
      kind: "incident",
      readiness: routingRecommendations.length > 0 ? "ready" : "caution",
      summary: "Dry-run the current incident set against routing and escalation heuristics.",
      title: "Incident simulation",
    },
    {
      estimatedRisk:
        replayPlan?.severity === "critical" ? "high" : replayPlan?.severity === "high" ? "medium" : "low",
      expectedOutcome: "Validate replay ordering, dependency safety, and duplicate-risk before any dead-letter recovery.",
      guardrails: replayPlan?.guardrails ?? [
        "Require previewed replay batches.",
        "Block replay when dependency state is degraded.",
      ],
      id: "simulation:replay",
      kind: "replay",
      readiness: replayPlan?.automationLevel === "blocked" ? "blocked" : replayPlan ? "ready" : "caution",
      summary: "Dry-run queue replay and observe projected pressure on runtime dependencies.",
      title: "Replay simulation",
    },
    {
      estimatedRisk: failoverPressure > 0 ? "high" : "medium",
      expectedOutcome: "Test whether follow-the-sun rerouting can absorb a regional incident without overloading standby coverage.",
      guardrails: [
        "Use routing previews rather than immediate ownership swaps.",
        "Confirm standby capacity before simulating region evacuation.",
      ],
      id: "simulation:failover",
      kind: "failover",
      readiness: (snapshot?.coordination.followTheSun.standbyOperators ?? 0) > 0 ? "ready" : "caution",
      summary: "Dry-run regional failover across currently active follow-the-sun coverage.",
      title: "Failover simulation",
    },
    {
      estimatedRisk:
        governancePlan?.severity === "critical" ? "high" : governancePlan?.severity === "high" ? "medium" : "low",
      expectedOutcome: "Test snapshot reconciliation and approval cleanup before applying governance corrections.",
      guardrails: governancePlan?.guardrails ?? [
        "Require a reconciliation preview.",
        "Avoid opaque policy changes during incident response.",
      ],
      id: "simulation:governance",
      kind: "governance",
      readiness: governancePlan?.automationLevel === "blocked" ? "blocked" : governancePlan ? "ready" : "caution",
      summary: "Dry-run governance impact and drift reconciliation before changing grants or approvals.",
      title: "Governance impact simulation",
    },
    {
      estimatedRisk:
        overloadRisk?.severity === "critical" ? "high" : overloadRisk?.severity === "high" ? "medium" : "low",
      expectedOutcome: "Project whether the current escalation load will overflow operators or approval queues on the next shift boundary.",
      guardrails: [
        "Model operator capacity before broad escalations.",
        "Prefer rerouting suggestions over uncontrolled reassignment.",
      ],
      id: "simulation:escalation",
      kind: "escalation",
      readiness: routingRecommendations.length > 0 ? "ready" : "caution",
      summary: "Dry-run escalation load across current operator headroom and standby chains.",
      title: "Escalation load simulation",
    },
  ] satisfies AdminOperationalSimulation[];
};

export const buildOperationalIntelligenceSnapshot = (
  input: OperationalIntelligenceInput,
): AdminOperationalIntelligenceSnapshot => {
  const generatedAt = normalizeText(input.generatedAt) || new Date().toISOString();
  const predictions = buildPredictions({ ...input, generatedAt });
  const routingRecommendations = buildRoutingRecommendations({ ...input, generatedAt });
  const remediationPlans = buildRemediationPlans({ ...input, generatedAt });
  const governanceHealth = buildHealthScores({ ...input, generatedAt });
  const recommendations = buildRecommendationEngine({
    predictions,
    remediationPlans,
    routingRecommendations,
  });
  const simulations = buildSimulations({
    predictions,
    remediationPlans,
    routingRecommendations,
    snapshot: input.operatorGovernance,
  });

  return {
    generatedAt,
    governanceHealth,
    predictions,
    recommendations,
    remediationPlans,
    routingRecommendations,
    simulations,
  };
};
