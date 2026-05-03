import bcrypt from "bcryptjs";
import { Queue, Worker } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import IORedis from "ioredis";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomInt } from "node:crypto";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_REFRESH_COOKIE_NAME,
  OTP_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  SUPER_ADMIN_IDLE_TIMEOUT_SECONDS,
  SUPER_ADMIN_OTP_TTL_SECONDS,
  TRUSTED_DEVICE_TTL_SECONDS,
  buildOtpMessage,
  expandPhoneCandidates,
  isAdminFallbackRole,
  isValidOtpCode,
  maskEmailAddress,
  normalizePhoneNumber,
  type AuthDeliveryChannel,
  type AuthLoginMethod,
  type AuthSessionScope,
  type AuthUser,
  type ClientAuthSession,
  type LoginEmailResponse,
  type RefreshSessionResponse,
  type SendOtpResponse,
  type SuperAdminLoginResponse,
  type SuperAdminOtpChannel,
  type SuperAdminVerifyOtpResponse,
  type VerifyOtpResponse,
} from "./auth.shared.js";
import {
  getSuperAdminLoginRuntimeIssues,
  getSuperAdminVerifyRuntimeIssues,
  type AuthConfigIssue,
} from "./authRuntimeConfig.js";
import { sendEmail } from "./email.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.js";
import { resolveRequestAuthUser } from "./requestAuth.server.js";

type EnvLike = Record<string, string | undefined>;

type RequestContext = {
  authorization?: string;
  cookieHeader?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  ip?: string;
  userAgent?: string;
};

type ErrorResponseBody = {
  code?: string;
  message: string;
  remainingAttempts?: number;
  retryAfter?: number;
  success: false;
};

type ServiceResponse<T> = {
  body: ErrorResponseBody | T;
  cookies?: string[];
  statusCode: number;
};

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  phone_number: string | null;
  user_id: string;
};

type UserRoleRow = {
  role: string;
};

type SuperAdminEmailLookupRow = {
  email: string | null;
  full_name: string | null;
  user_id: string;
};

type OtpRecord = {
  attempts: number;
  deliveryChannel: AuthDeliveryChannel;
  email: string | null;
  expiresAt: number;
  fingerprintHash: string | null;
  fullName: string | null;
  otpHash: string;
  phone: string;
  requestId: string;
  resendAvailableAt: number;
  roles: string[];
  userId: string;
};

type DeliveryRecord = {
  fallbackSent: boolean;
  message: string;
  phone: string;
  requestId: string;
  status: string;
  whatsappSid: string | null;
};

type TrustedDeviceRow = {
  auth_level: number;
  delivery_channel: string | null;
  device_fingerprint_hash: string | null;
  device_label: string | null;
  expires_at: string;
  id: string;
  idle_timeout_seconds: number | null;
  login_method: AuthLoginMethod;
  refresh_token_hash: string;
  revoked_at: string | null;
  session_scope: AuthSessionScope;
  user_id: string;
};

type SuperAdminOtpRecord = {
  attempts: number;
  createdAt: number;
  deliveryChannel: SuperAdminOtpChannel;
  email: string;
  expiresAt: number;
  fingerprintHash: string | null;
  fullName: string | null;
  hashedOtp: string;
  ip: string | null;
  userId: string;
};

type ActiveSessionContext = {
  authLevel: number;
  refreshToken: string;
  sessionScope: AuthSessionScope;
  user: AuthUser;
};

type FallbackJobData = {
  message: string;
  phone: string;
  requestId: string;
};

const OTP_HASH_ROUNDS = 8;
const DELIVERY_RECORD_TTL_SECONDS = 20 * 60;
const SEND_OTP_IP_LIMIT = 20;
const VERIFY_OTP_IP_LIMIT = 40;
const EMAIL_LOGIN_IP_LIMIT = 20;
const SUPER_ADMIN_OTP_REQUEST_LIMIT = 3;
const SUPER_ADMIN_OTP_REQUEST_WINDOW_SECONDS = 60;
const SUPER_ADMIN_VERIFY_IP_LIMIT = 10;
const SUPER_ADMIN_FAILED_ATTEMPT_LIMIT = 5;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const BLOCK_WINDOW_SECONDS = 10 * 60;
const SUPER_ADMIN_BLOCK_WINDOW_SECONDS = 15 * 60;
const FALLBACK_QUEUE_NAME = "libriofy-auth-whatsapp-fallback";

const redisClients = new Map<string, IORedis>();
const queueInstances = new Map<string, Queue<FallbackJobData>>();
const startedWorkerKeys = new Set<string>();

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

const resolveDefaultCountryCode = (env: EnvLike) => readEnv(env, "AUTH_DEFAULT_COUNTRY_CODE", "DEFAULT_COUNTRY_CODE") || "+91";

const buildError = <T>(
  statusCode: number,
  message: string,
  code?: string,
  extras?: Partial<ErrorResponseBody>,
): ServiceResponse<T> => ({
  statusCode,
  body: {
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(extras ?? {}),
  },
});

const createServiceClient = (env: EnvLike) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service configuration is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("otp_auth_service"),
    },
  });
};

const createAnonClient = (env: EnvLike) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const anonKey = readEnv(env, "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase anon configuration is missing.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("otp_auth_anon"),
    },
  });
};

const resolvePublicAppUrl = (env: EnvLike) =>
  readEnv(env, "PUBLIC_APP_URL", "APP_URL", "SITE_URL", "VITE_PUBLIC_APP_URL", "VITE_APP_URL") || "http://localhost:8080";

const resolveWebOtpHost = (env: EnvLike) => {
  try {
    return new URL(resolvePublicAppUrl(env)).host;
  } catch {
    return "";
  }
};

