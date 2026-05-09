import { describe, expect, it } from "vitest";

import {
  buildJobBackoffMs,
  buildJobIdempotencyKey,
  isDeadLetteredJob,
  readJobQueueMetadata,
} from "@/lib/superAdmin/service.server";
import {
  buildQueueConcurrencyKey,
  buildQueueDeduplicationKey,
  buildStableJson,
  writeJobQueuePayload,
  isCancellationRequestedJob,
  resolveJobVisibilityTimeoutMs,
  shouldRecoverRunningJob,
} from "@/lib/superAdmin/queueRuntime";

describe("super admin queue helpers", () => {
  it("builds stable idempotency keys regardless of object key order", () => {
    const first = buildJobIdempotencyKey("payment_reminder", {
      libraryId: "lib-1",
      reminderType: "renewal",
    });
    const second = buildJobIdempotencyKey("payment_reminder", {
      reminderType: "renewal",
      libraryId: "lib-1",
    });

    expect(first).toBe(second);
  });

  it("uses exponential backoff with an upper bound", () => {
    expect(buildJobBackoffMs(1)).toBe(60_000);
    expect(buildJobBackoffMs(2)).toBe(120_000);
    expect(buildJobBackoffMs(3)).toBe(240_000);
    expect(buildJobBackoffMs(10)).toBe(30 * 60_000);
  });

  it("detects dead-lettered jobs from queue metadata", () => {
    const payload = {
      _queue: {
        deadLetterReason: "retry_exhausted",
        deadLetteredAt: "2026-05-06T12:00:00.000Z",
      },
    };

    expect(readJobQueueMetadata(payload)).toMatchObject({
      deadLetterReason: "retry_exhausted",
    });
    expect(isDeadLetteredJob(payload)).toBe(true);
    expect(isDeadLetteredJob({})).toBe(false);
  });

  it("recovers running jobs when the visibility timeout expires", () => {
    expect(
      shouldRecoverRunningJob({
        payload: {},
        startedAt: "2026-05-07T09:00:00.000Z",
        visibilityTimeoutAt: "2026-05-07T09:05:00.000Z",
        nowMs: Date.parse("2026-05-07T09:05:01.000Z"),
      }),
    ).toBe(true);
  });

  it("falls back to age-based recovery for legacy running jobs", () => {
    expect(
      shouldRecoverRunningJob({
        payload: {},
        startedAt: "2026-05-07T09:00:00.000Z",
        visibilityTimeoutAt: null,
        nowMs: Date.parse("2026-05-07T09:16:00.000Z"),
      }),
    ).toBe(true);
  });

  it("treats short visibility timeout inputs as seconds", () => {
    expect(resolveJobVisibilityTimeoutMs({ visibilityTimeoutMs: 90 })).toBe(90_000);
    expect(resolveJobVisibilityTimeoutMs({ visibility_timeout_ms: 120_000 })).toBe(120_000);
  });

  it("keeps renewal-spike jobs grouped under the same library concurrency key", () => {
    const keys = Array.from({ length: 250 }, (_, index) =>
      buildQueueConcurrencyKey("auto_subscription_renewal", {
        libraryId: `lib-${index % 5}`,
        reminderType: "renewal_due_today",
      }),
    );

    expect(new Set(keys)).toEqual(new Set(["lib-0", "lib-1", "lib-2", "lib-3", "lib-4"]));
    expect(keys.filter((key) => key === "lib-3")).toHaveLength(50);
  });

  it("keeps broadcast-burst style queue work partitioned per library", () => {
    const deduplicationKeys = Array.from({ length: 75 }, (_, index) =>
      buildQueueDeduplicationKey(
        "payment_reminder",
        {
          audience: "all_active_libraries",
          libraryId: `lib-${index}`,
          sequence: index,
        },
        null,
      ),
    );

    expect(new Set(deduplicationKeys)).toHaveLength(75);
  });

  it("does not recover a running job before its lease or stale grace window expires", () => {
    expect(
      shouldRecoverRunningJob({
        payload: {},
        startedAt: "2026-05-07T09:00:00.000Z",
        visibilityTimeoutAt: "2026-05-07T09:05:00.000Z",
        nowMs: Date.parse("2026-05-07T09:04:59.000Z"),
      }),
    ).toBe(false);
  });

  it("detects queued cancellation requests", () => {
    expect(
      isCancellationRequestedJob({
        _queue: {
          cancelRequestedAt: "2026-05-07T10:00:00.000Z",
        },
      }),
    ).toBe(true);
    expect(isCancellationRequestedJob({})).toBe(false);
  });

  it("preserves queue metadata when cancellation markers are merged after partial failures", () => {
    const payload = writeJobQueuePayload(
      {
        libraryId: "lib-1",
        operation: "renewal_scan",
      },
      {
        retryHistory: [{ attempt: 1, error: "timeout" }],
        trace: {
          correlationId: "corr-1",
        },
      },
    );

    const patched = writeJobQueuePayload(payload, {
      cancelRequestedAt: "2026-05-07T10:00:00.000Z",
      cancellationReason: "deploy_interrupted",
    });

    expect(buildStableJson(patched)).toContain("\"libraryId\":\"lib-1\"");
    expect(readJobQueueMetadata(patched)).toMatchObject({
      cancellationReason: "deploy_interrupted",
      cancelRequestedAt: "2026-05-07T10:00:00.000Z",
      retryHistory: [{ attempt: 1, error: "timeout" }],
      trace: {
        correlationId: "corr-1",
      },
    });
  });
});
