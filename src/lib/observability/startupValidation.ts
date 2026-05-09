import { isLibriofyAppUrl } from "../libriofyConfig.js";
import { getServerAuthConfigRequirements } from "../authRuntimeConfig.js";
import { validateRuntimeConfiguration } from "./runtimeGovernance.server.js";

type EnvCheckResult = {
  checks?: ReturnType<typeof validateRuntimeConfiguration>["checks"];
  driftWarnings?: string[];
  missing: string[];
  ok: boolean;
};

const hasValue = (value: string | undefined) => Boolean(value && value.trim());

const requireCanonicalAppUrl = (env: NodeJS.ProcessEnv, ...names: string[]) =>
  names.some((name) => isLibriofyAppUrl(env[name]));

export const validateServerStartupEnv = (env: NodeJS.ProcessEnv): EnvCheckResult => {
  const runtimeConfig = validateRuntimeConfiguration(env, {
    hasDist: true,
    target: "express",
  });
  const missing = [...runtimeConfig.missing];

  for (const requirement of getServerAuthConfigRequirements(env)) {
    if (!missing.includes(requirement)) {
      missing.push(requirement);
    }
  }

  if (!requireCanonicalAppUrl(env, "APP_URL", "PUBLIC_APP_URL", "SITE_URL")) {
    if (!missing.includes("APP_URL|PUBLIC_APP_URL|SITE_URL=https://www.libriofy.com")) {
      missing.push("APP_URL|PUBLIC_APP_URL|SITE_URL=https://www.libriofy.com");
    }
  }

  return {
    checks: runtimeConfig.checks,
    driftWarnings: runtimeConfig.driftWarnings,
    missing,
    ok: runtimeConfig.ok && missing.length === 0,
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
