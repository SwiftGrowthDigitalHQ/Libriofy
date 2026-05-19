import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminClient } from "@/lib/superAdmin/client/sdk";
import { adminGet } from "@/lib/superAdmin/client/fetch";
import { AdminApiError } from "@/lib/superAdmin/client/errors";

const createAbortAwareFetch = () =>
  vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const requestSignal = init?.signal;
      if (!requestSignal) {
        return;
      }

      if (requestSignal.aborted) {
        reject(requestSignal.reason ?? new Error("aborted"));
        return;
      }

      requestSignal.addEventListener(
        "abort",
        () => reject(requestSignal.reason ?? new Error("aborted")),
        { once: true },
      );
    }),
  );

describe("super admin client fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("surfaces explicit admin timeout errors instead of opaque abort messages", async () => {
    vi.stubGlobal("fetch", createAbortAwareFetch());

    const requestPromise = adminGet("/api/admin/platform", {
      retryAttempts: 0,
      timeoutMs: 50,
    }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(60);

    await expect(requestPromise).resolves.toMatchObject<Partial<AdminApiError>>({
      errorCode: "ADMIN_REQUEST_TIMEOUT",
      message: "Admin request to /api/admin/platform timed out after 1s.",
      status: 504,
    });
  });

  it("normalizes external aborts without leaking browser abort boilerplate", async () => {
    vi.stubGlobal("fetch", createAbortAwareFetch());

    const controller = new AbortController();
    const requestPromise = adminGet("/api/admin/platform", {
      retryAttempts: 0,
      signal: controller.signal,
      timeoutMs: 1_000,
    }).catch((error) => error);

    controller.abort();
    await Promise.resolve();

    await expect(requestPromise).resolves.toMatchObject<Partial<AdminApiError>>({
      errorCode: "ADMIN_REQUEST_ABORTED",
      message: "Admin request was cancelled before it completed.",
      status: 499,
    });
  });

  it("keeps the platform control-plane request alive beyond the old 8 second client timeout", async () => {
    vi.stubGlobal("fetch", createAbortAwareFetch());

    let settled = false;
    const requestPromise = adminClient.getPlatform().catch((error) => {
      settled = true;
      return error;
    });

    await vi.advanceTimersByTimeAsync(8_100);
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(12_000);

    await expect(requestPromise).resolves.toMatchObject<Partial<AdminApiError>>({
      errorCode: "ADMIN_REQUEST_TIMEOUT",
      status: 504,
    });
  });
});
