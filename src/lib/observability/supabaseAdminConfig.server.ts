type EnvLike = Record<string, string | undefined>;

type LinkedProjectRefSource = "SUPABASE_PROJECT_ID" | "VITE_SUPABASE_PROJECT_ID" | "supabase/config.toml";

type SupabaseSelectionReason = "linked_project" | "matching_project" | "env_preference" | "fallback";

type SupabaseAdminConfig = {
  linkedProjectRef: string | null;
  serviceRoleKey: string;
  serviceRoleKeyEnvName: KeyCandidate["envName"];
  selectedProjectRef: string | null;
  selectionReason: SupabaseSelectionReason;
  supabaseUrl: string;
  supabaseUrlEnvName: UrlCandidate["envName"];
};

type SupabaseAdminConfigDiagnostics = {
  hasProjectMismatch: boolean;
  linkedProjectRef: string | null;
  linkedProjectRefSource: LinkedProjectRefSource;
  selectedProjectRef: string | null;
  selectedServiceRoleKeyEnvName: KeyCandidate["envName"] | null;
  selectedSupabaseUrlEnvName: UrlCandidate["envName"] | null;
  selectionReason: SupabaseSelectionReason | null;
  serviceRoleKeyCandidates: Array<{
    envName: KeyCandidate["envName"];
    kind: KeyCandidate["kind"];
    matchesLinkedProjectRef: boolean;
    projectRef: string | null;
    role: string | null;
  }>;
  supabaseUrlCandidates: Array<{
    envName: UrlCandidate["envName"];
    matchesLinkedProjectRef: boolean;
    projectRef: string | null;
  }>;
};

