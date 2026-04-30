import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

import type { AuthUser } from "./auth.shared.js";

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
  token: string;
  tokenSource: "custom" | "supabase";
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

    const user = await loadAuthUser(env, userId);
    return {
      ...user,
      token,
      tokenSource: "custom" as const,
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
