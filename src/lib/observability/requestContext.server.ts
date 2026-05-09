import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { validateSystemHeaderValue } from "../httpHeaders.js";

export type RequestTraceContext = {
  correlationId: string;
  ipAddress: string | null;
  method: string;
  requestId: string;
  route: string;
  source: string;
  startedAt: string;
  startedAtMs: number;
  traceId: string;
  userAgent: string | null;
};

type MutableRequestTraceContext = RequestTraceContext;

type TraceContextInput = {
  correlationId?: string | null;
  ipAddress?: string | null;
  method?: string | null;
  requestId?: string | null;
  route?: string | null;
  source?: string | null;
  traceId?: string | null;
  userAgent?: string | null;
};

type TraceResponseLike = {
  setHeader: (name: string, value: string | string[]) => void;
};

const requestTraceStorage = new AsyncLocalStorage<MutableRequestTraceContext>();

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeTraceId = (value: unknown) => {
  const normalized = validateSystemHeaderValue(typeof value === "string" ? value : "");
  return normalized.slice(0, 128);
};

const resolveTraceValue = (value: unknown, fallbackFactory: () => string) => {
  const normalized = normalizeTraceId(value);
  return normalized || fallbackFactory();
};

export const createRequestTraceContext = (input: TraceContextInput): RequestTraceContext => {
  const startedAtMs = Date.now();

  return {
    correlationId: resolveTraceValue(input.correlationId, randomUUID),
    ipAddress: normalizeText(input.ipAddress) || null,
    method: normalizeText(input.method).toUpperCase() || "GET",
    requestId: resolveTraceValue(input.requestId, randomUUID),
    route: normalizeText(input.route) || "/",
    source: normalizeText(input.source) || "server_runtime",
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    traceId: resolveTraceValue(input.traceId, randomUUID),
    userAgent: normalizeText(input.userAgent) || null,
  };
};

export const runWithRequestTraceContext = async <T>(
  context: RequestTraceContext,
  operation: () => Promise<T> | T,
): Promise<T> =>
  await new Promise<T>((resolve, reject) => {
    requestTraceStorage.run({ ...context }, () => {
      Promise.resolve(operation()).then(resolve).catch(reject);
    });
  });

export const getRequestTraceContext = () => requestTraceStorage.getStore() ?? null;

export const updateRequestTraceContext = (input: Partial<TraceContextInput>) => {
  const current = requestTraceStorage.getStore();
  if (!current) {
    return null;
  }

  if (input.correlationId != null) {
    current.correlationId = resolveTraceValue(input.correlationId, () => current.correlationId);
  }

  if (input.ipAddress !== undefined) {
    current.ipAddress = normalizeText(input.ipAddress) || null;
  }

  if (input.method !== undefined) {
    current.method = normalizeText(input.method).toUpperCase() || current.method;
  }

  if (input.requestId != null) {
    current.requestId = resolveTraceValue(input.requestId, () => current.requestId);
  }

  if (input.route !== undefined) {
    current.route = normalizeText(input.route) || current.route;
  }

  if (input.source !== undefined) {
    current.source = normalizeText(input.source) || current.source;
  }

  if (input.traceId != null) {
    current.traceId = resolveTraceValue(input.traceId, () => current.traceId);
  }

  if (input.userAgent !== undefined) {
    current.userAgent = normalizeText(input.userAgent) || null;
  }

  return current;
};

export const applyTraceResponseHeaders = (response: TraceResponseLike, context: RequestTraceContext) => {
  response.setHeader("x-request-id", context.requestId);
  response.setHeader("x-correlation-id", context.correlationId);
  response.setHeader("x-trace-id", context.traceId);
};

export const withRequestTraceMetadata = <TMetadata extends Record<string, unknown> | undefined>(
  metadata: TMetadata,
) => {
  const context = getRequestTraceContext();
  if (!context) {
    return (metadata ?? {}) as Record<string, unknown>;
  }

  return {
    ...(metadata ?? {}),
    correlation_id: context.correlationId,
    request_id: context.requestId,
    request_ip: context.ipAddress,
    request_method: context.method,
    request_source: context.source,
    route: (metadata as Record<string, unknown> | undefined)?.route ?? context.route,
    trace_id: context.traceId,
  };
};
