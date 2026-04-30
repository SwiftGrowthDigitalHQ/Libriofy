import { createClient } from "@supabase/supabase-js";
import {
  createStudentQrClaims,
  signStudentQrToken,
} from "./studentQr.js";
import { resolveRequestAuthUser } from "./requestAuth.server.js";

type EnvLike = Record<string, string | undefined>;

type StudentRow = {
  id: string;
  library_id: string;
  expiry_date: string | null;
  status: string | null;
};

type UserRoleRow = {
  role: string;
  library_id: string | null;
};

type StudentQrSigningRequestItem = {
  student_id?: unknown;
  studentId?: unknown;
  id?: unknown;
};

type StudentQrSigningRequestBody = Record<string, unknown> & {
  students?: unknown;
  student_ids?: unknown;
  studentIds?: unknown;
  student_id?: unknown;
  studentId?: unknown;
  library_id?: unknown;
  libraryId?: unknown;
};

type StudentQrSigningHeaders = {
  authorization?: string;
};

export type StudentQrSigningResponseItem = {
  student_id: string;
  library_id: string;
  token: string;
  exp: number;
  nonce: string;
  expires_at: string;
};

export type StudentQrSigningServiceResponse = {
  statusCode: number;
  body:
    | {
        status: "success";
        data: StudentQrSigningResponseItem[];
      }
    | {
        status: "error";
        message: string;
        code?: string;
      };
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const buildError = (message: string, statusCode: number, code?: string): StudentQrSigningServiceResponse => ({
  statusCode,
  body: {
    status: "error",
    message,
    ...(code ? { code } : {}),
  },
});

const readStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => trimText(item))
    .filter((item) => Boolean(item));
};

const readStudentIds = (body: StudentQrSigningRequestBody) => {
  const collected = new Set<string>();

  const add = (value: unknown) => {
    const normalized = trimText(value);
    if (normalized) {
      collected.add(normalized);
    }
  };

  const addItem = (item: StudentQrSigningRequestItem | string | null | undefined) => {
    if (!item) {
      return;
    }

    if (typeof item === "string") {
      add(item);
      return;
    }

    if (typeof item === "object") {
      add(item.student_id ?? item.studentId ?? item.id);
    }
  };

  add(body.student_id);
  add(body.studentId);

  for (const item of readStringArray(body.student_ids)) {
    add(item);
  }

  for (const item of readStringArray(body.studentIds)) {
    add(item);
  }

  if (Array.isArray(body.students)) {
    for (const item of body.students) {
      addItem(item as StudentQrSigningRequestItem | string | null | undefined);
    }
  }

  return [...collected];
};

const resolveExpiry = (expiryDate: string | null, now: Date) => {
  const fallback = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const normalized = trimText(expiryDate);

  if (!normalized) {
    return fallback;
  }

  const candidate = new Date(`${normalized}T23:59:59.999Z`);
  if (Number.isNaN(candidate.getTime())) {
    return fallback;
  }

  return candidate;
};

const parseBearerToken = (value: string | undefined) => {
  const normalized = trimText(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/^Bearer\s+/i, "").trim();
};

const canAccessLibrary = ({
  isSuperAdmin,
  roles,
  libraryId,
  ownerId,
  userId,
}: {
  isSuperAdmin: boolean;
  roles: UserRoleRow[];
  libraryId: string;
  ownerId: string | null;
  userId: string;
}) => {
  if (isSuperAdmin) {
    return true;
  }

  if (ownerId === userId) {
    return true;
  }

  return roles.some((role) => role.library_id === libraryId);
};

export const resolveStudentQrSigningRequest = async (
  env: EnvLike,
  requestBody: unknown,
  headers: StudentQrSigningHeaders = {},
): Promise<StudentQrSigningServiceResponse> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as StudentQrSigningRequestBody)
      : {};

  const requestedLibraryId = trimText(body.library_id ?? body.libraryId);
  const studentIds = readStudentIds(body);

  if (!requestedLibraryId) {
    return buildError("library_id is required.", 400, "INVALID_LIBRARY");
  }

  if (!studentIds.length) {
    return buildError("At least one student_id is required.", 400, "INVALID_REQUEST");
  }

  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");
  const privateKey = readEnv(env, "STUDENT_QR_PRIVATE_KEY", "QR_SIGNING_PRIVATE_KEY", "VITE_QR_PRIVATE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return buildError("Supabase environment is not configured.", 500, "CONFIG_ERROR");
  }

  if (!privateKey) {
    return buildError("QR signing key is not configured.", 500, "CONFIG_ERROR");
  }

  const authToken = parseBearerToken(headers.authorization);
  if (!authToken) {
    return buildError("Missing authorization header", 401, "UNAUTHORIZED");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const authUser = await resolveRequestAuthUser(env, `Bearer ${authToken}`);
  if (!authUser) {
    return buildError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { data: roles, error: rolesError } = await serviceClient
    .from("user_roles")
    .select("role, library_id")
    .eq("user_id", authUser.id);

  if (rolesError) {
    throw rolesError;
  }

  const normalizedRoles = (roles ?? []) as UserRoleRow[];
  const isSuperAdmin = normalizedRoles.some((role) => role.role === "super_admin");

  const { data: libraryRow, error: libraryError } = await serviceClient
    .from("libraries")
    .select("id, owner_id")
    .eq("id", requestedLibraryId)
    .maybeSingle();

  if (libraryError) {
    throw libraryError;
  }

  if (!libraryRow) {
    return buildError("Library not found.", 404, "LIBRARY_NOT_FOUND");
  }

  if (!canAccessLibrary({
    isSuperAdmin,
    roles: normalizedRoles,
    libraryId: requestedLibraryId,
    ownerId: libraryRow.owner_id,
    userId: authUser.id,
  })) {
    return buildError("You do not have access to this library.", 403, "FORBIDDEN");
  }

  const { data: students, error: studentsError } = await serviceClient
    .from("students")
    .select("id, library_id, expiry_date, status")
    .eq("library_id", requestedLibraryId)
    .in("id", studentIds);

  if (studentsError) {
    throw studentsError;
  }

  const studentRows = (students ?? []) as StudentRow[];
  if (studentRows.length !== studentIds.length) {
    return buildError("One or more students could not be found.", 404, "STUDENT_NOT_FOUND");
  }

  const now = new Date();
  const signingClaims = studentRows.map((student) =>
    createStudentQrClaims({
      studentId: student.id,
      libraryId: student.library_id,
      expiresAt: resolveExpiry(student.expiry_date, now),
      issuedAt: now,
    }),
  );

  const signedTokens = await Promise.all(
    signingClaims.map(async (claims) => ({
      student_id: claims.student_id,
      library_id: claims.library_id,
      token: await signStudentQrToken(claims, privateKey),
      exp: claims.exp,
      nonce: claims.nonce,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    })),
  );

  return {
    statusCode: 200,
    body: {
      status: "success",
      data: signedTokens,
    },
  };
};
