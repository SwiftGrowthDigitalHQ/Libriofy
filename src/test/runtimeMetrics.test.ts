import { afterEach, describe, expect, it } from "vitest";

import {
  getRuntimeCounterTotal,
  getRuntimeLatencySummary,
  incrementRuntimeMetric,
  recordRuntimeLatency,
  resetRuntimeMetrics,
} from "@/lib/observability/runtimeMetrics.server";

afterEach(() => {
  resetRuntimeMetrics();
});

describe("runtime metrics", () => {
  it("aggregates counters by tag filters", () => {
    incrementRuntimeMetric("http_requests_total", 1, { area: "auth", outcome: "success" });
    incrementRuntimeMetric("http_requests_total", 2, { area: "auth", outcome: "error" });
    incrementRuntimeMetric("http_requests_total", 4, { area: "admin", outcome: "success" });

    expect(getRuntimeCounterTotal("http_requests_total", { area: "auth" })).toBe(3);
    expect(getRuntimeCounterTotal("http_requests_total", { area: "auth", outcome: "success" })).toBe(1);
    expect(getRuntimeCounterTotal("http_requests_total", { area: "admin" })).toBe(4);
  });

  it("computes latency summaries across matching metrics", () => {
    recordRuntimeLatency("http_request_latency_ms", 100, { area: "admin" });
    recordRuntimeLatency("http_request_latency_ms", 250, { area: "admin" });
    recordRuntimeLatency("http_request_latency_ms", 900, { area: "admin" });
    recordRuntimeLatency("http_request_latency_ms", 50, { area: "auth" });

    const summary = getRuntimeLatencySummary("http_request_latency_ms", { area: "admin" });

    expect(summary.count).toBe(3);
    expect(summary.min).toBe(100);
    expect(summary.max).toBe(900);
    expect(summary.p50).toBe(250);
    expect(summary.p95).toBe(900);
    expect(summary.average).toBeCloseTo(416.67, 2);
  });
});
