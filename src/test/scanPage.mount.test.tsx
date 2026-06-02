import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    getCurrentSession: vi.fn().mockResolvedValue(null),
    loading: false,
    logoutAllDevices: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    sendOtp: vi.fn().mockResolvedValue({}),
    session: null,
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(undefined),
    startImpersonation: vi.fn().mockResolvedValue(null),
    startSuperAdminLogin: vi.fn().mockResolvedValue({}),
    stopImpersonation: vi.fn().mockResolvedValue(null),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    user: null,
    verifyOtp: vi.fn().mockResolvedValue({}),
    verifySuperAdminOtp: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    functions: {
      invoke: vi.fn(),
    },
    realtime: {
      setAuth: vi.fn(),
    },
  },
  supabaseAuth: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      signUp: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

import App from "@/App";
import ScanKioskPageV2 from "@/pages/ScanKioskPageV2";

const installBrowserMocks = () => {
  vi.stubEnv("VITE_SCAN_DEVICE_ID", "LIB_GATE_01");
  vi.stubEnv("VITE_SCAN_DEVICE_NAME", "Library ID Scanner");
  vi.stubEnv("VITE_APP_VERSION", "test-suite");
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("VITE_PUBLIC_APP_URL", "http://localhost");
  vi.stubEnv("VITE_QR_PUBLIC_KEY", "");
  vi.stubEnv("VITE_STUDENT_QR_PUBLIC_KEY", "");

  window.history.pushState({}, "", "/scan");
  window.localStorage.setItem("library_id", "library-1");
  window.localStorage.setItem("library_access_key", "access-key-1");

  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });

  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });

  Object.defineProperty(window.HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() {
      return (this as unknown as { _srcObject?: unknown })._srcObject ?? null;
    },
    set(value) {
      (this as unknown as { _srcObject?: unknown })._srcObject = value;
    },
  });

  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => undefined;
  window.HTMLMediaElement.prototype.load = () => undefined;

  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      canvas: this,
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      imageSmoothingEnabled: false,
    } as CanvasRenderingContext2D;
  };

  Object.assign(window.navigator as Navigator & {
    clipboard?: { writeText: (text: string) => Promise<void> };
    mediaDevices?: MediaDevices;
    permissions?: { query: (descriptor: PermissionDescriptor) => Promise<{ state: PermissionState }> };
    vibrate?: (pattern: number | number[]) => boolean;
  }, {
    clipboard: {
      writeText: async () => undefined,
    },
    mediaDevices: {
      enumerateDevices: async () => [
        { deviceId: "camera-1", kind: "videoinput", label: "Rear Camera", groupId: "" },
      ] as MediaDeviceInfo[],
      getUserMedia: async () => ({
        getTracks: () => [
          {
            applyConstraints: async () => undefined,
            kind: "video",
            readyState: "live",
            stop() {},
          },
        ],
        getVideoTracks: () => [
          {
            applyConstraints: async () => undefined,
            getCapabilities: () => ({
              exposureMode: ["continuous"],
              focusMode: ["continuous"],
              torch: false,
              whiteBalanceMode: ["continuous"],
              zoom: { max: 1, min: 1, step: 1 },
            }),
            getSettings: () => ({
              deviceId: "camera-1",
              facingMode: "environment",
              frameRate: 30,
              height: 720,
              width: 1280,
            }),
            kind: "video",
            readyState: "live",
            stop() {},
          },
        ],
      }) as MediaStream,
    },
    permissions: {
      query: async () => ({ state: "granted" as PermissionState }),
    },
    vibrate: () => true,
  });

  vi.stubGlobal(
    "Worker",
    class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      private terminated = false;

      constructor() {
        queueMicrotask(() => {
          if (!this.terminated && this.onmessage) {
            this.onmessage({
              data: {
                type: "ready",
                support: {
                  barcodeDetector: false,
                  offscreenCanvas: false,
                },
              },
            } as MessageEvent);
          }
        });
      }

      postMessage(message: { requestId?: number; type?: string }) {
        if (this.terminated) {
          return;
        }

        if (message.type === "decode-image-data" || message.type === "decode-bitmap") {
          queueMicrotask(() => {
            if (!this.terminated && this.onmessage) {
              this.onmessage({
                data: {
                  type: "result",
                  requestId: message.requestId ?? 0,
                  rawValue: null,
                  detector: null,
                  decodePass: null,
                  confidence: null,
                  failureReason: "not_found",
                  bounds: null,
                  timingMs: 4,
                  brightness: 120,
                  blurry: false,
                  edgeScore: 0,
                  glare: false,
                  lowLight: false,
                },
              } as MessageEvent);
            }
          });
        }
      }

      terminate() {
        this.terminated = true;
      }

      addEventListener() {}

      removeEventListener() {}
    },
  );

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/api/device-heartbeat")) {
      return new Response(
        JSON.stringify({
          deviceId: "LIB_GATE_01",
          heartbeatAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          libraryId: "library-1",
          valid: true,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  });
};

describe("ScanKioskPageV2 mount", () => {
  beforeEach(() => {
    installBrowserMocks();
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("renders without throwing and keeps the scanner shell alive", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <MemoryRouter initialEntries={["/scan"]}>
        <ScanKioskPageV2 />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Access Gate/i)).toBeTruthy();
    });

    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.queryByText(/recovery status/i)).toBeNull();
    expect(errorSpy.mock.calls.some((call) => call.join(" ").includes("window error"))).toBe(false);
    expect(errorSpy.mock.calls.some((call) => call.join(" ").includes("unhandled rejection"))).toBe(false);
  });

  it("renders the full /scan app route without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Access Gate/i)).toBeTruthy();
    });

    expect(screen.queryByText(/Something broke/i)).toBeNull();
    expect(screen.queryByText(/recovery status/i)).toBeNull();
    expect(errorSpy.mock.calls.some((call) => call.join(" ").includes("window error"))).toBe(false);
    expect(errorSpy.mock.calls.some((call) => call.join(" ").includes("unhandled rejection"))).toBe(false);
  });
});
