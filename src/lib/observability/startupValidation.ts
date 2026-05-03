import { isLibriofyAppUrl } from "../libriofyConfig.js";
import { getServerAuthConfigRequirements } from "../authRuntimeConfig.js";

type EnvCheckResult = {
  missing: string[];
  ok: boolean;
};

const hasValue = (value: string | undefined) => Boolean(value && value.trim());

const requireCanonicalAppUrl = (env: NodeJS.ProcessEnv, ...names: string[]) =>
  names.some((name) => isLibriofyAppUrl(env[name]));

export const validateServerStartupEnv = (env: NodeJS.ProcessEnv): EnvCheckResult => {
  const missing: string[] = [];

  for (const variableName of ["APP_ENV", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STUDENT_QR_PRIVATE_KEY"]) {
    if (!hasValue(env[variableName])) {
      missing.push(variableName);
    }
  }

  if (!requireCanonicalAppUrl(env, "APP_URL", "PUBLIC_APP_URL", "SITE_URL")) {
    missing.push("APP_URL|PUBLIC_APP_URL|SITE_URL=https://www.libriofy.com");
  }

  for (const requirement of getServerAuthConfigRequirements(env)) {
    if (!missing.includes(requirement)) {
      missing.push(requirement);
    }
  }

  return {
    missing,
    ok: missing.length === 0,
  };
};

export const assertServerStartupEnv = (env: NodeJS.ProcessEnv) => {
  const result = validateServerStartupEnv(env);
  if (result.ok) {
    return;
  }

  throw new Error(
    `Server startup validation failed. Missing required environment values: ${result.missing.join(", ")}`,
  );
};
