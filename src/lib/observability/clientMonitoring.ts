import * as Sentry from "@sentry/react";

const sentryDsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() || "";
const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0");

let initialized = false;

export const isClientMonitoringEnabled = () => Boolean(sentryDsn);

export const initializeClientMonitoring = () => {
  if (initialized || !sentryDsn || typeof window === "undefined") {
    return;
  }

  Sentry.init({
    dsn: sentryDsn,
    environment: (import.meta.env.VITE_APP_ENV as string | undefined) || import.meta.env.MODE,
    release: (import.meta.env.VITE_RELEASE_SHA as string | undefined) || undefined,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
  });

  initialized = true;
};

export const captureClientError = (error: unknown, context?: Record<string, unknown>) => {
  if (!initialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("app", context);
    }

    Sentry.captureException(error);
  });
};