const shouldUseSecureCookies = (env: EnvLike) => {
  try {
    return new URL(resolvePublicAppUrl(env)).protocol === "https:";
  } catch {
    return false;
  }
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const buildSessionCookie = (env: EnvLike, value: string, maxAgeSeconds: number) =>
  [
    `${AUTH_REFRESH_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    shouldUseSecureCookies(env) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

const buildClearedSessionCookie = (env: EnvLike) => buildSessionCookie(env, "", 0);

const parseCookieHeader = (cookieHeader: string | undefined) => {
  const cookies = new Map<string, string>();

  for (const chunk of trimText(cookieHeader).split(";")) {
    const [rawName, ...rawValueParts] = chunk.split("=");
    const name = trimText(rawName);
    if (!name) {
      continue;
    }

    cookies.set(name, decodeURIComponent(rawValueParts.join("=").trim()));
  }

  return cookies;
};

const readRefreshTokenFromCookies = (cookieHeader: string | undefined) =>
  parseCookieHeader(cookieHeader).get(AUTH_REFRESH_COOKIE_NAME) ?? "";

const createRequestId = () => randomBytes(12).toString("hex");
const createRefreshToken = () => randomBytes(32).toString("hex");

const getRedisConnection = (env: EnvLike) => {
  const redisUrl = readEnv(env, "REDIS_URL");
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured.");
  }

  const existing = redisClients.get(redisUrl);
  if (existing) {
    return existing;
  }

  const client = new IORedis(redisUrl, {
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  client.on("error", (error) => {
    console.warn("[auth] Redis connection error", error);
  });

  redisClients.set(redisUrl, client);
  return client;
};

const getFallbackQueue = (env: EnvLike) => {
  const redisUrl = readEnv(env, "REDIS_URL");
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured.");
  }

  const existing = queueInstances.get(redisUrl);
  if (existing) {
    return existing;
  }

  const queue = new Queue<FallbackJobData>(FALLBACK_QUEUE_NAME, {
    connection: getRedisConnection(env),
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  queueInstances.set(redisUrl, queue);
  return queue;
};

const otpKey = (phone: string) => `auth:otp:${phone}`;
const otpCooldownKey = (phone: string) => `auth:otp:cooldown:${phone}`;
const phoneBlockKey = (phone: string) => `auth:otp:block:${phone}`;
const deliveryKey = (requestId: string) => `auth:otp:delivery:${requestId}`;
const deliverySidKey = (sid: string) => `auth:otp:delivery:sid:${sid}`;
const rateKey = (scope: string, value: string) => `auth:rate:${scope}:${value}`;
const superAdminOtpKey = (email: string) => `super_admin_otp:${email}`;
const superAdminFailureKey = (scope: "email" | "ip", value: string) => `auth:super-admin:fail:${scope}:${value}`;
const superAdminBlockKey = (scope: "email" | "ip", value: string) => `auth:super-admin:block:${scope}:${value}`;

const getOtpRecord = async (redis: IORedis, phone: string) => {
  const rawRecord = await redis.get(otpKey(phone));
  if (!rawRecord) {
    return null;
  }

  try {
    return JSON.parse(rawRecord) as OtpRecord;
  } catch {
    return null;
  }
};

const setOtpRecord = async (redis: IORedis, record: OtpRecord) => {
  const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
  await redis.set(otpKey(record.phone), JSON.stringify(record), "EX", ttlSeconds);
};

const getDeliveryRecord = async (redis: IORedis, requestId: string) => {
  const rawRecord = await redis.get(deliveryKey(requestId));
  if (!rawRecord) {
    return null;
  }

  try {
    return JSON.parse(rawRecord) as DeliveryRecord;
  } catch {
    return null;
  }
};

const setDeliveryRecord = async (redis: IORedis, record: DeliveryRecord, sid?: string | null) => {
  const multi = redis.multi();
  multi.set(deliveryKey(record.requestId), JSON.stringify(record), "EX", DELIVERY_RECORD_TTL_SECONDS);

  if (sid) {
    multi.set(deliverySidKey(sid), record.requestId, "EX", DELIVERY_RECORD_TTL_SECONDS);
  }

  await multi.exec();
};

const enforceRateLimit = async (
  redis: IORedis,
  scope: string,
  value: string,
  maxAttempts: number,
  ttlSeconds: number,
) => {
  if (!value) {
    return null;
  }

  const key = rateKey(scope, value);
  const nextCount = await redis.incr(key);
  if (nextCount === 1) {
    await redis.expire(key, ttlSeconds);
  }

  if (nextCount <= maxAttempts) {
    return null;
  }

  return Math.max(1, await redis.ttl(key));
};

const normalizeEmail = (value: unknown) => trimText(value).toLowerCase();

const buildLoginDeviceLabel = (context: RequestContext) =>
  [trimText(context.deviceLabel), trimText(context.userAgent)].filter(Boolean).join(" | ") || "unknown";

const logSuperAdminDebug = (message: string, details: Record<string, unknown>) => {
  console.info(`[auth][super-admin] ${message}`, details);
};

const logSuperAdminRuntimeIssues = (
  flow: "login" | "verify",
  issues: AuthConfigIssue[],
  context: RequestContext,
  email?: string | null,
) => {
  console.error("[auth][super-admin] auth runtime configuration is incomplete", {
    device: buildLoginDeviceLabel(context),
    email: email ? maskEmailAddress(email) : null,
    flow,
    ip: trimText(context.ip) || null,
    issues: issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      missing: issue.missing,
    })),
  });
};

const buildRuntimeIssueResponse = <T>(issues: AuthConfigIssue[]): ServiceResponse<T> => {
  const primaryIssue = issues[0];
  if (!primaryIssue) {
    return buildError(503, "Super admin sign-in is temporarily unavailable.", "AUTH_INFRA_UNAVAILABLE");
  }

  return buildError(503, primaryIssue.message, primaryIssue.code);
};

const getSuperAdminOtpRecord = async (redis: IORedis, email: string) => {
  const rawRecord = await redis.get(superAdminOtpKey(email));
  if (!rawRecord) {
    return null;
  }

  try {
    return JSON.parse(rawRecord) as SuperAdminOtpRecord;
  } catch {
    return null;
  }
};

const setSuperAdminOtpRecord = async (redis: IORedis, record: SuperAdminOtpRecord) => {
  const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
  await redis.set(superAdminOtpKey(record.email), JSON.stringify(record), "EX", ttlSeconds);
};

const clearSuperAdminOtpRecord = async (redis: IORedis, email: string) => {
  await redis.del(superAdminOtpKey(email));
};

const getSuperAdminBlockedTtl = async (redis: IORedis, email: string, ip: string) => {
  const [emailTtl, ipTtl] = await Promise.all([
    email ? redis.ttl(superAdminBlockKey("email", email)) : Promise.resolve(-1),
    ip ? redis.ttl(superAdminBlockKey("ip", ip)) : Promise.resolve(-1),
  ]);

  return Math.max(emailTtl, ipTtl, 0);
};

const incrementSuperAdminFailureCount = async (redis: IORedis, scope: "email" | "ip", value: string) => {
  if (!value) {
    return 0;
  }

  const key = superAdminFailureKey(scope, value);
  const nextCount = await redis.incr(key);
  if (nextCount === 1) {
    await redis.expire(key, SUPER_ADMIN_BLOCK_WINDOW_SECONDS);
  }

  if (nextCount >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT) {
    await redis.set(superAdminBlockKey(scope, value), "1", "EX", SUPER_ADMIN_BLOCK_WINDOW_SECONDS);
  }

  return nextCount;
};

const clearSuperAdminFailures = async (redis: IORedis, email: string, ip: string) => {
  const keys = [
    email ? superAdminFailureKey("email", email) : "",
    email ? superAdminBlockKey("email", email) : "",
    ip ? superAdminFailureKey("ip", ip) : "",
    ip ? superAdminBlockKey("ip", ip) : "",
  ].filter(Boolean);

  if (keys.length) {
    await redis.del(...keys);
  }
};

const trackSuperAdminFailure = async (redis: IORedis, email: string, ip: string) => {
  const [emailCount, ipCount] = await Promise.all([
    incrementSuperAdminFailureCount(redis, "email", email),
    incrementSuperAdminFailureCount(redis, "ip", ip),
  ]);

  const retryAfter =
    Math.max(
      emailCount >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT
        ? await redis.ttl(superAdminBlockKey("email", email))
        : 0,
      ipCount >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT
        ? await redis.ttl(superAdminBlockKey("ip", ip))
        : 0,
    ) || 0;

  return {
    blocked: emailCount >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT || ipCount >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT,
    retryAfter: Math.max(retryAfter, 0),
  };
};

const canSendSuperAdminEmailOtp = (env: EnvLike) =>
  !!readEnv(env, "RESEND_API_KEY") && !!readEnv(env, "AUTH_EMAIL_FROM", "RESEND_FROM_EMAIL");

const buildSuperAdminEmailSubject = () => "Libriofy Admin Login OTP";

const buildSuperAdminEmailText = (otp: string, fullName: string | null) =>
  [
    fullName ? `Hi ${fullName},` : "Hi,",
    "",
    `Your OTP is: ${otp}`,
    "Valid for 5 minutes.",
    "Do not share this code.",
  ].join("\n");

const buildSuperAdminEmailHtml = (otp: string, fullName: string | null) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b;">
    <p style="margin:0 0 16px;">${fullName ? `Hi ${fullName},` : "Hi,"}</p>
    <p style="margin:0 0 16px;">Use this code to access the Libriofy Super Admin panel:</p>
    <div style="margin:0 0 20px;padding:18px 20px;border-radius:16px;background:#111827;color:#fff;font-size:32px;letter-spacing:8px;font-weight:700;text-align:center;">
      ${otp}
    </div>
    <p style="margin:0 0 8px;">Valid for 5 minutes.</p>
    <p style="margin:0;color:#52525b;">Do not share this code.</p>
  </div>
`;

const sendSuperAdminOtpEmail = async ({
  email,
  env,
  fullName,
  otp,
}: {
  email: string;
  env: EnvLike;
  fullName: string | null;
  otp: string;
}) => {
  const from = readEnv(env, "AUTH_EMAIL_FROM", "RESEND_FROM_EMAIL");
  if (!readEnv(env, "RESEND_API_KEY") || !from) {
    throw new Error("Email OTP delivery is not configured.");
  }

  await sendEmail({
    env,
    from,
    html: buildSuperAdminEmailHtml(otp, fullName),
    metadata: {
      category: "super_admin_otp",
      delivery_channel: "email",
      severity: "INFO",
    },
    subject: buildSuperAdminEmailSubject(),
    text: buildSuperAdminEmailText(otp, fullName),
    to: [email],
    user: email,
  });
};

const isSuperAdminEmailAllowedByEnv = (env: EnvLike, email: string) => {
  const allowList = readEnv(env, "SUPER_ADMIN_ALLOWED_EMAILS", "SUPER_ADMIN_EMAIL_ALLOWLIST");
  if (!allowList) {
    return true;
  }

  const allowedEmails = new Set(
    allowList
      .split(",")
      .map((value) => normalizeEmail(value))
      .filter(Boolean),
  );

  return allowedEmails.has(email);
};

const logLoginAttempt = async ({
  channel,
  context,
  email,
  env,
  reason,
  status,
  step,
  userId,
}: {
  channel?: string | null;
  context: RequestContext;
  email?: string | null;
  env: EnvLike;
  reason?: string | null;
  status: "success" | "failed";
  step: "email" | "otp";
  userId?: string | null;
}) => {
  try {
    const serviceClient = createServiceClient(env);
    await serviceClient.from("login_logs").insert({
      channel: channel ?? null,
      device: buildLoginDeviceLabel(context),
      email: trimText(email) || null,
      ip_address: trimText(context.ip) || null,
      login_step: step,
      reason: trimText(reason) || null,
      status,
      user_id: trimText(userId) || null,
    });
  } catch (error) {
    console.warn("[auth] Failed to persist login log", error);
  }
};

const loadAuthUserById = async (env: EnvLike, userId: string) => {
  const serviceClient = createServiceClient(env);

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
    phone: typedProfile?.phone_number ?? null,
    fullName: typedProfile?.full_name ?? null,
    roles: typedRoles.map((role) => role.role),
  } satisfies AuthUser;
};

const findUserByPhone = async (env: EnvLike, phone: string) => {
  const candidates = expandPhoneCandidates(phone, resolveDefaultCountryCode(env));
  if (!candidates.length) {
    return null;
  }

  const serviceClient = createServiceClient(env);
  const { data: profile, error } = await serviceClient
    .from("profiles")
    .select("user_id, email, full_name, phone_number")
    .in("phone_number", candidates)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const typedProfile = profile as ProfileRow | null;
  if (!typedProfile?.user_id) {
    return null;
  }

  return loadAuthUserById(env, typedProfile.user_id);
};

const resolveSuperAdminEmailUser = async (env: EnvLike, email: string) => {
  const serviceClient = createServiceClient(env);
  const { data, error } = await serviceClient.rpc("find_super_admin_by_email", {
    candidate_email: email,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? (data[0] as SuperAdminEmailLookupRow | undefined) : undefined;
  if (!row?.user_id) {
    return null;
  }

  const user = await loadAuthUserById(env, row.user_id);
  return {
    ...user,
    email: user.email ?? row.email ?? null,
    fullName: user.fullName ?? row.full_name ?? null,
  } satisfies AuthUser;
};

const getJwtSecret = (env: EnvLike) => {
  const secret = readEnv(env, "SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET");
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not configured.");
  }

  return secret;
};

const mintAccessToken = ({
  authLevel,
  env,
  loginMethod,
  sessionId,
  sessionScope,
  user,
}: {
  authLevel: number;
  env: EnvLike;
  loginMethod: AuthLoginMethod;
  sessionId: string;
  sessionScope: AuthSessionScope;
  user: AuthUser;
}) => {
  const now = Math.floor(Date.now() / 1000);
  const provider =
    sessionScope === "super_admin"
      ? "super_admin_email_otp"
      : loginMethod === "otp"
        ? "phone_otp"
        : "email_password";
  const authMethods =
    sessionScope === "super_admin"
      ? [
          { method: "email", timestamp: now },
          { method: "otp", timestamp: now },
        ]
      : [{ method: loginMethod === "otp" ? "otp" : "password", timestamp: now }];

  return jwt.sign(
    {
      aal: authLevel >= 2 ? "aal2" : "aal1",
      amr: authMethods,
      app_metadata: {
        auth_level: authLevel,
        provider,
        roles: user.roles,
        session_scope: sessionScope,
      },
      aud: "authenticated",
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      role: "authenticated",
      session_id: sessionId,
      sub: user.id,
      user_metadata: {
        full_name: user.fullName ?? undefined,
        phone_number: user.phone ?? undefined,
      },
    },
    getJwtSecret(env),
    {
      algorithm: "HS256",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  );
};

const createClientSession = ({
  accessToken,
  authLevel,
  loginMethod,
  idleTimeoutSeconds,
  provider,
  sessionScope,
  trustedDevice,
  user,
}: {
  accessToken: string;
  authLevel: number;
  loginMethod: AuthLoginMethod;
  idleTimeoutSeconds: number | null;
  provider: ClientAuthSession["provider"];
  sessionScope: AuthSessionScope;
  trustedDevice: boolean;
  user: AuthUser;
}): ClientAuthSession => ({
  accessToken,
  authLevel,
  expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
  idleTimeoutSeconds,
  loginMethod,
  provider,
  sessionScope,
  trustedDevice,
  user,
});

const insertTrustedDeviceSession = async ({
  authLevel,
  deliveryChannel,
  deviceFingerprint,
  deviceLabel,
  env,
  idleTimeoutSeconds,
  ip,
  loginMethod,
  sessionScope,
  sessionTtlSeconds,
  user,
  userAgent,
}: {
  authLevel: number;
  deliveryChannel?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  env: EnvLike;
  idleTimeoutSeconds?: number | null;
  ip?: string;
  loginMethod: AuthLoginMethod;
  sessionScope: AuthSessionScope;
  sessionTtlSeconds: number;
  user: AuthUser;
  userAgent?: string;
}) => {
  const serviceClient = createServiceClient(env);
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000).toISOString();

  const { error } = await serviceClient.from("auth_trusted_devices").insert({
    auth_level: authLevel,
    delivery_channel: deliveryChannel ?? null,
    device_fingerprint_hash: trimText(deviceFingerprint) ? sha256(trimText(deviceFingerprint)) : null,
    device_label: trimText(deviceLabel) || null,
    expires_at: expiresAt,
    idle_timeout_seconds: idleTimeoutSeconds ?? null,
    last_ip: trimText(ip) || null,
    last_used_at: new Date().toISOString(),
    login_method: loginMethod,
    phone_number: user.phone,
    refresh_token_hash: sha256(refreshToken),
    revoked_at: null,
    session_scope: sessionScope,
    user_agent: trimText(userAgent) || null,
    user_id: user.id,
  });

  if (error) {
    throw error;
  }

  return refreshToken;
};

const createAuthenticatedResponse = async ({
  authLevel = 1,
  deliveryChannel,
  env,
  idleTimeoutSeconds = null,
  loginMethod,
  sessionScope = "general",
  sessionTtlSeconds = TRUSTED_DEVICE_TTL_SECONDS,
  user,
  ...context
}: {
  authLevel?: number;
  deliveryChannel?: string;
  env: EnvLike;
  idleTimeoutSeconds?: number | null;
  loginMethod: AuthLoginMethod;
  sessionScope?: AuthSessionScope;
  sessionTtlSeconds?: number;
  user: AuthUser;
} & RequestContext) => {
  const refreshToken = await insertTrustedDeviceSession({
    authLevel,
    deliveryChannel,
    deviceFingerprint: context.deviceFingerprint,
    deviceLabel: context.deviceLabel,
    env,
    idleTimeoutSeconds,
    ip: context.ip,
    loginMethod,
    sessionScope,
    sessionTtlSeconds,
    user,
    userAgent: context.userAgent,
  });

  const accessToken = mintAccessToken({
    authLevel,
    env,
    loginMethod,
    sessionId: createRequestId(),
    sessionScope,
    user,
  });

  return {
    cookies: [buildSessionCookie(env, refreshToken, sessionTtlSeconds)],
    session: createClientSession({
      accessToken,
      authLevel,
      idleTimeoutSeconds,
      loginMethod,
      provider: "custom",
      sessionScope,
      trustedDevice: true,
      user,
    }),
  };
};

const getTrustedDeviceSession = async (env: EnvLike, refreshToken: string) => {
  if (!refreshToken) {
    return null;
  }

  const serviceClient = createServiceClient(env);
  const { data, error } = await serviceClient
    .from("auth_trusted_devices")
    .select("id, user_id, device_fingerprint_hash, refresh_token_hash, expires_at, revoked_at, login_method, device_label, delivery_channel, auth_level, session_scope, idle_timeout_seconds")
    .eq("refresh_token_hash", sha256(refreshToken))
    .maybeSingle();

  if (error) {
    throw error;
  }

  const typedSession = data as TrustedDeviceRow | null;
  if (!typedSession || typedSession.revoked_at) {
    return null;
  }

  if (new Date(typedSession.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return typedSession;
};

const rotateTrustedDeviceSession = async ({
  deviceFingerprint,
  deviceSession,
  env,
  ip,
  userAgent,
}: {
  deviceFingerprint?: string;
  deviceSession: TrustedDeviceRow;
  env: EnvLike;
  ip?: string;
  userAgent?: string;
}) => {
  const serviceClient = createServiceClient(env);
  const refreshToken = createRefreshToken();
  const nextTtlSeconds =
    deviceSession.session_scope === "super_admin"
      ? deviceSession.idle_timeout_seconds ?? SUPER_ADMIN_IDLE_TIMEOUT_SECONDS
      : TRUSTED_DEVICE_TTL_SECONDS;
  const { error } = await serviceClient
    .from("auth_trusted_devices")
    .update({
      device_fingerprint_hash: trimText(deviceFingerprint)
        ? sha256(trimText(deviceFingerprint))
        : deviceSession.device_fingerprint_hash,
      expires_at: new Date(Date.now() + nextTtlSeconds * 1000).toISOString(),
      last_ip: trimText(ip) || null,
      last_used_at: new Date().toISOString(),
      refresh_token_hash: sha256(refreshToken),
      user_agent: trimText(userAgent) || null,
    })
    .eq("id", deviceSession.id);

  if (error) {
    throw error;
  }

  return refreshToken;
};

const revokeRefreshToken = async (env: EnvLike, refreshToken: string, reason = "logout") => {
  if (!refreshToken) {
    return;
  }

  const serviceClient = createServiceClient(env);
  await serviceClient
    .from("auth_trusted_devices")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq("refresh_token_hash", sha256(refreshToken));
};

const resolveActiveSessionFromRefreshToken = async (
  env: EnvLike,
  context: RequestContext = {},
): Promise<ActiveSessionContext | null> => {
  const refreshToken = readRefreshTokenFromCookies(context.cookieHeader);
  if (!refreshToken) {
    return null;
  }

  const trustedSession = await getTrustedDeviceSession(env, refreshToken);
  if (!trustedSession) {
    return null;
  }

  if (
    trustedSession.device_fingerprint_hash &&
    trimText(context.deviceFingerprint) &&
    trustedSession.device_fingerprint_hash !== sha256(trimText(context.deviceFingerprint))
  ) {
    await revokeRefreshToken(env, refreshToken, "device_mismatch");
    return null;
  }

  const user = await loadAuthUserById(env, trustedSession.user_id);
  if (
    trustedSession.session_scope === "super_admin" &&
    (trustedSession.auth_level < 2 || !user.roles.includes("super_admin"))
  ) {
    await revokeRefreshToken(env, refreshToken, "super_admin_scope_invalid");
    return null;
  }

  return {
    authLevel: trustedSession.auth_level,
    refreshToken,
    sessionScope: trustedSession.session_scope,
    user,
  };
};

export const resolveSuperAdminSessionRequest = async (
  env: EnvLike,
  context: RequestContext = {},
): Promise<ActiveSessionContext | null> => {
  const activeSession = await resolveActiveSessionFromRefreshToken(env, context);
  if (!activeSession) {
    return null;
  }

  if (
    activeSession.sessionScope !== "super_admin" ||
    activeSession.authLevel < 2 ||
    !activeSession.user.roles.includes("super_admin")
  ) {
    return null;
  }

  return activeSession;
};

const scheduleWhatsappFallback = async (env: EnvLike, payload: FallbackJobData) => {
  const queue = getFallbackQueue(env);
  await queue.add("send-fallback-sms", payload, {
    delay: 5_000,
    jobId: payload.requestId,
  });
};

const resolveTwilioConfig = (env: EnvLike) => ({
  accountSid: readEnv(env, "TWILIO_ACCOUNT_SID"),
  authToken: readEnv(env, "TWILIO_AUTH_TOKEN"),
  smsFrom: readEnv(env, "TWILIO_SMS_FROM"),
  whatsappFrom: readEnv(env, "TWILIO_WHATSAPP_FROM"),
});

const resolveTwilioStatusCallbackUrl = (env: EnvLike) => {
  const publicUrl = resolvePublicAppUrl(env);
  if (!publicUrl || publicUrl.includes("localhost") || publicUrl.includes("127.0.0.1")) {
    return "";
  }

  return `${publicUrl.replace(/\/+$/, "")}/auth/twilio-status`;
};

const normalizeTwilioWhatsAppAddress = (value: string, defaultCountryCode: string) => {
  const normalized = normalizePhoneNumber(value, defaultCountryCode);
  return `whatsapp:${normalized}`;
};

const sendViaTwilio = async ({
  accountSid,
  authToken,
  body,
  channel,
  defaultCountryCode,
  from,
  statusCallback,
  to,
}: {
  accountSid: string;
  authToken: string;
  body: string;
  channel: AuthDeliveryChannel;
  defaultCountryCode: string;
  from: string;
  statusCallback?: string;
  to: string;
}) => {
  const normalizedRecipient = normalizePhoneNumber(to, defaultCountryCode);
  if (!normalizedRecipient) {
    throw new Error("Recipient phone number is invalid.");
  }

  const payload = new URLSearchParams();
  payload.set("Body", body);
  payload.set(
    "From",
    channel === "whatsapp"
      ? normalizeTwilioWhatsAppAddress(from, defaultCountryCode)
      : normalizePhoneNumber(from, defaultCountryCode),
  );
  payload.set(
    "To",
    channel === "whatsapp"
      ? normalizeTwilioWhatsAppAddress(normalizedRecipient, defaultCountryCode)
      : normalizedRecipient,
  );

  if (statusCallback) {
    payload.set("StatusCallback", statusCallback);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
    if (!response.ok) {
      throw new Error(typeof parsed?.message === "string" ? parsed.message : `Twilio ${channel} send failed.`);
    }

    return {
      sid: trimText(parsed?.sid),
      status: trimText(parsed?.status) || "queued",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sendFallbackSms = async ({
  env,
  message,
  phone,
  requestId,
}: FallbackJobData & { env: EnvLike }) => {
  const redis = getRedisConnection(env);
  const delivery = await getDeliveryRecord(redis, requestId);
  if (!delivery || delivery.fallbackSent || delivery.status === "delivered" || delivery.status === "read") {
    return;
  }

  const twilio = resolveTwilioConfig(env);
  const defaultCountryCode = resolveDefaultCountryCode(env);
  if (!twilio.accountSid || !twilio.authToken || !twilio.smsFrom) {
    return;
  }

  await sendViaTwilio({
    accountSid: twilio.accountSid,
    authToken: twilio.authToken,
    body: message,
    channel: "sms",
    defaultCountryCode,
    from: twilio.smsFrom,
    to: phone,
  });

  await setDeliveryRecord(redis, {
    ...delivery,
    fallbackSent: true,
    status: `${delivery.status || "queued"}:fallback_sms_sent`,
  }, delivery.whatsappSid);
};

const sendOtpMessage = async ({
  body,
  env,
  phone,
  requestId,
}: {
  body: string;
  env: EnvLike;
  phone: string;
  requestId: string;
}) => {
  const redis = getRedisConnection(env);
  const twilio = resolveTwilioConfig(env);
  const defaultCountryCode = resolveDefaultCountryCode(env);
  const normalizedPhone = normalizePhoneNumber(phone, defaultCountryCode);

  if (!normalizedPhone) {
    throw new Error("Phone number is invalid.");
  }

  if (!twilio.accountSid || !twilio.authToken) {
    throw new Error("Twilio credentials are not configured.");
  }

  const statusCallback = resolveTwilioStatusCallbackUrl(env) || undefined;

  if (twilio.whatsappFrom) {
    try {
      const whatsappSend = await sendViaTwilio({
        accountSid: twilio.accountSid,
        authToken: twilio.authToken,
        body,
        channel: "whatsapp",
        defaultCountryCode,
        from: twilio.whatsappFrom,
        statusCallback,
        to: normalizedPhone,
      });

      await setDeliveryRecord(redis, {
        fallbackSent: false,
        message: body,
        phone: normalizedPhone,
        requestId,
        status: whatsappSend.status,
        whatsappSid: whatsappSend.sid || null,
      }, whatsappSend.sid || null);

      if (twilio.smsFrom && statusCallback) {
        await scheduleWhatsappFallback(env, {
          message: body,
          phone: normalizedPhone,
          requestId,
        });
      }

      return "whatsapp" as const;
    } catch (error) {
      if (!twilio.smsFrom) {
        throw error;
      }
    }
  }

  if (!twilio.smsFrom) {
    throw new Error("TWILIO_SMS_FROM is not configured for SMS delivery.");
  }

  await sendViaTwilio({
    accountSid: twilio.accountSid,
    authToken: twilio.authToken,
    body,
    channel: "sms",
    defaultCountryCode,
    from: twilio.smsFrom,
    to: normalizedPhone,
  });

  return "sms" as const;
};

export const ensureOtpAuthWorkerStarted = (env: EnvLike) => {
  if (readEnv(env, "VERCEL", "AWS_LAMBDA_FUNCTION_NAME")) {
    return;
  }

  const redisUrl = readEnv(env, "REDIS_URL");
  if (!redisUrl || startedWorkerKeys.has(redisUrl)) {
    return;
  }

  const worker = new Worker<FallbackJobData>(
    FALLBACK_QUEUE_NAME,
    async (job) => {
      await sendFallbackSms({
        env,
        message: job.data.message,
        phone: job.data.phone,
        requestId: job.data.requestId,
      });
    },
    {
      connection: getRedisConnection(env),
      concurrency: 4,
    },
  );

  worker.on("error", (error) => {
    console.warn("[auth] OTP fallback worker error", error);
  });

  startedWorkerKeys.add(redisUrl);
};

export const resolveSuperAdminLoginRequest = async (
  env: EnvLike,
  requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<SuperAdminLoginResponse>> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};
  const email = normalizeEmail(body.email);
  const runtimeIssues = getSuperAdminLoginRuntimeIssues(env);

  if (runtimeIssues.length) {
    logSuperAdminRuntimeIssues("login", runtimeIssues, context, email);
    return buildRuntimeIssueResponse(runtimeIssues);
  }

  logSuperAdminDebug("login request received", {
    device: buildLoginDeviceLabel(context),
    email: maskEmailAddress(email),
    ip: trimText(context.ip) || null,
  });

  const redis = getRedisConnection(env);
  const ip = trimText(context.ip);
  const [ipRetryAfter, emailRetryAfter] = await Promise.all([
    enforceRateLimit(
      redis,
      "super-admin-send-otp-ip",
      ip,
      SUPER_ADMIN_OTP_REQUEST_LIMIT,
      SUPER_ADMIN_OTP_REQUEST_WINDOW_SECONDS,
    ),
    enforceRateLimit(
      redis,
      "super-admin-send-otp-email",
      email,
      SUPER_ADMIN_OTP_REQUEST_LIMIT,
      SUPER_ADMIN_OTP_REQUEST_WINDOW_SECONDS,
    ),
  ]);
  const retryAfter = Math.max(ipRetryAfter || 0, emailRetryAfter || 0);
  if (retryAfter > 0) {
    logSuperAdminDebug("OTP request rate limited", {
      email: maskEmailAddress(email),
      emailRetryAfter: emailRetryAfter || null,
      ip: ip || null,
      ipRetryAfter: ipRetryAfter || null,
    });
    return buildError(429, "Too many Super Admin OTP requests. Please wait a bit.", "RATE_LIMITED", {
      retryAfter,
    });
  }

  if (!email) {
    logSuperAdminDebug("login request rejected because email is missing", {
      email: maskEmailAddress(email),
    });
    return buildError(400, "Enter your approved Super Admin email to continue.", "INVALID_REQUEST");
  }

  const blockedTtl = await getSuperAdminBlockedTtl(redis, email, ip);
  if (blockedTtl > 0) {
    logSuperAdminDebug("login blocked after repeated failures", {
      email: maskEmailAddress(email),
      ip: ip || null,
      retryAfter: blockedTtl,
    });
    await logLoginAttempt({
      context,
      email,
      env,
      reason: "blocked",
      status: "failed",
      step: "email",
    });
    return buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
      retryAfter: blockedTtl,
    });
  }

  if (!isSuperAdminEmailAllowedByEnv(env, email)) {
    const failure = await trackSuperAdminFailure(redis, email, ip);
    logSuperAdminDebug("login rejected because email is not allow-listed", {
      blocked: failure.blocked,
      email: maskEmailAddress(email),
      ip: ip || null,
      retryAfter: failure.retryAfter || null,
    });
    await logLoginAttempt({
      context,
      email,
      env,
      reason: "email_not_allowed",
      status: "failed",
      step: "email",
    });

    return failure.blocked
      ? buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
          retryAfter: failure.retryAfter || SUPER_ADMIN_BLOCK_WINDOW_SECONDS,
        })
      : buildError(403, "This email is not authorized for Super Admin access.", "ACCESS_DENIED");
  }

  const user = await resolveSuperAdminEmailUser(env, email);
  logSuperAdminDebug("super admin email lookup completed", {
    email: maskEmailAddress(email),
    matched: Boolean(user),
    roles: user?.roles ?? [],
    userId: user?.id ?? null,
  });
  const hasSuperAdminRole = !!user?.roles.includes("super_admin");
  logSuperAdminDebug("role check completed", {
    email: maskEmailAddress(email),
    hasSuperAdminRole,
    userId: user?.id ?? null,
  });

  if (!user || !hasSuperAdminRole) {
    const failure = await trackSuperAdminFailure(redis, email, ip);
    await logLoginAttempt({
      context,
      email,
      env,
      reason: "access_denied",
      status: "failed",
      step: "email",
    });

    return failure.blocked
      ? buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
          retryAfter: failure.retryAfter || SUPER_ADMIN_BLOCK_WINDOW_SECONDS,
        })
      : buildError(403, "This email is not authorized for Super Admin access.", "ACCESS_DENIED");
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hashedOtp = await bcrypt.hash(otp, OTP_HASH_ROUNDS);
  const normalizedAccountEmail = normalizeEmail(user.email ?? email);
  const deliveryChannel: SuperAdminOtpChannel = "email";
  const preferredEmail = normalizedAccountEmail;

  await setSuperAdminOtpRecord(redis, {
    attempts: 0,
    createdAt: Date.now(),
    deliveryChannel,
    email: normalizedAccountEmail,
    expiresAt: Date.now() + SUPER_ADMIN_OTP_TTL_SECONDS * 1000,
    fingerprintHash: trimText(context.deviceFingerprint) ? sha256(trimText(context.deviceFingerprint)) : null,
    fullName: user.fullName,
    hashedOtp,
    ip: ip || null,
    userId: user.id,
  });
  logSuperAdminDebug("OTP record stored", {
    channel: deliveryChannel,
    email: maskEmailAddress(normalizedAccountEmail),
    expiresIn: SUPER_ADMIN_OTP_TTL_SECONDS,
    userId: user.id,
  });

  try {
    await sendSuperAdminOtpEmail({
      email: preferredEmail,
      env,
      fullName: user.fullName,
      otp,
    });
  } catch (error) {
    await clearSuperAdminOtpRecord(redis, normalizedAccountEmail);
    console.warn("[auth] Super admin email OTP delivery failed", error);
    await logLoginAttempt({
      channel: deliveryChannel,
      context,
      email: normalizedAccountEmail,
      env,
      reason: "otp_delivery_failed",
      status: "failed",
      step: "email",
      userId: user.id,
    });
    return buildError(503, "Unable to send the Super Admin OTP right now.", "OTP_DELIVERY_UNAVAILABLE");
  }

  await logLoginAttempt({
    channel: deliveryChannel,
    context,
    email: normalizedAccountEmail,
    env,
    reason: "otp_sent",
    status: "success",
    step: "email",
    userId: user.id,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      channel: deliveryChannel,
      email: normalizedAccountEmail,
      expiresIn: SUPER_ADMIN_OTP_TTL_SECONDS,
      maskedDestination: maskEmailAddress(preferredEmail),
      message: "OTP sent to your Super Admin email.",
      retryAfter: OTP_COOLDOWN_SECONDS,
    },
  };
};

export const resolveSuperAdminVerifyOtpRequest = async (
  env: EnvLike,
  requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<SuperAdminVerifyOtpResponse>> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};
  const runtimeIssues = getSuperAdminVerifyRuntimeIssues(env);
  const email = normalizeEmail(body.email);
  const otp = trimText(body.otp);

  if (runtimeIssues.length) {
    logSuperAdminRuntimeIssues("verify", runtimeIssues, context, email);
    return buildRuntimeIssueResponse(runtimeIssues);
  }

  logSuperAdminDebug("OTP verification request received", {
    device: buildLoginDeviceLabel(context),
    email: maskEmailAddress(email),
    hasOtp: Boolean(otp),
    ip: trimText(context.ip) || null,
  });

  const redis = getRedisConnection(env);
  const ip = trimText(context.ip);
  const ipRetryAfter = await enforceRateLimit(
    redis,
    "super-admin-verify-ip",
    ip,
    SUPER_ADMIN_VERIFY_IP_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (ipRetryAfter) {
    logSuperAdminDebug("OTP verification IP rate limited", {
      email: maskEmailAddress(email),
      ip: ip || null,
      retryAfter: ipRetryAfter,
    });
    return buildError(429, "Too many OTP verification attempts from this IP. Please wait a bit.", "IP_RATE_LIMITED", {
      retryAfter: ipRetryAfter,
    });
  }

  if (!email || !isValidOtpCode(otp)) {
    logSuperAdminDebug("OTP verification rejected because input is invalid", {
      email: maskEmailAddress(email),
      otpLength: otp.length,
    });
    return buildError(400, "Enter the 6-digit OTP to continue.", "INVALID_REQUEST");
  }

  const otpRecord = await getSuperAdminOtpRecord(redis, email);
  logSuperAdminDebug("OTP record lookup completed", {
    email: maskEmailAddress(email),
    recordFound: Boolean(otpRecord),
  });
  if (!otpRecord) {
    await logLoginAttempt({
      channel: "email",
      context,
      email,
      env,
      reason: "otp_missing_or_expired",
      status: "failed",
      step: "otp",
    });
    return buildError(410, "OTP expired. Restart the super admin login flow.", "OTP_EXPIRED");
  }

  const blockedTtl = await getSuperAdminBlockedTtl(redis, otpRecord.email, ip);
  if (blockedTtl > 0) {
    logSuperAdminDebug("OTP verification blocked after repeated failures", {
      email: maskEmailAddress(otpRecord.email),
      ip: ip || null,
      retryAfter: blockedTtl,
    });
    await logLoginAttempt({
      channel: otpRecord.deliveryChannel,
      context,
      email: otpRecord.email,
      env,
      reason: "blocked",
      status: "failed",
      step: "otp",
      userId: otpRecord.userId,
    });
    return buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
      retryAfter: blockedTtl,
    });
  }

  if (otpRecord.expiresAt <= Date.now()) {
    await clearSuperAdminOtpRecord(redis, otpRecord.email);
    await logLoginAttempt({
      channel: otpRecord.deliveryChannel,
      context,
      email: otpRecord.email,
      env,
      reason: "otp_expired",
      status: "failed",
      step: "otp",
      userId: otpRecord.userId,
    });
    return buildError(410, "OTP expired. Restart the super admin login flow.", "OTP_EXPIRED");
  }

  if (
    otpRecord.fingerprintHash &&
    trimText(context.deviceFingerprint) &&
    otpRecord.fingerprintHash !== sha256(trimText(context.deviceFingerprint))
  ) {
    logSuperAdminDebug("OTP verification failed because device fingerprint changed", {
      email: maskEmailAddress(otpRecord.email),
      ip: ip || null,
      userId: otpRecord.userId,
    });
    await clearSuperAdminOtpRecord(redis, otpRecord.email);
    const failure = await trackSuperAdminFailure(redis, otpRecord.email, ip);
    await logLoginAttempt({
      channel: otpRecord.deliveryChannel,
      context,
      email: otpRecord.email,
      env,
      reason: "device_mismatch",
      status: "failed",
      step: "otp",
      userId: otpRecord.userId,
    });

    return failure.blocked
      ? buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
          retryAfter: failure.retryAfter || SUPER_ADMIN_BLOCK_WINDOW_SECONDS,
        })
      : buildError(401, "Device verification failed. Restart login and try again.", "DEVICE_MISMATCH");
  }

  const matches = await bcrypt.compare(otp, otpRecord.hashedOtp);
  logSuperAdminDebug("OTP comparison completed", {
    email: maskEmailAddress(otpRecord.email),
    matched: matches,
    userId: otpRecord.userId,
  });
  if (!matches) {
    const nextAttempts = otpRecord.attempts + 1;
    const failure = await trackSuperAdminFailure(redis, otpRecord.email, ip);

    if (nextAttempts >= SUPER_ADMIN_FAILED_ATTEMPT_LIMIT || failure.blocked) {
      await clearSuperAdminOtpRecord(redis, otpRecord.email);
      await logLoginAttempt({
        channel: otpRecord.deliveryChannel,
        context,
        email: otpRecord.email,
        env,
        reason: "otp_attempts_exceeded",
        status: "failed",
        step: "otp",
        userId: otpRecord.userId,
      });
      return buildError(429, "Too many failed attempts. Try again in 15 minutes.", "LOGIN_BLOCKED", {
        retryAfter: failure.retryAfter || SUPER_ADMIN_BLOCK_WINDOW_SECONDS,
      });
    }

    await setSuperAdminOtpRecord(redis, {
      ...otpRecord,
      attempts: nextAttempts,
    });
    await logLoginAttempt({
      channel: otpRecord.deliveryChannel,
      context,
      email: otpRecord.email,
      env,
      reason: "otp_invalid",
      status: "failed",
      step: "otp",
      userId: otpRecord.userId,
    });

    return buildError(401, "OTP is incorrect or expired.", "OTP_INVALID", {
      remainingAttempts: SUPER_ADMIN_FAILED_ATTEMPT_LIMIT - nextAttempts,
    });
  }

  await clearSuperAdminOtpRecord(redis, otpRecord.email);
  await clearSuperAdminFailures(redis, otpRecord.email, ip);

  const user = await loadAuthUserById(env, otpRecord.userId);
  const hasSuperAdminRole = user.roles.includes("super_admin");
  logSuperAdminDebug("post-OTP role check completed", {
    email: maskEmailAddress(otpRecord.email),
    hasSuperAdminRole,
    roles: user.roles,
    userId: otpRecord.userId,
  });
  if (!hasSuperAdminRole) {
    await logLoginAttempt({
      channel: otpRecord.deliveryChannel,
      context,
      email: otpRecord.email,
      env,
      reason: "role_missing_after_otp",
      status: "failed",
      step: "otp",
      userId: otpRecord.userId,
    });
    return buildError(403, "Super admin access is no longer available for this account.", "ACCESS_DENIED");
  }

  const authenticated = await createAuthenticatedResponse({
    ...context,
    authLevel: 2,
    deliveryChannel: otpRecord.deliveryChannel,
    env,
    idleTimeoutSeconds: SUPER_ADMIN_IDLE_TIMEOUT_SECONDS,
    loginMethod: "email",
    sessionScope: "super_admin",
    sessionTtlSeconds: SUPER_ADMIN_IDLE_TIMEOUT_SECONDS,
    user,
  });
  logSuperAdminDebug("super admin session issued", {
    authLevel: 2,
    channel: otpRecord.deliveryChannel,
    email: maskEmailAddress(otpRecord.email),
    sessionScope: "super_admin",
    userId: otpRecord.userId,
  });

  await logLoginAttempt({
    channel: otpRecord.deliveryChannel,
    context,
    email: otpRecord.email,
    env,
    reason: "super_admin_login",
    status: "success",
    step: "otp",
    userId: otpRecord.userId,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      channel: otpRecord.deliveryChannel,
      message: "Super admin login successful.",
      session: authenticated.session,
    },
    cookies: authenticated.cookies,
  };
};

