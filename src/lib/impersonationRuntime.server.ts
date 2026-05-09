import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { IMPERSONATION_SESSION_TTL_SECONDS, type AuthUser } from "./auth.shared.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";

type EnvLike = Record<string, string | undefined>;

type JsonRecord = Record<string, unknown>;

type ImpersonationSessionRow = {
  ended_at?: string | null;
  expires_at?: string | null;
  id?: string | null;
  last_used_at?: string | null;
  metadata?: unknown;
  reason?: string | null;
  revoked_at?: string | null;
  revocation_reason?: string | null;
  started_at?: string | null;
  super_admin_user_id?: string | null;
  target_library_id?: string | null;
  target_user_id?: string | null;
  trusted_session_id?: string | null;
};

export type ActiveImpersonationSession = {
  expiresAt: string;
  id: string;
  metadata: JsonRecord;
  reason: string | null;
  startedAt: string;
  superAdminUserId: string;
  targetLibraryId: string | null;
  targetUserId: string;
  trustedSessionId: string;
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeNullableText = (value: unknown) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const toRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
};

const nowIso = () => new Date().toISOString();

const buildServiceClient = (env: EnvLike) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("impersonation_runtime"),
    },
  });
};

const normalizeImpersonationSession = (row: ImpersonationSessionRow | null): ActiveImpersonationSession | null => {
  const id = normalizeText(row?.id);
  const superAdminUserId = normalizeText(row?.super_admin_user_id);
  const targetUserId = normalizeText(row?.target_user_id);
  const trustedSessionId = normalizeText(row?.trusted_session_id);
  const startedAt = normalizeText(row?.started_at);
  const expiresAt = normalizeText(row?.expires_at);

  if (!id || !superAdminUserId || !targetUserId || !trustedSessionId || !startedAt || !expiresAt) {
    return null;
  }

  return {
    expiresAt,
    id,
    metadata: toRecord(row?.metadata),
    reason: normalizeNullableText(row?.reason),
    startedAt,
    superAdminUserId,
    targetLibraryId: normalizeNullableText(row?.target_library_id),
    targetUserId,
    trustedSessionId,
  };
};

const isExpiredIso = (value: string | null | undefined) => {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) && timestamp <= Date.now();
};

const markImpersonationEnded = async (
  env: EnvLike,
  impersonationId: string,
  reason: string,
  metadata: JsonRecord = {},
) => {
  const client = buildServiceClient(env);
  const endedAt = nowIso();

  await client
    .from("super_admin_impersonation_sessions")
    .update({
      ended_at: endedAt,
      metadata: {
        ...metadata,
        ended_at: endedAt,
      },
      revocation_reason: reason,
      revoked_at: endedAt,
    })
    .eq("id", impersonationId)
    .is("ended_at", null);
};

