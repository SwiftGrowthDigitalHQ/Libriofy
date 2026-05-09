import { describe, expect, it } from "vitest";

import { buildOperationalAlerts, buildTraceTimeline } from "@/lib/superAdmin/model";
import { buildReplayedJobPayload, readJobQueueMetadata, readJobTraceMetadata } from "@/lib/superAdmin/queueRuntime";

describe("super admin operational model helpers", () => {
  it("reconstructs a retry chain across incident, queue, payment, and audit tokens", () => {
    const timeline = buildTraceTimeline({
      events: [
        {
          id: "incident-1",
          incidentKey: "incident-key",
          message: "Queue failure surfaced as an incident.",
          occurredAt: "2026-05-07T10:00:00.000Z",
          severity: "ERROR",
          source: "incident",
          status: "OPEN",
          tokens: ["trace-1"],
          type: "QUEUE_FAILURE",
        },
        {
          correlationId: "corr-1",
          id: "job-1",
          message: "Job retry scheduled.",
          occurredAt: "2026-05-07T10:01:00.000Z",
          queueJobId: "job-1",
          requestId: "req-1",
          severity: "WARNING",
          source: "job",
          status: "retried",
          tokens: ["trace-1", "payment-1"],
          traceId: "trace-1",
          type: "PLATFORM_JOB_RETRY_SCHEDULED",
        },
        {
          id: "payment-1",
          message: "Payment verification completed.",
          occurredAt: "2026-05-07T10:02:00.000Z",
          paymentReference: "payment-1",
          requestId: "req-1",
          source: "payment",
          status: "SUCCESS",
          tokens: ["corr-1"],
          type: "PAYMENT_SUCCESS",
        },
        {
          id: "audit-1",
          message: "Operator replayed the dead-letter job.",
          occurredAt: "2026-05-07T10:03:00.000Z",
          requestId: "req-1",
          source: "audit_log",
          status: "SUCCESS",
          tokens: ["job-1"],
          type: "job_replayed_from_dead_letter",
        },
      ],
      seedTokens: ["incident-key"],
    });

    expect(timeline.map((event) => event.id)).toEqual([
      "incident-1",
      "job-1",
      "payment-1",
      "audit-1",
    ]);
  });

  it("raises the expected operational alerts for degraded runtime conditions", () => {
    const alerts = buildOperationalAlerts({
      apiLatencyP95Ms: 3_200,
      authFailureCount: 19,
      criticalIncidents: 2,
      deadLetterJobs: 4,
      emailSuccessRate: 62,
      otpFailureCount: 7,
      paymentRetryRate: 42,
      queuedJobs: 61,
      queueLagMs: 17 * 60_000,
      redisDegraded: true,
      slowRequests: 5,
    });

    expect(alerts.map((alert) => alert.type)).toEqual(
      expect.arrayContaining([
        "QUEUE_BACKLOG_ALERT",
        "QUEUE_DEAD_LETTER_ALERT",
        "REDIS_DEGRADATION_ALERT",
        "API_LATENCY_ALERT",
        "PAYMENT_ANOMALY_ALERT",
        "EMAIL_PROVIDER_DEGRADATION_ALERT",
        "AUTH_FAILURE_SPIKE_ALERT",
        "OTP_FAILURE_SPIKE_ALERT",
        "INCIDENT_CRITICAL_ALERT",
      ]),
    );
  });

  it("builds replay payloads that clear stale lease state and append replay history", () => {
    const replayedAt = "2026-05-07T10:15:00.000Z";
    const payload = buildReplayedJobPayload(
      {
        operation: "renewal_retry",
        _queue: {
          cancellationReason: "deploy_interrupted",
          cancelledAt: "2026-05-07T10:00:00.000Z",
          claimToken: "claim-1",
          claimedBy: "worker-1",
          deadLetterReason: "retry_exhausted",
          deadLetteredAt: "2026-05-07T10:05:00.000Z",
          retryHistory: [{ at: "2026-05-07T10:05:00.000Z", error: "timeout", state: "dead_lettered" }],
          trace: {
            correlationId: "corr-1",
            originRequestId: "req-old",
            traceId: "trace-old",
          },
        },
      },
      {
        actorUserId: "super-admin-1",
        correlationId: "corr-2",
        replayReason: "Operator replay after webhook recovery.",
        replayedAt,
        replayedFromJobId: "job-dead-lettered",
        requestId: "req-new",
        requestSource: "super_admin_console",
        route: "/admin/automation",
        traceId: "trace-new",
      },
    );

    expect(readJobQueueMetadata(replayedAt ? payload : {})).toMatchObject({
      cancellationReason: null,
      cancelledAt: null,
      claimToken: null,
      claimedBy: null,
      deadLetterReason: null,
      deadLetteredAt: null,
      replayReason: "Operator replay after webhook recovery.",
      replayedAt,
      replayedBy: "super-admin-1",
      replayedFromJobId: "job-dead-lettered",
      visibilityTimeoutAt: null,
    });
    expect(readJobQueueMetadata(payload).retryHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          replayed_from_job_id: "job-dead-lettered",
          state: "replayed",
        }),
      ]),
    );
    expect(readJobTraceMetadata(payload)).toMatchObject({
      correlationId: "corr-2",
      originRequestId: "req-new",
      requestSource: "super_admin_console",
      route: "/admin/automation",
      traceId: "trace-new",
    });
  });
});