export const resolveSendOtpRequest = async (
  env: EnvLike,
  requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<SendOtpResponse>> => {
  ensureOtpAuthWorkerStarted(env);

  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};

  const redis = getRedisConnection(env);
  const ipRetryAfter = await enforceRateLimit(
    redis,
    "send-otp-ip",
    trimText(context.ip),
    SEND_OTP_IP_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (ipRetryAfter) {
    return buildError(429, "Too many OTP requests from this IP. Please wait a bit.", "IP_RATE_LIMITED", {
      retryAfter: ipRetryAfter,
    });
  }

  const phone = normalizePhoneNumber(body.phone, resolveDefaultCountryCode(env));
  if (!phone) {
    return buildError(400, "Enter a valid mobile number in E.164 format.", "INVALID_PHONE");
  }

  const blockedTtl = await redis.ttl(phoneBlockKey(phone));
  if (blockedTtl > 0) {
    return buildError(429, "Too many failed attempts. Please request a fresh OTP shortly.", "PHONE_BLOCKED", {
      retryAfter: blockedTtl,
    });
  }

  const cooldownTtl = await redis.ttl(otpCooldownKey(phone));
  if (cooldownTtl > 0) {
    return buildError(429, `Resend available in ${cooldownTtl}s.`, "OTP_COOLDOWN", {
      retryAfter: cooldownTtl,
    });
  }

  const user = await findUserByPhone(env, phone);
  if (!user) {
    return buildError(404, "No account is linked to this mobile number.", "ACCOUNT_NOT_FOUND");
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const otpHash = await bcrypt.hash(otp, OTP_HASH_ROUNDS);
  const requestId = createRequestId();
  const message = buildOtpMessage(otp, resolveWebOtpHost(env));
  const channel = await sendOtpMessage({
    body: message,
    env,
    phone,
    requestId,
  });

  await setOtpRecord(redis, {
    attempts: 0,
    deliveryChannel: channel,
    email: user.email,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
    fingerprintHash: trimText(context.deviceFingerprint) ? sha256(trimText(context.deviceFingerprint)) : null,
    fullName: user.fullName,
    otpHash,
    phone,
    requestId,
    resendAvailableAt: Date.now() + OTP_COOLDOWN_SECONDS * 1000,
    roles: user.roles,
    userId: user.id,
  });
  await redis.set(otpCooldownKey(phone), requestId, "EX", OTP_COOLDOWN_SECONDS);

  return {
    statusCode: 200,
    body: {
      success: true,
      channel,
      expiresIn: OTP_TTL_SECONDS,
      message: `OTP sent via ${channel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
      retryAfter: OTP_COOLDOWN_SECONDS,
    },
  };
};

export const resolveVerifyOtpRequest = async (
  env: EnvLike,
  requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<VerifyOtpResponse>> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};

  const redis = getRedisConnection(env);
  const ipRetryAfter = await enforceRateLimit(
    redis,
    "verify-otp-ip",
    trimText(context.ip),
    VERIFY_OTP_IP_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS,
  );
  if (ipRetryAfter) {
    return buildError(429, "Too many OTP verification attempts from this IP. Please wait a bit.", "IP_RATE_LIMITED", {
      retryAfter: ipRetryAfter,
    });
  }

  const phone = normalizePhoneNumber(body.phone, resolveDefaultCountryCode(env));
  const otp = trimText(body.otp);
  if (!phone || !isValidOtpCode(otp)) {
    return buildError(400, "Enter a valid phone number and 6-digit OTP.", "INVALID_REQUEST");
  }

  const otpRecord = await getOtpRecord(redis, phone);
  if (!otpRecord) {
    return buildError(410, "OTP expired. Request a new code to continue.", "OTP_EXPIRED");
  }

  if (otpRecord.expiresAt <= Date.now()) {
    await redis.del(otpKey(phone));
    return buildError(410, "OTP expired. Request a new code to continue.", "OTP_EXPIRED");
  }

  const matches = await bcrypt.compare(otp, otpRecord.otpHash);
  if (!matches) {
    const nextAttempts = otpRecord.attempts + 1;
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      await redis.del(otpKey(phone));
      await redis.set(phoneBlockKey(phone), "1", "EX", BLOCK_WINDOW_SECONDS);
      return buildError(429, "OTP failed too many times. Please request a fresh code.", "OTP_ATTEMPTS_EXCEEDED", {
        remainingAttempts: 0,
        retryAfter: BLOCK_WINDOW_SECONDS,
      });
    }

    await setOtpRecord(redis, {
      ...otpRecord,
      attempts: nextAttempts,
    });

    return buildError(401, "Incorrect OTP. Please try again.", "OTP_INVALID", {
      remainingAttempts: OTP_MAX_ATTEMPTS - nextAttempts,
    });
  }

  await redis.del(otpKey(phone));
  await redis.del(phoneBlockKey(phone));

  const user = await loadAuthUserById(env, otpRecord.userId);
  const authenticated = await createAuthenticatedResponse({
    ...context,
    deliveryChannel: otpRecord.deliveryChannel,
    env,
    loginMethod: "otp",
    user,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      channel: otpRecord.deliveryChannel,
      message: "Login successful.",
      session: authenticated.session,
    },
    cookies: authenticated.cookies,
  };
};

export const resolveEmailLoginRequest = async (
  env: EnvLike,
  requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<LoginEmailResponse>> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};

  try {
    const redis = getRedisConnection(env);
    const ipRetryAfter = await enforceRateLimit(
      redis,
      "email-login-ip",
      trimText(context.ip),
      EMAIL_LOGIN_IP_LIMIT,
      RATE_LIMIT_WINDOW_SECONDS,
    );
    if (ipRetryAfter) {
      return buildError(429, "Too many login attempts from this IP. Please wait a bit.", "IP_RATE_LIMITED", {
        retryAfter: ipRetryAfter,
      });
    }
  } catch (error) {
    console.warn("[auth] Email login rate limit unavailable, continuing without Redis", error);
  }

  const email = trimText(body.email).toLowerCase();
  const password = trimText(body.password);
  if (!email || !password) {
    return buildError(400, "Email and password are required.", "INVALID_REQUEST");
  }

  const anonClient = createAnonClient(env);
  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user?.id) {
    return buildError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }

  const user = await loadAuthUserById(env, data.user.id);
  if (user.roles.includes("super_admin")) {
    return buildError(
      403,
      "Use the Super Admin login page to continue with OTP verification.",
      "SUPER_ADMIN_MFA_REQUIRED",
    );
  }

  if (!user.roles.some(isAdminFallbackRole)) {
    return buildError(403, "Email login is restricted to admin accounts.", "EMAIL_LOGIN_FORBIDDEN");
  }

  const authenticated = await createAuthenticatedResponse({
    ...context,
    env,
    loginMethod: "email",
    user,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Login successful.",
      session: authenticated.session,
    },
    cookies: authenticated.cookies,
  };
};

export const resolveRefreshSessionRequest = async (
  env: EnvLike,
  _requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<RefreshSessionResponse>> => {
  const refreshToken = readRefreshTokenFromCookies(context.cookieHeader);
  if (!refreshToken) {
    return buildError(401, "Session expired. Please sign in again.", "SESSION_MISSING");
  }

  const trustedSession = await getTrustedDeviceSession(env, refreshToken);
  if (!trustedSession) {
    return {
      statusCode: 401,
      body: {
        success: false,
        message: "Session expired. Please sign in again.",
        code: "SESSION_EXPIRED",
      },
      cookies: [buildClearedSessionCookie(env)],
    };
  }

  if (
    trustedSession.device_fingerprint_hash &&
    trimText(context.deviceFingerprint) &&
    trustedSession.device_fingerprint_hash !== sha256(trimText(context.deviceFingerprint))
  ) {
    await revokeRefreshToken(env, refreshToken, "device_mismatch");
    return {
      statusCode: 401,
      body: {
        success: false,
        message: "Device verification failed. Please sign in again.",
        code: "DEVICE_MISMATCH",
      },
      cookies: [buildClearedSessionCookie(env)],
    };
  }

  if (trustedSession.session_scope === "super_admin" && trustedSession.auth_level < 2) {
    await revokeRefreshToken(env, refreshToken, "super_admin_mfa_required");
    return {
      statusCode: 401,
      body: {
        success: false,
        message: "Super admin verification has expired. Please sign in again.",
        code: "SUPER_ADMIN_MFA_REQUIRED",
      },
      cookies: [buildClearedSessionCookie(env)],
    };
  }

  const user = await loadAuthUserById(env, trustedSession.user_id);
  if (trustedSession.session_scope === "super_admin" && !user.roles.includes("super_admin")) {
    await revokeRefreshToken(env, refreshToken, "super_admin_role_removed");
    return {
      statusCode: 401,
      body: {
        success: false,
        message: "Super admin access is no longer available for this account.",
        code: "ACCESS_REVOKED",
      },
      cookies: [buildClearedSessionCookie(env)],
    };
  }

  const nextRefreshToken = await rotateTrustedDeviceSession({
    deviceFingerprint: context.deviceFingerprint,
    deviceSession: trustedSession,
    env,
    ip: context.ip,
    userAgent: context.userAgent,
  });
  const accessToken = mintAccessToken({
    authLevel: trustedSession.auth_level,
    env,
    loginMethod: trustedSession.login_method,
    sessionId: trustedSession.id,
    sessionScope: trustedSession.session_scope,
    user,
  });
  const sessionTtlSeconds =
    trustedSession.session_scope === "super_admin"
      ? trustedSession.idle_timeout_seconds ?? SUPER_ADMIN_IDLE_TIMEOUT_SECONDS
      : TRUSTED_DEVICE_TTL_SECONDS;

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Session restored.",
      session: createClientSession({
        accessToken,
        authLevel: trustedSession.auth_level,
        idleTimeoutSeconds: trustedSession.idle_timeout_seconds,
        loginMethod: trustedSession.login_method,
        provider: "custom",
        sessionScope: trustedSession.session_scope,
        trustedDevice: true,
        user,
      }),
    },
    cookies: [buildSessionCookie(env, nextRefreshToken, sessionTtlSeconds)],
  };
};

export const resolveLogoutRequest = async (
  env: EnvLike,
  _requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<{ message: string; success: true }>> => {
  await revokeRefreshToken(env, readRefreshTokenFromCookies(context.cookieHeader), "logout");

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Logged out.",
    },
    cookies: [buildClearedSessionCookie(env)],
  };
};

export const resolveLogoutAllRequest = async (
  env: EnvLike,
  _requestBody: unknown,
  context: RequestContext = {},
): Promise<ServiceResponse<{ message: string; success: true }>> => {
  const authUser = await resolveRequestAuthUser(env, context.authorization);
  const refreshToken = readRefreshTokenFromCookies(context.cookieHeader);
  const trustedSession = !authUser ? await getTrustedDeviceSession(env, refreshToken) : null;
  const userId = authUser?.id ?? trustedSession?.user_id ?? "";

  if (!userId) {
    return buildError(401, "Unauthorized.", "UNAUTHORIZED");
  }

  const serviceClient = createServiceClient(env);
  await serviceClient
    .from("auth_trusted_devices")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: "logout_all_devices",
    })
    .eq("user_id", userId);

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Logged out from all devices.",
    },
    cookies: [buildClearedSessionCookie(env)],
  };
};

export const resolveTwilioStatusCallbackRequest = async (
  env: EnvLike,
  requestBody: unknown,
): Promise<ServiceResponse<{ success: true }>> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};

  const messageSid = trimText(body.MessageSid ?? body.messageSid);
  const messageStatus = trimText(body.MessageStatus ?? body.messageStatus).toLowerCase();
  if (!messageSid || !messageStatus) {
    return {
      statusCode: 200,
      body: { success: true },
    };
  }

  const redis = getRedisConnection(env);
  const requestId = await redis.get(deliverySidKey(messageSid));
  if (!requestId) {
    return {
      statusCode: 200,
      body: { success: true },
    };
  }

  const delivery = await getDeliveryRecord(redis, requestId);
  if (!delivery) {
    return {
      statusCode: 200,
      body: { success: true },
    };
  }

  const nextDelivery: DeliveryRecord = {
    ...delivery,
    status: messageStatus,
  };
  await setDeliveryRecord(redis, nextDelivery, delivery.whatsappSid);

  if ((messageStatus === "failed" || messageStatus === "undelivered") && !delivery.fallbackSent) {
    await sendFallbackSms({
      env,
      message: delivery.message,
      phone: delivery.phone,
      requestId: delivery.requestId,
    });
  }

  return {
    statusCode: 200,
    body: { success: true },
  };
};
