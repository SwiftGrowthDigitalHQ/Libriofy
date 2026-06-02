import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const authMock = {
  getCurrentSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  sendOtp: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  updatePassword: vi.fn(),
  verifyOtp: vi.fn(),
};

const toastMock = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authMock,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/pwa/InstallAppButton", () => ({
  default: ({ children }: { children?: ReactNode }) => <button type="button">{children ?? "Install App"}</button>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
  supabaseAuth: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

import AuthPage from "@/pages/AuthPage";

describe("AuthPage mobile OTP gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getCurrentSession.mockResolvedValue(null);
  });

  it("shows email login by default without mobile OTP controls", () => {
    render(
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("Mobile OTP")).not.toBeInTheDocument();
    expect(screen.queryByText("Mobile number")).not.toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp\/SMS/i)).not.toBeInTheDocument();
  });

  it("keeps the signup screen free of the mobile field while the flag is off", () => {
    render(
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^Create account$/ })[0]);

    expect(screen.getByText("Set up your account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Varun Singh")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Minimum 6 characters")).toBeInTheDocument();
    expect(screen.queryByText("Mobile number")).not.toBeInTheDocument();
  });
});
