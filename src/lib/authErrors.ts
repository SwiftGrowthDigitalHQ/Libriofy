const NETWORK_ERROR_CODES = new Set(["fetch_error", "network_error", "request_timeout"]);

export const getAuthErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "Something went wrong. Please try again.";
  }

  const err = error as { message?: string; code?: string; status?: number };
  const message = (err.message ?? "").toLowerCase();

  if (err.code && NETWORK_ERROR_CODES.has(err.code.toLowerCase())) {
    return "Network error. Check your connection and try again.";
  }

  if (message.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }

  if (message.includes("email not confirmed")) {
    return "Please verify your email before signing in.";
  }

  if (message.includes("user already registered")) {
    return "An account already exists with this email.";
  }

  if (message.includes("jwt expired") || message.includes("refresh token")) {
    return "Your session expired. Please sign in again.";
  }

  if (message.includes("failed to fetch")) {
    return "Network error. Check your connection and try again.";
  }

  return err.message || "Authentication failed. Please try again.";
};
