const JOB_BACKOFF_BASE_MS = 60_000;
const JOB_BACKOFF_MAX_MS = 30 * 60_000;
const DEFAULT_JOB_VISIBILITY_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_JOB_RECOVERY_GRACE_MS = 15 * 60_000;

export type QueueTraceMetadata = {
  correlationId?: string | null;
  originRequestId?: string | null;
  parentRequestId?: string | null;
  requestSource?: string | null;
  route?: string | null;
  traceId?: string | null;
};

export type QueueExecutionMetadata = {
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  cancelRequestedAt?: string | null;
  cancelRequestedBy?: string | null;
  claimToken?: string | null;
  claimedBy?: string | null;
  completedAt?: string | null;
  concurrencyKey?: string | null;
  deadLetterReason?: string | null;
  deadLetteredAt?: string | null;
  deduplicationKey?: string | null;
  idempotencyKey?: string | null;
  lastHeartbeatAt?: string | null;
  lastResult?: Record<string, unknown> | null;
  maxConcurrency?: number | null;
  recoveryAttempts?: number | null;
  recoveredAt?: string | null;
  retryHistory?: unknown[];
  replayReason?: string | null;
  replayedAt?: string | null;
  replayedBy?: string | null;
  replayedFromJobId?: string | null;
  trace?: QueueTraceMetadata | null;
  visibilityTimeoutAt?: string | null;
};

type QueueMetadataPatch = Record<string, unknown>;

export const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const toPositiveInteger = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(parsed));
};

export const buildStableJson = (value: unknown): string => {
  if (value == null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => buildStableJson(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${buildStableJson(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const buildJobIdempotencyKey = (jobType: string, payload: Record<string, unknown>) =>
  `${normalizeText(jobType).toLowerCase()}:${buildStableJson(payload)}`;

export const readJobQueueMetadata = (payload: unknown): QueueExecutionMetadata => {
  const record = toRecord(payload);
  return toRecord(record._queue) as QueueExecutionMetadata;
};

export const writeJobQueuePayload = (payload: unknown, patch: QueueMetadataPatch) => {
  const record = toRecord(payload);
  return {
    ...record,
    _queue: {
      ...readJobQueueMetadata(payload),
      ...patch,
    },
  };
};

export const readJobTraceMetadata = (payload: unknown): QueueTraceMetadata => {
  const metadata = readJobQueueMetadata(payload);
  return toRecord(metadata.trace) as QueueTraceMetadata;
};

export const buildQueueDeduplicationKey = (
  jobType: string,
  payload: Record<string, unknown>,
  explicitKey?: string | null,
) => normalizeText(explicitKey) || buildJobIdempotencyKey(jobType, payload);

export const buildQueueConcurrencyKey = (
  jobType: string,
  payload: Record<string, unknown>,
  explicitKey?: string | null,
) => normalizeText(explicitKey) || normalizeText(payload.libraryId) || normalizeText(payload.library_id) || normalizeText(jobType);

export const buildJobBackoffMs = (attemptNumber: number) =>
  Math.min(JOB_BACKOFF_MAX_MS, JOB_BACKOFF_BASE_MS * Math.max(1, 2 ** Math.max(0, attemptNumber - 1)));

export const resolveJobVisibilityTimeoutMs = (payload: unknown, fallbackMs = DEFAULT_JOB_VISIBILITY_TIMEOUT_MS) => {
  const metadata = readJobQueueMetadata(payload);
  const payloadRecord = toRecord(payload);
  const rawTimeout =
    (metadata as Record<string, unknown>).visibilityTimeoutMs ??
    payloadRecord.visibilityTimeoutMs ??
    payloadRecord.visibility_timeout_ms ??
    fallbackMs;
  const resolvedInteger = toPositiveInteger(rawTimeout, fallbackMs);
  const resolved = resolvedInteger >= 10_000 ? resolvedInteger : resolvedInteger * 1000;
  return Math.max(30_000, resolved);
};

export const resolveJobMaxConcurrency = (payload: unknown, fallback = 1) => {
  const metadata = readJobQueueMetadata(payload);
  return Math.max(
    1,
    toPositiveInteger(
      metadata.maxConcurrency ?? toRecord(payload).maxConcurrency ?? toRecord(payload).max_concurrency ?? fallback,
      fallback,
    ),
  );
};

export const isDeadLetteredJob = (payload: unknown) => Boolean(readJobQueueMetadata(payload).deadLetteredAt);

export const isCancellationRequestedJob = (payload: unknown) => Boolean(readJobQueueMetadata(payload).cancelRequestedAt);

export const isCancelledJob = (payload: unknown) => Boolean(readJobQueueMetadata(payload).cancelledAt);

export const buildReplayedJobPayload = (
  payload: unknown,
  {
    actorUserId,
    correlationId,
    replayReason,
    replayedAt,
    replayedFromJobId,
    requestId,
    requestSource,
    route,
    traceId,
  }: {
    actorUserId?: string | null;
    correlationId?: string | null;
    replayReason?: string | null;
    replayedAt: string;
    replayedFromJobId: string;
    requestId?: string | null;
    requestSource?: string | null;
    route?: string | null;
    traceId?: string | null;
  },
) => {
  const metadata = readJobQueueMetadata(payload);
  const trace = readJobTraceMetadata(payload);
  const retryHistory = [
    ...(Array.isArray(metadata.retryHistory) ? metadata.retryHistory : []),
    {
      at: replayedAt,
      by: actorUserId ?? null,
      error: null,
      replayed_from_job_id: replayedFromJobId,
      reason: replayReason ?? null,
      state: "replayed",
    },
  ].slice(-10);

  return writeJobQueuePayload(payload, {
    cancellationReason: null,
    cancelledAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    claimToken: null,
    claimedBy: null,
    deadLetterReason: null,
    deadLetteredAt: null,
    lastHeartbeatAt: null,
    recoveredAt: null,
    replayReason: replayReason ?? null,
    replayedAt,
    replayedBy: actorUserId ?? null,
    replayedFromJobId,
    retryHistory,
    trace: {
      correlationId: correlationId ?? trace.correlationId ?? null,
      originRequestId: requestId ?? trace.originRequestId ?? null,
      parentRequestId: trace.originRequestId ?? trace.parentRequestId ?? null,
      requestSource: requestSource ?? trace.requestSource ?? null,
      route: route ?? trace.route ?? null,
      traceId: traceId ?? trace.traceId ?? null,
    },
    visibilityTimeoutAt: null,
  });
};

export const shouldRecoverRunningJob = ({
  payload,
  startedAt,
  visibilityTimeoutAt,
  nowMs = Date.now(),
}: {
  nowMs?: number;
  payload: unknown;
  startedAt?: string | null;
  visibilityTimeoutAt?: string | null;
}) => {
  const visibilityDeadlineMs = visibilityTimeoutAt ? Date.parse(visibilityTimeoutAt) : Number.NaN;
  if (Number.isFinite(visibilityDeadlineMs) && nowMs >= visibilityDeadlineMs) {
    return true;
  }

  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(startedAtMs) && nowMs - startedAtMs >= DEFAULT_JOB_RECOVERY_GRACE_MS;
};
