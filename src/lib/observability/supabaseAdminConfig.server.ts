type EnvLike = Record<string, string | undefined>;

type SupabaseAdminConfig = {
  serviceRoleKey: string;
  serviceRoleKeyEnvName: KeyCandidate["envName"];
  supabaseUrl: string;
  supabaseUrlEnvName: UrlCandidate["envName"];
};

type SupabaseAdminConfigResult =
  | {
      config: SupabaseAdminConfig;
      ok: true;
    }
  | {
      detail: string;
      ok: false;
    };

type UrlCandidate = {
  envName: "SUPABASE_URL" | "VITE_SUPABASE_URL";
  projectRef: string | null;
  value: string;
};

type KeyCandidate = {
  envName: "SUPABASE_SERVICE_ROLE_KEY" | "VITE_SUPABASE_SERVICE_ROLE_KEY";
  kind: "jwt" | "publishable" | "secret" | "unknown";
  projectRef: string | null;
  role: string | null;
  value: string;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(paddingLength)}`, "base64").toString("utf8");
};

const parseJwtPayload = (token: string) => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    return payload;
  } catch {
    return null;
  }
};

const getProjectRefFromSupabaseUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.trim().toLowerCase();
    const [projectRef] = host.split(".");
    return projectRef || null;
  } catch {
    return null;
  }
};

const parseKeyCandidate = (envName: KeyCandidate["envName"], value: string): KeyCandidate => {
  const normalized = trimText(value);
  if (normalized.startsWith("sb_publishable_")) {
    return {
      envName,
      kind: "publishable",
      projectRef: null,
      role: "anon",
      value: normalized,
    };
  }

  if (normalized.startsWith("sb_secret_")) {
    return {
      envName,
      kind: "secret",
      projectRef: null,
      role: "service_role",
      value: normalized,
    };
  }

  const payload = parseJwtPayload(normalized);
  return {
    envName,
    kind: payload ? "jwt" : "unknown",
    projectRef: trimText(payload?.ref).toLowerCase() || null,
    role: trimText(payload?.role).toLowerCase() || null,
    value: normalized,
  };
};

const buildUrlCandidates = (env: EnvLike): UrlCandidate[] =>
  ([
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
  ] as const)
    .map((envName) => {
      const value = trimText(env[envName]);
      if (!value) {
        return null;
      }

      return {
        envName,
        projectRef: getProjectRefFromSupabaseUrl(value),
        value,
      };
    })
    .filter((candidate): candidate is UrlCandidate => candidate !== null);

const buildKeyCandidates = (env: EnvLike): KeyCandidate[] =>
  ([
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
  ] as const)
    .map((envName) => {
      const value = trimText(env[envName]);
      return value ? parseKeyCandidate(envName, value) : null;
    })
    .filter((candidate): candidate is KeyCandidate => candidate !== null);

const isServiceRoleKey = (candidate: KeyCandidate) => candidate.kind === "secret" || candidate.role === "service_role";

const describeProjectRef = (candidate: UrlCandidate | KeyCandidate) =>
  `${candidate.envName}=${candidate.projectRef ?? "unknown"}`;

const buildMissingConfigDetail = (urlCandidates: UrlCandidate[], keyCandidates: KeyCandidate[]) => {
  if (urlCandidates.length === 0 && keyCandidates.length === 0) {
    return "Supabase URL and service role key are missing.";
  }

  if (urlCandidates.length === 0) {
    return "Supabase URL is missing. Configure SUPABASE_URL for server-side health checks.";
  }

  if (keyCandidates.length === 0) {
    return "Supabase service role key is missing. Configure SUPABASE_SERVICE_ROLE_KEY for server-side health checks.";
  }

  return "Supabase admin configuration is incomplete.";
};

const buildInvalidKeyDetail = (keyCandidates: KeyCandidate[]) => {
  if (keyCandidates.some((candidate) => candidate.kind === "publishable" || candidate.role === "anon")) {
    return "Configured Supabase admin key is an anon or publishable key. Set SUPABASE_SERVICE_ROLE_KEY to a service_role key for health monitoring.";
  }

  return "Configured Supabase admin key is not a valid service_role key. Set SUPABASE_SERVICE_ROLE_KEY to a service_role key for health monitoring.";
};

const buildProjectMismatchDetail = (urlCandidates: UrlCandidate[], keyCandidates: KeyCandidate[]) => {
  const urlRefs = urlCandidates
    .filter((candidate) => candidate.projectRef)
    .map(describeProjectRef);
  const keyRefs = keyCandidates
    .filter((candidate) => candidate.projectRef)
    .map(describeProjectRef);

  if (urlRefs.length > 0 && keyRefs.length > 0) {
    return `Supabase URL and service role key reference different projects (${[
      ...urlRefs,
      ...keyRefs,
    ].join(", ")}). Update Vercel runtime envs so the URL and service role key point to the same Supabase project.`;
  }

  return "Supabase admin configuration is ambiguous across runtime envs. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY point to the same project.";
};

const scorePair = (urlCandidate: UrlCandidate, keyCandidate: KeyCandidate) => {
  if (urlCandidate.projectRef && keyCandidate.projectRef && urlCandidate.projectRef !== keyCandidate.projectRef) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (urlCandidate.envName === "SUPABASE_URL") {
    score += 4;
  }

  if (keyCandidate.envName === "SUPABASE_SERVICE_ROLE_KEY") {
    score += 4;
  }

  if (urlCandidate.projectRef && keyCandidate.projectRef && urlCandidate.projectRef === keyCandidate.projectRef) {
    score += 100;
  }

  return score;
};

export const resolveSupabaseAdminConfig = (env: EnvLike = process.env): SupabaseAdminConfigResult => {
  const urlCandidates = buildUrlCandidates(env);
  const keyCandidates = buildKeyCandidates(env);

  if (urlCandidates.length === 0 || keyCandidates.length === 0) {
    return {
      detail: buildMissingConfigDetail(urlCandidates, keyCandidates),
      ok: false,
    };
  }

  const validKeyCandidates = keyCandidates.filter(isServiceRoleKey);
  if (validKeyCandidates.length === 0) {
    return {
      detail: buildInvalidKeyDetail(keyCandidates),
      ok: false,
    };
  }

  const candidatePairs = urlCandidates
    .flatMap((urlCandidate) =>
      validKeyCandidates.map((keyCandidate) => ({
        keyCandidate,
        score: scorePair(urlCandidate, keyCandidate),
        urlCandidate,
      })),
    )
    .filter((pair) => Number.isFinite(pair.score))
    .sort((left, right) => right.score - left.score);

  const selectedPair = candidatePairs[0];
  if (!selectedPair) {
    return {
      detail: buildProjectMismatchDetail(urlCandidates, validKeyCandidates),
      ok: false,
    };
  }

  return {
    config: {
      serviceRoleKey: selectedPair.keyCandidate.value,
      serviceRoleKeyEnvName: selectedPair.keyCandidate.envName,
      supabaseUrl: selectedPair.urlCandidate.value,
      supabaseUrlEnvName: selectedPair.urlCandidate.envName,
    },
    ok: true,
  };
};
