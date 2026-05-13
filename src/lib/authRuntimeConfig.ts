import { resolveLibriofyEmailFrom } from "./libriofyConfig.js";

type EnvLike = Record<string, string | undefined>;

export const SUPER_ADMIN_EMAIL_OTP_REQUIREMENT =
  "RESEND_API_KEY+AUTH_EMAIL_FROM|RESEND_FROM_EMAIL=hello@libriofy.com";

export type AuthConfigIssue = {
  code: "AUTH_INFRA_UNAVAILABLE" | "OTP_DELIVERY_UNAVAILABLE";
  message: string;
  missing: string[];
};

const hasValue = (value: string | undefined) => Boolean(value && value.trim());
const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (hasValue(value)) {
      return value;
    }
  }

  return undefined;
};

const hasAny = (env: EnvLike, ...names: string[]) => names.some((name) => hasValue(env[name]));

export const hasCustomJwtSigningConfig = (env: EnvLike) =>
  hasAny(env, "SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET");

export const hasSuperAdminEmailOtpConfig = (env: EnvLike) =>
  hasValue(env.RESEND_API_KEY) &&
  Boolean(resolveLibriofyEmailFrom(readEnv(env, "AUTH_EMAIL_FROM", "RESEND_FROM_EMAIL")));

export const getCustomAuthRuntimeIssues = (env: EnvLike): AuthConfigIssue[] => {
  const issues: AuthConfigIssue[] = [];

  if (!hasCustomJwtSigningConfig(env)) {
    issues.push({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Custom auth token signing is not configured.",
      missing: ["SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET"],
    });
  }

  return issues;
};

export const getSuperAdminLoginRuntimeIssues = (env: EnvLike): AuthConfigIssue[] => {
  const issues = [...getCustomAuthRuntimeIssues(env)];

  // In non-production environments, Redis and email delivery are optional
  // (in-memory fallback and console OTP logging are used instead)
  const isNonProd = !hasValue(env.APP_ENV) || env.APP_ENV !== "production";

  if (!hasValue(env.REDIS_URL) && !isNonProd) {
    issues.push({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Session and OTP challenge storage is not configured.",
      missing: ["REDIS_URL"],
    });
  }

  if (!hasSuperAdminEmailOtpConfig(env) && !isNonProd) {
    issues.push({
      code: "OTP_DELIVERY_UNAVAILABLE",
      message: "Super admin email OTP delivery must use hello@libriofy.com via Resend.",
      missing: [SUPER_ADMIN_EMAIL_OTP_REQUIREMENT],
    });
  }

  return issues;
};

export const getSuperAdminVerifyRuntimeIssues = (env: EnvLike): AuthConfigIssue[] => {
  const issues = [...getCustomAuthRuntimeIssues(env)];

  const isNonProd = !hasValue(env.APP_ENV) || env.APP_ENV !== "production";

  if (!hasValue(env.REDIS_URL) && !isNonProd) {
    issues.push({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Session and OTP challenge storage is not configured.",
      missing: ["REDIS_URL"],
    });
  }

  return issues;
};

export const getServerAuthConfigRequirements = (env: EnvLike) => {
  const missing = new Set<string>();

  for (const issue of getSuperAdminLoginRuntimeIssues(env)) {
    for (const requirement of issue.missing) {
      missing.add(requirement);
    }
  }

  return [...missing];
};
