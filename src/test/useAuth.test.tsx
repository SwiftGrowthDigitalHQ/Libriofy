import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshAuthSessionMock = vi.fn();
const getStoredAuthSessionMock = vi.fn();
const setStoredAuthSessionMock = vi.fn();
const signOutMock = vi.fn();
const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const realtimeSetAuthMock = vi.fn();
const readBrowserStorageItemMock = vi.fn();
const writeBrowserStorageItemMock = vi.fn();

vi.mock("@/lib/authApi", () => ({
  extractSessionFromResponse: vi.fn((response: { session: unknown }) => response.session),
  logoutAllSessions: vi.fn(),
  logoutCurrentSession: vi.fn(),
  refreshAuthSession: (...args: unknown[]) => refreshAuthSessionMock(...args),
  sendOtp: vi.fn(),
  startImpersonation: vi.fn(),
  startSuperAdminLogin: vi.fn(),
  stopImpersonation: vi.fn(),
  verifyOtp: vi.fn(),
  verifySuperAdminOtp: vi.fn(),
}));

vi.mock("@/lib/authSession", () => ({
  clearStoredAuthSession: vi.fn(),
  getStoredAuthSession: (...args: unknown[]) => getStoredAuthSessionMock(...args),
  setStoredAuthSession: (...args: unknown[]) => setStoredAuthSessionMock(...args),
}));

vi.mock("@/lib/browserStorage", () => ({
  readBrowserStorageItem: (...args: unknown[]) => readBrowserStorageItemMock(...args),
  writeBrowserStorageItem: (...args: unknown[]) => writeBrowserStorageItemMock(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    realtime: {
      setAuth: (...args: unknown[]) => realtimeSetAuthMock(...args),
    },
  },
  supabaseAuth: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

const Probe = () => {
  const { loading } = useAuth();
  return <div>{loading ? "loading" : "ready"}</div>;
};

describe("AuthProvider restore flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStoredAuthSessionMock.mockReturnValue(null);
    readBrowserStorageItemMock.mockReturnValue(null);
    writeBrowserStorageItemMock.mockReturnValue(undefined);
    refreshAuthSessionMock.mockRejectedValue(new Error("SESSION_MISSING"));
    signOutMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    onAuthStateChangeMock.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    });
    realtimeSetAuthMock.mockReturnValue(undefined);
  });

  it("skips the initial custom-session refresh probe on the super admin login route when no cached session exists", async () => {
    window.history.replaceState({}, "", "/super-admin-login");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());

    expect(refreshAuthSessionMock).not.toHaveBeenCalled();
  });

  it("still probes custom session refresh on protected routes when no cached session exists", async () => {
    window.history.replaceState({}, "", "/dashboard");

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());

    expect(refreshAuthSessionMock).toHaveBeenCalledTimes(1);
  });
});
