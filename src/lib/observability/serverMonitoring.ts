import * as Sentry from "@sentry/node";

let initialized = false;

const resolveSampleRate = (rawValue: string | undefined) => {
  const parsed = Number(rawValue || "0");
  return Number.isFinite(parsed) ? parsed : 0;
};

export const initializeServerMonitoring = (env: NodeJS.ProcessEnv) => {
  const dsn = (env.SENTRY_DSN || "").trim();
  if (initialized || !dsn) {
    return false;
  }

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.APP_ENV || env.NODE_ENV || "production",
    release: env.SENTRY_RELEASE || env.RELEASE_SHA || undefined,
    tracesSampleRate: resolveSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
  });

  process.on("uncaughtExceptionMonitor", (error) => {
    Sentry.captureException(error);
  });

  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason);
  });

  initialized = true;
  return true;
};

export const captureServerError = (error: unknown, context?: Record<string, unknown>) => {
  if (!initialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("server", context);
    }

    Sentry.captureException(error);
  });
};
