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
  TRUSTED_DEVICE_TTL_SECONDS,
  buildOtpMessage,
  expandPhoneCandidates,
  isAdminFallbackRole,
  isValidOtpCode,
  normalizePhoneNumber,
  type AuthDeliveryChannel,
  type AuthLoginMethod,
  type AuthUser,
  type ClientAuthSession,
  type LoginEmailResponse,
  type RefreshSessionResponse,
  type SendOtpResponse,
  type VerifyOtpResponse,
} from "./auth.shared";
import { resolveRequestAuthUser } from "./requestAuth.server";

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
  delivery_channel: string | null;
  device_fingerprint_hash: string | null;
  device_label: string | null;
  expires_at: string;
  id: string;
  login_method: AuthLoginMethod;
  refresh_token_hash: string;
  revoked_at: string | null;
  user_id: string;
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
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const BLOCK_WINDOW_SECONDS = 10 * 60;
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

const getJwtSecret = (env: EnvLike) => {
  const secret = readEnv(env, "SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET");
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET is not configured.");
  }

  return secret;
};

const mintAccessToken = ({
  env,
  loginMethod,
  sessionId,
  user,
}: {
  env: EnvLike;
  loginMethod: AuthLoginMethod;
  sessionId: string;
  user: AuthUser;
}) => {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      aal: "aal1",
      amr: [{ method: loginMethod === "otp" ? "otp" : "password", timestamp: now }],
      app_metadata: {
        provider: loginMethod === "otp" ? "phone_otp" : "email_password",
        roles: user.roles,
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
  loginMethod,
  provider,
  trustedDevice,
  user,
}: {
  accessToken: string;
  loginMethod: AuthLoginMethod;
  provider: ClientAuthSession["provider"];
  trustedDevice: boolean;
  user: AuthUser;
}): ClientAuthSession => ({
  accessToken,
  expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
  loginMethod,
  provider,
  trustedDevice,
  user,
});

const insertTrustedDeviceSession = async ({
  deliveryChannel,
  deviceFingerprint,
  deviceLabel,
  env,
  ip,
  loginMethod,
  user,
  userAgent,
}: {
  deliveryChannel?: AuthDeliveryChannel;
  deviceFingerprint?: string;
  deviceLabel?: string;
  env: EnvLike;
  ip?: string;
  loginMethod: AuthLoginMethod;
  user: AuthUser;
  userAgent?: string;
}) => {
  const serviceClient = createServiceClient(env);
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_SECONDS * 1000).toISOString();

  const { error } = await serviceClient.from("auth_trusted_devices").insert({
    delivery_channel: deliveryChannel ?? null,
    device_fingerprint_hash: trimText(deviceFingerprint) ? sha256(trimText(deviceFingerprint)) : null,
    device_label: trimText(deviceLabel) || null,
    expires_at: expiresAt,
    last_ip: trimText(ip) || null,
    last_used_at: new Date().toISOString(),
    login_method: loginMethod,
    phone_number: user.phone,
    refresh_token_hash: sha256(refreshToken),
    revoked_at: null,
    user_agent: trimText(userAgent) || null,
    user_id: user.id,
  });

  if (error) {
    throw error;
  }

  return refreshToken;
};

const createAuthenticatedResponse = async ({
  deliveryChannel,
  env,
  loginMethod,
  user,
  ...context
}: {
  deliveryChannel?: AuthDeliveryChannel;
  env: EnvLike;
  loginMethod: AuthLoginMethod;
  user: AuthUser;
} & RequestContext) => {
  const refreshToken = await insertTrustedDeviceSession({
    deliveryChannel,
    deviceFingerprint: context.deviceFingerprint,
    deviceLabel: context.deviceLabel,
    env,
    ip: context.ip,
    loginMethod,
    user,
    userAgent: context.userAgent,
  });

  const accessToken = mintAccessToken({
    env,
    loginMethod,
    sessionId: createRequestId(),
    user,
  });

  return {
    cookies: [buildSessionCookie(env, refreshToken, TRUSTED_DEVICE_TTL_SECONDS)],
    session: createClientSession({
      accessToken,
      loginMethod,
      provider: "custom",
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
    .select("id, user_id, device_fingerprint_hash, refresh_token_hash, expires_at, revoked_at, login_method, device_label, delivery_channel")
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
}: {
  deviceFingerprint?: string;
  deviceSession: TrustedDeviceRow;
  env: EnvLike;
}) => {
  const serviceClient = createServiceClient(env);
  const refreshToken = createRefreshToken();
  const { error } = await serviceClient
    .from("auth_trusted_devices")
    .update({
      device_fingerprint_hash: trimText(deviceFingerprint)
        ? sha256(trimText(deviceFingerprint))
        : deviceSession.device_fingerprint_hash,
      expires_at: new Date(Date.now() + TRUSTED_DEVICE_TTL_SECONDS * 1000).toISOString(),
      last_used_at: new Date().toISOString(),
      refresh_token_hash: sha256(refreshToken),
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

  const user = await loadAuthUserById(env, trustedSession.user_id);
  const nextRefreshToken = await rotateTrustedDeviceSession({
    deviceFingerprint: context.deviceFingerprint,
    deviceSession: trustedSession,
    env,
  });
  const accessToken = mintAccessToken({
    env,
    loginMethod: trustedSession.login_method,
    sessionId: trustedSession.id,
    user,
  });

  return {
    statusCode: 200,
    body: {
      success: true,
      message: "Session restored.",
      session: createClientSession({
        accessToken,
        loginMethod: trustedSession.login_method,
        provider: "custom",
        trustedDevice: true,
        user,
      }),
    },
    cookies: [buildSessionCookie(env, nextRefreshToken, TRUSTED_DEVICE_TTL_SECONDS)],
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