type SupabaseAdminConfigResult =
  | {
      config: SupabaseAdminConfig;
      diagnostics: SupabaseAdminConfigDiagnostics;
      ok: true;
    }
  | {
      detail: string;
      diagnostics: SupabaseAdminConfigDiagnostics;
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

const DEFAULT_LINKED_SUPABASE_PROJECT_REF = "hchflmrvmfvunedjhwta";

const readLinkedProjectRef = (env: EnvLike) => {
  const explicitProjectRef = trimText(env.SUPABASE_PROJECT_ID) || trimText(env.VITE_SUPABASE_PROJECT_ID);
  if (explicitProjectRef) {
    return {
      projectRef: explicitProjectRef.toLowerCase(),
      source: trimText(env.SUPABASE_PROJECT_ID) ? "SUPABASE_PROJECT_ID" : "VITE_SUPABASE_PROJECT_ID",
    } as const;
  }

  return {
    projectRef: DEFAULT_LINKED_SUPABASE_PROJECT_REF,
    source: "supabase/config.toml" as const,
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

const buildProjectMismatchDetail = (
  urlCandidates: UrlCandidate[],
  keyCandidates: KeyCandidate[],
  linkedProjectRef: string | null,
) => {
  const urlRefs = urlCandidates
    .filter((candidate) => candidate.projectRef)
    .map(describeProjectRef);
  const keyRefs = keyCandidates
    .filter((candidate) => candidate.projectRef)
    .map(describeProjectRef);
  const linkedProjectText = linkedProjectRef ? ` The linked Supabase project ref is ${linkedProjectRef}.` : "";

  if (urlRefs.length > 0 && keyRefs.length > 0) {
    return `Supabase URL and service role key reference different projects (${[
      ...urlRefs,
      ...keyRefs,
    ].join(", ")}).${linkedProjectText} Update Vercel runtime envs so the URL and service role key point to the same Supabase project.`;
  }

  return `Supabase admin configuration is ambiguous across runtime envs.${linkedProjectText} Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY point to the same project.`;
};

const scorePair = (
  urlCandidate: UrlCandidate,
  keyCandidate: KeyCandidate,
  linkedProjectRef: string | null,
) => {
  if (urlCandidate.projectRef && keyCandidate.projectRef && urlCandidate.projectRef !== keyCandidate.projectRef) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (linkedProjectRef && urlCandidate.projectRef === linkedProjectRef) {
    score += 1000;
  }

  if (linkedProjectRef && keyCandidate.projectRef === linkedProjectRef) {
    score += 1000;
  }

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

const buildDiagnostics = (
  env: EnvLike,
  urlCandidates: UrlCandidate[],
  keyCandidates: KeyCandidate[],
  selectedPair: { keyCandidate: KeyCandidate; urlCandidate: UrlCandidate } | null,
): SupabaseAdminConfigDiagnostics => {
  const linkedProjectRef = readLinkedProjectRef(env);
  const hasProjectMismatch = Boolean(
    urlCandidates.some((candidate) => candidate.projectRef) &&
      keyCandidates.some((candidate) => candidate.projectRef) &&
      !selectedPair,
  );

  return {
    hasProjectMismatch,
    linkedProjectRef: linkedProjectRef.projectRef,
    linkedProjectRefSource: linkedProjectRef.source,
    selectedProjectRef: selectedPair?.urlCandidate.projectRef ?? null,
    selectedServiceRoleKeyEnvName: selectedPair?.keyCandidate.envName ?? null,
    selectedSupabaseUrlEnvName: selectedPair?.urlCandidate.envName ?? null,
    selectionReason: selectedPair
      ? linkedProjectRef.projectRef && selectedPair.urlCandidate.projectRef === linkedProjectRef.projectRef
        ? "linked_project"
        : linkedProjectRef.projectRef && selectedPair.keyCandidate.projectRef === linkedProjectRef.projectRef
          ? "linked_project"
          : selectedPair.urlCandidate.projectRef &&
              selectedPair.keyCandidate.projectRef &&
              selectedPair.urlCandidate.projectRef === selectedPair.keyCandidate.projectRef
            ? "matching_project"
            : selectedPair.urlCandidate.envName === "SUPABASE_URL"
              ? "env_preference"
              : "fallback"
      : null,
    serviceRoleKeyCandidates: keyCandidates.map((candidate) => ({
      envName: candidate.envName,
      kind: candidate.kind,
      matchesLinkedProjectRef: Boolean(linkedProjectRef.projectRef && candidate.projectRef === linkedProjectRef.projectRef),
      projectRef: candidate.projectRef,
      role: candidate.role,
    })),
    supabaseUrlCandidates: urlCandidates.map((candidate) => ({
      envName: candidate.envName,
      matchesLinkedProjectRef: Boolean(linkedProjectRef.projectRef && candidate.projectRef === linkedProjectRef.projectRef),
      projectRef: candidate.projectRef,
    })),
  };
};

export const resolveSupabaseAdminConfig = (env: EnvLike = process.env): SupabaseAdminConfigResult => {
  const urlCandidates = buildUrlCandidates(env);
  const keyCandidates = buildKeyCandidates(env);
  const linkedProjectRef = readLinkedProjectRef(env);

  if (urlCandidates.length === 0 || keyCandidates.length === 0) {
    return {
      detail: buildMissingConfigDetail(urlCandidates, keyCandidates),
      diagnostics: buildDiagnostics(env, urlCandidates, keyCandidates, null),
      ok: false,
    };
  }

  const validKeyCandidates = keyCandidates.filter(isServiceRoleKey);
  if (validKeyCandidates.length === 0) {
    return {
      detail: buildInvalidKeyDetail(keyCandidates),
      diagnostics: buildDiagnostics(env, urlCandidates, keyCandidates, null),
      ok: false,
    };
  }

  const candidatePairs = urlCandidates
    .flatMap((urlCandidate) =>
      validKeyCandidates.map((keyCandidate) => ({
        keyCandidate,
        score: scorePair(urlCandidate, keyCandidate, linkedProjectRef.projectRef),
        urlCandidate,
      })),
    )
    .filter((pair) => Number.isFinite(pair.score))
    .sort((left, right) => right.score - left.score);

  const selectedPair = candidatePairs[0];
  if (!selectedPair) {
    return {
      diagnostics: buildDiagnostics(env, urlCandidates, validKeyCandidates, null),
      detail: buildProjectMismatchDetail(urlCandidates, validKeyCandidates, linkedProjectRef.projectRef),
      ok: false,
    };
  }

  const diagnostics = buildDiagnostics(env, urlCandidates, validKeyCandidates, selectedPair);

  return {
    diagnostics,
    config: {
      linkedProjectRef: linkedProjectRef.projectRef,
      serviceRoleKey: selectedPair.keyCandidate.value,
      serviceRoleKeyEnvName: selectedPair.keyCandidate.envName,
      selectedProjectRef: selectedPair.urlCandidate.projectRef,
      selectionReason: diagnostics.selectionReason ?? "fallback",
      supabaseUrl: selectedPair.urlCandidate.value,
      supabaseUrlEnvName: selectedPair.urlCandidate.envName,
    },
    ok: true,
  };
};
