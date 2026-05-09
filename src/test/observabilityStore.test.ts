import { describe, expect, it } from "vitest";

import { buildAppEventLogInsert } from "@/lib/observability/store.server";
import { createRequestTraceContext, runWithRequestTraceContext } from "@/lib/observability/requestContext.server";

describe("observability event storage", () => {
  it("enriches events with request trace metadata and derived incident fields", async () => {
    const row = await runWithRequestTraceContext(
      createRequestTraceContext({
        correlationId: "corr-123",
        method: "POST",
        requestId: "req-123",
        route: "/api/admin/jobs",
        source: "admin_api",
        traceId: "trace-123",
      }),
      async () =>
        buildAppEventLogInsert({
          metadata: {
            latency_ms: 1200,
            queryName: "platform_job_queue",
            source: "super_admin_service",
          },
          status: "FAILED",
          type: "SUPABASE_SLOW_QUERY",
        }),
    );

    expect(row.classification).toBe("PERFORMANCE_EVENT");
    expect(row.metric_key).toBe("performance_event:supabase_slow_query");
    expect(row.group_key).toContain("performance_event");
    expect(row.fingerprint).toContain("platform_job_queue");
    expect((row.metadata as Record<string, unknown>).request_id).toBe("req-123");
    expect((row.metadata as Record<string, unknown>).correlation_id).toBe("corr-123");
    expect((row.metadata as Record<string, unknown>).trace_id).toBe("trace-123");
    expect((row.metadata as Record<string, unknown>).route).toBe("/api/admin/jobs");
  });
});
