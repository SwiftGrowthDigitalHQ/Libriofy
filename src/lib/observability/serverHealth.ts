export type ServerHealthCheck = {
  detail?: string;
  name: string;
  status: "pass" | "fail";
};

const buildSupabaseConnectivityCheck = async (env: NodeJS.ProcessEnv): Promise<ServerHealthCheck> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      name: "supabase_connectivity",
      status: "fail",
      detail: "Supabase URL or service role key is missing",
    };
  }

  try {
    const endpoint = new URL("/rest/v1/libraries", env.SUPABASE_URL);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint.toString(), {
      headers: {
        Accept: "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      method: "GET",
    });

    return {
      name: "supabase_connectivity",
      status: response.ok ? "pass" : "fail",
      detail: response.ok
        ? "Supabase REST connectivity verified"
        : `Supabase REST connectivity failed with status ${response.status}`,
    };
  } catch (error) {
    return {
      name: "supabase_connectivity",
      status: "fail",
      detail: error instanceof Error ? error.message : "Unknown Supabase connectivity failure",
    };
  }
};

export const buildServerReadiness = async (env: NodeJS.ProcessEnv, options: { hasDist: boolean }) => {
  const checks: ServerHealthCheck[] = [];

  checks.push({
    name: "supabase_url",
    status: env.SUPABASE_URL ? "pass" : "fail",
    detail: env.SUPABASE_URL ? "configured" : "SUPABASE_URL is missing",
  });

  checks.push({
    name: "supabase_service_role",
    status: env.SUPABASE_SERVICE_ROLE_KEY ? "pass" : "fail",
    detail: env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "SUPABASE_SERVICE_ROLE_KEY is missing",
  });

  checks.push({
    name: "frontend_bundle",
    status: options.hasDist ? "pass" : "fail",
    detail: options.hasDist ? "dist/ is present" : "dist/ was not found on the server",
  });

  checks.push({
    name: "student_qr_signing",
    status: env.STUDENT_QR_PRIVATE_KEY ? "pass" : "fail",
    detail: env.STUDENT_QR_PRIVATE_KEY ? "configured" : "STUDENT_QR_PRIVATE_KEY is missing",
  });

  checks.push(await buildSupabaseConnectivityCheck(env));

  const failingChecks = checks.filter((check) => check.status === "fail");

  return {
    checks,
    ok: failingChecks.length === 0,
    status: failingChecks.length === 0 ? "ok" : "degraded",
  };
};