export const loadActiveImpersonationSession = async (
  env: EnvLike,
  trustedSessionId: string,
): Promise<ActiveImpersonationSession | null> => {
  const normalizedTrustedSessionId = normalizeText(trustedSessionId);
  if (!normalizedTrustedSessionId) {
    return null;
  }

  const client = buildServiceClient(env);
  const { data, error } = await client
    .from("super_admin_impersonation_sessions")
    .select("id, super_admin_user_id, target_user_id, target_library_id, reason, metadata, started_at, expires_at, ended_at, revoked_at, revocation_reason, last_used_at, trusted_session_id")
    .eq("trusted_session_id", normalizedTrustedSessionId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const session = normalizeImpersonationSession(data as ImpersonationSessionRow | null);
  if (!session) {
    return null;
  }

  if (normalizeText((data as ImpersonationSessionRow | null)?.ended_at) || normalizeText((data as ImpersonationSessionRow | null)?.revoked_at)) {
    return null;
  }

  if (isExpiredIso(session.expiresAt)) {
    await markImpersonationEnded(env, session.id, "expired", {
      expires_at: session.expiresAt,
    }).catch(() => undefined);
    return null;
  }

  return session;
};

export const createImpersonationSessionState = async (
  env: EnvLike,
  {
    expiresAt,
    metadata,
    reason,
    superAdminUserId,
    targetLibraryId,
    targetUserId,
    trustedSessionId,
  }: {
    expiresAt?: string | null;
    metadata?: JsonRecord;
    reason?: string | null;
    superAdminUserId: string;
    targetLibraryId?: string | null;
    targetUserId: string;
    trustedSessionId: string;
  },
): Promise<ActiveImpersonationSession> => {
  const client = buildServiceClient(env);
  const computedExpiresAt =
    normalizeText(expiresAt) ||
    new Date(Date.now() + IMPERSONATION_SESSION_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await client
    .from("super_admin_impersonation_sessions")
    .insert({
      expires_at: computedExpiresAt,
      metadata: metadata ?? {},
      reason: reason ?? null,
      super_admin_user_id: superAdminUserId,
      target_library_id: targetLibraryId ?? null,
      target_user_id: targetUserId,
      trusted_session_id: trustedSessionId,
    })
    .select("id, super_admin_user_id, target_user_id, target_library_id, reason, metadata, started_at, expires_at, ended_at, revoked_at, revocation_reason, last_used_at, trusted_session_id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const session = normalizeImpersonationSession(data as ImpersonationSessionRow | null);
  if (!session) {
    throw new Error("Unable to create impersonation session state.");
  }

  return session;
};

export const endImpersonationSession = async (
  env: EnvLike,
  trustedSessionId: string,
  {
    metadata,
    reason,
  }: {
    metadata?: JsonRecord;
    reason: string;
  },
): Promise<ActiveImpersonationSession | null> => {
  const activeSession = await loadActiveImpersonationSession(env, trustedSessionId);
  if (!activeSession) {
    return null;
  }

  await markImpersonationEnded(env, activeSession.id, reason, metadata);
  return activeSession;
};

export const touchImpersonationSession = async (
  env: EnvLike,
  impersonationId: string,
  metadata: JsonRecord = {},
) => {
  const client = buildServiceClient(env);
  await client
    .from("super_admin_impersonation_sessions")
    .update({
      last_used_at: nowIso(),
      metadata: {
        ...metadata,
      },
    })
    .eq("id", impersonationId);
};

export const revokeImpersonationSessionsForTargetUser = async (
  env: EnvLike,
  {
    metadata,
    reason,
    targetUserId,
  }: {
    metadata?: JsonRecord;
    reason: string;
    targetUserId: string;
  },
) => {
  const client = buildServiceClient(env);
  const endedAt = nowIso();
  await client
    .from("super_admin_impersonation_sessions")
    .update({
      ended_at: endedAt,
      metadata: {
        ...(metadata ?? {}),
        ended_at: endedAt,
      },
      revocation_reason: reason,
      revoked_at: endedAt,
    })
    .eq("target_user_id", targetUserId)
    .is("ended_at", null);
};

export const recordImpersonationAuditEvent = async (
  env: EnvLike,
  {
    action,
    effectiveUser,
    impersonationId,
    ipAddress,
    libraryId,
    metadata,
    realUser,
    requestId,
    requestPath,
    requestSource,
    userAgent,
  }: {
    action: string;
    effectiveUser: AuthUser;
    impersonationId: string;
    ipAddress?: string | null;
    libraryId?: string | null;
    metadata?: JsonRecord;
    realUser: AuthUser;
    requestId?: string | null;
    requestPath?: string | null;
    requestSource?: string | null;
    userAgent?: string | null;
  },
) => {
  const client = buildServiceClient(env);
  const auditMetadata = {
    ...(metadata ?? {}),
    effective_user_email: effectiveUser.email,
    effective_user_id: effectiveUser.id,
    impersonation_active: true,
    impersonation_id: impersonationId,
    real_user_email: realUser.email,
    real_user_id: realUser.id,
    request_path: requestPath ?? null,
    request_source: requestSource ?? null,
  };

  await Promise.allSettled([
    client.from("super_admin_audit_logs").insert({
      action,
      actor_email: realUser.email,
      actor_user_id: realUser.id,
      ip_address: ipAddress ?? null,
      metadata: auditMetadata,
      request_id: requestId || randomUUID(),
      target_display: effectiveUser.fullName || effectiveUser.email || effectiveUser.id,
      target_id: effectiveUser.id,
      target_type: "impersonated_action",
      user_agent: userAgent ?? null,
    }),
    client.from("platform_activity_logs").insert({
      activity_type: action,
      actor_user_id: realUser.id,
      library_id: libraryId ?? null,
      message: `Impersonated action: ${action}.`,
      metadata: auditMetadata,
      user_id: effectiveUser.id,
    }),
  ]);
};
