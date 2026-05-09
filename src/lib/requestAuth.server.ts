import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

import { loadActiveImpersonationSession } from "./impersonationRuntime.server.js";
import type { AuthImpersonationContext, AuthSessionScope, AuthUser } from "./auth.shared.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";

type EnvLike = Record<string, string | undefined>;

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  phone_number: string | null;
  user_id: string;
};

type UserRoleRow = {
  role: string;
};

export type AuthenticatedRequestUser = AuthUser & {
  effectiveUser?: AuthUser;
  impersonation?: AuthImpersonationContext | null;
  realUser?: AuthUser | null;
  sessionScope?: AuthSessionScope;
  token: string;
  tokenSource: "custom" | "supabase";
  trustedSessionId?: string | null;
};

type TrustedSessionRow = {
  auth_level?: number | null;
  expires_at?: string | null;
  id?: string | null;
  revoked_at?: string | null;
  session_scope?: string | null;
  user_id?: string | null;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

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
      fetch: createInstrumentedServerSupabaseFetch("request_auth_service"),
    },
  });
};

const buildAnonClient = (env: EnvLike) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const anonKey = readEnv(env, "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase anon credentials are missing.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("request_auth_anon"),
    },
  });
};

const loadAuthUser = async (env: EnvLike, userId: string) => {
  const serviceClient = buildServiceClient(env);

  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] = await Promise.all([
    serviceClient
      .from("profiles")
      .select("user_id, email, full_name, phone_number")
      .eq("user_id", userId)
      .maybeSingle(),
    serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId),
  ]);

  if (profileError) {
    throw profileError;
  }

  if (rolesError) {
    throw rolesError;
  }

  const typedProfile = profile as ProfileRow | null;
  const typedRoles = (roles ?? []) as UserRoleRow[];

  return {
    id: userId,
    email: typedProfile?.email ?? null,
    fullName: typedProfile?.full_name ?? null,
    phone: typedProfile?.phone_number ?? null,
    roles: typedRoles.map((role) => role.role),
  } satisfies AuthUser;
};

const loadTrustedSession = async (env: EnvLike, sessionId: string) => {
  const normalizedSessionId = trimText(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const serviceClient = buildServiceClient(env);
  const { data, error } = await serviceClient
    .from("auth_trusted_devices")
    .select("id, user_id, expires_at, revoked_at, auth_level, session_scope")
    .eq("id", normalizedSessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const session = data as TrustedSessionRow | null;
  if (!session?.id || session.revoked_at) {
    return null;
  }

  const expiresAt = Date.parse(trimText(session.expires_at));
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return null;
  }

  return session;
};

export const parseBearerToken = (authorizationHeader: string | undefined) => {
  const headerValue = trimText(authorizationHeader);
  if (!headerValue) {
    return "";
  }

  return headerValue.replace(/^Bearer\s+/i, "").trim();
};

const resolveSupabaseTokenUser = async (env: EnvLike, token: string) => {
  try {
    const anonClient = buildAnonClient(env);
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data.user?.id) {
      return null;
    }

    const user = await loadAuthUser(env, data.user.id);
    return {
      ...user,
      token,
      tokenSource: "supabase" as const,
    };
  } catch {
    return null;
  }
};

const resolveCustomTokenUser = async (env: EnvLike, token: string) => {
  try {
    const jwtSecret = readEnv(env, "SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET");
    if (!jwtSecret) {
      return null;
    }

    const verified = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
      audience: "authenticated",
    });

    const claims = verified && typeof verified === "object" ? verified : null;
    const userId = trimText(claims && "sub" in claims ? claims.sub : "");
    if (!userId) {
      return null;
    }

    const appMetadata =
      claims && "app_metadata" in claims && claims.app_metadata && typeof claims.app_metadata === "object"
        ? (claims.app_metadata as Record<string, unknown>)
        : {};
    const sessionId = trimText(claims && "session_id" in claims ? claims.session_id : "");
    const sessionScopeCandidate = trimText(appMetadata.session_scope);
    const sessionScope: AuthSessionScope =
      sessionScopeCandidate === "super_admin" || sessionScopeCandidate === "impersonation"
        ? sessionScopeCandidate
        : "general";
    const realUserId = trimText(appMetadata.real_user_id);
    const impersonationId = trimText(appMetadata.impersonation_id);
    const effectiveUser = await loadAuthUser(env, userId);

    if (sessionScope === "impersonation") {
      const trustedSession = await loadTrustedSession(env, sessionId);
      if (!trustedSession || trimText(trustedSession.user_id) !== realUserId || !impersonationId) {
        return null;
      }

      const activeImpersonation = await loadActiveImpersonationSession(env, sessionId);
      if (
        !activeImpersonation ||
        activeImpersonation.id !== impersonationId ||
        activeImpersonation.targetUserId !== userId ||
        activeImpersonation.superAdminUserId !== realUserId
      ) {
        return null;
      }

      const realUser = await loadAuthUser(env, realUserId);
      return {
        ...effectiveUser,
        effectiveUser,
        impersonation: {
          effectiveUser,
          expiresAt: activeImpersonation.expiresAt,
          impersonationId: activeImpersonation.id,
          realUser,
          startedAt: activeImpersonation.startedAt,
        },
        realUser,
        sessionScope: "impersonation" as const,
        token,
        tokenSource: "custom" as const,
        trustedSessionId: sessionId,
      };
    }

    if (sessionId) {
      const trustedSession = await loadTrustedSession(env, sessionId);
      if (trustedSession && trimText(trustedSession.user_id) !== userId) {
        return null;
      }
    }

    return {
      ...effectiveUser,
      effectiveUser,
      impersonation: null,
      realUser: null,
      sessionScope: sessionScope || "general",
      token,
      tokenSource: "custom" as const,
      trustedSessionId: sessionId || null,
    };
  } catch {
    return null;
  }
};

export const resolveRequestAuthUser = async (
  env: EnvLike,
  authorizationHeader: string | undefined,
): Promise<AuthenticatedRequestUser | null> => {
  const token = parseBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  const supabaseUser = await resolveSupabaseTokenUser(env, token);
  if (supabaseUser) {
    return supabaseUser;
  }

  return resolveCustomTokenUser(env, token);
};
