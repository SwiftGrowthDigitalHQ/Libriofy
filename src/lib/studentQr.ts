import { getPublicAppBaseUrl, isPreviewAppUrl } from "./publicAppUrl.js";

const JWT_ALG = "RS256" as const;
const WEB_CRYPTO_RSA_ALG = "RSASSA-PKCS1-v1_5" as const;
const JWT_TYP = "JWT" as const;
const STUDENT_QR_TYP = "libriofy.student_qr" as const;

export type StudentQrTokenClaims = {
  typ: typeof STUDENT_QR_TYP;
  version: 1;
  student_id: string;
  library_id: string;
  exp: number;
  iat: number;
  nonce: string;
};

export type StudentQrVerificationFailureCode = "INVALID_QR" | "EXPIRED" | "WRONG_LIBRARY";

export type StudentQrVerifiedPayload = {
  code?: undefined;
  valid: true;
  source: "signed";
  rawValue: string;
  token: string;
  claims: StudentQrTokenClaims;
  studentId: string;
  libraryId: string;
  exp: number;
  message?: undefined;
  nonce: string;
  iat: number;
};

export type StudentQrLegacyPayload = {
  code?: undefined;
  valid: true;
  source: "legacy";
  rawValue: string;
  qrCode: string;
  libraryId: string | null;
  message?: undefined;
};

export type StudentQrStructuredPayload = {
  code?: undefined;
  valid: true;
  source: "structured";
  rawValue: string;
  studentId: string;
  libraryId: string;
  message?: undefined;
};

export type StudentQrInvalidPayload = {
  valid: false;
  source: "signed" | "legacy" | "structured" | "url" | "token" | "unknown";
  rawValue: string;
  code: StudentQrVerificationFailureCode;
  message: string;
};

export type StudentQrParsedPayload =
  | StudentQrVerifiedPayload
  | StudentQrLegacyPayload
  | StudentQrStructuredPayload
  | StudentQrInvalidPayload;

export type StudentQrParseOptions = {
  expectedLibraryId?: string | null;
  allowLegacy?: boolean;
  publicKeyPem?: string | null;
  now?: Date | number | string;
};

export type StudentQrSigningClaims = Pick<StudentQrTokenClaims, "library_id" | "student_id"> & {
  exp: number;
  iat?: number;
  nonce?: string;
};

const trimText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const nowEpochSeconds = (value: Date | number | string = Date.now()) => {
  if (typeof value === "number") {
    return Math.floor(value / 1000);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(date.getTime() / 1000);
};

const getRandomBytes = (length: number) => {
  const bytes = new Uint8Array(Math.max(1, length));
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary);
};

const base64ToBytes = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const base64UrlEncode = (value: Uint8Array) =>
  bytesToBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const base64UrlDecode = (value: string) => base64ToBytes(value);

const encodeUtf8 = (value: string) => new TextEncoder().encode(value);

const decodeUtf8 = (value: Uint8Array) => new TextDecoder().decode(value);

const pemToBytes = (pem: string) => {
  const normalized = trimText(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  return base64ToBytes(normalized);
};

const looksLikeJwt = (value: string) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

const isBrowserUrl = (value: string) => {
  const trimmed = trimText(value);
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/");
};

const extractStudentRouteCandidate = (rawValue: string) => {
  const trimmed = trimText(rawValue);
  if (!trimmed) {
    return null;
  }

  const urlCandidates = isBrowserUrl(trimmed) ? [trimmed] : [trimmed, `/${trimmed}`];

  for (const candidate of urlCandidates) {
    try {
      const url = new URL(candidate, "http://student-qr.invalid");
      const match = url.pathname.match(/\/student\/([^/?#]+)/i);
      if (!match?.[1]) {
        continue;
      }

      return {
        source: "url" as const,
        token: decodeURIComponent(match[1]),
        libraryId: trimText(url.searchParams.get("library_id") ?? url.searchParams.get("libraryId")) || null,
      };
    } catch {
      // Try the next candidate.
    }
  }

  if (looksLikeJwt(trimmed)) {
    return {
      source: "token" as const,
      token: trimmed,
      libraryId: null,
    };
  }

  return null;
};

const extractLegacyStudentCandidate = (rawValue: string) => {
  const trimmed = trimText(rawValue);
  if (!trimmed) {
    return null;
  }

  const routeCandidate = extractStudentRouteCandidate(trimmed);
  if (routeCandidate && routeCandidate.source === "url" && !looksLikeJwt(routeCandidate.token)) {
    return {
      source: "legacy" as const,
      qrCode: routeCandidate.token,
      libraryId: routeCandidate.libraryId,
    };
  }

  if (looksLikeJwt(trimmed)) {
    return null;
  }

  return {
    source: "legacy" as const,
    qrCode: trimmed,
    libraryId: null,
  };
};

const extractStructuredStudentCandidate = (rawValue: string) => {
  const trimmed = trimText(rawValue);
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const studentId = trimText(parsed.studentId ?? parsed.student_id);
    const libraryId = trimText(parsed.libraryId ?? parsed.library_id);

    if (!studentId || !libraryId) {
      return null;
    }

    return {
      source: "structured" as const,
      studentId,
      libraryId,
    };
  } catch {
    return null;
  }
};

const getImportedPublicKey = (() => {
  const cache = new Map<string, Promise<CryptoKey>>();

  return (publicKeyPem: string) => {
    const normalized = trimText(publicKeyPem);
    if (!normalized) {
      return Promise.reject(new Error("ID verification key is not configured."));
    }

    const cached = cache.get(normalized);
    if (cached) {
      return cached;
    }

    const promise = globalThis.crypto.subtle.importKey(
      "spki",
      pemToBytes(normalized).buffer,
      { name: WEB_CRYPTO_RSA_ALG, hash: "SHA-256" },
      false,
      ["verify"],
    );

    cache.set(normalized, promise);
    return promise;
  };
})();

const getImportedPrivateKey = (() => {
  const cache = new Map<string, Promise<CryptoKey>>();

  return (privateKeyPem: string) => {
    const normalized = trimText(privateKeyPem);
    if (!normalized) {
      return Promise.reject(new Error("Student ID signing key is not configured."));
    }

    const cached = cache.get(normalized);
    if (cached) {
      return cached;
    }

    const promise = globalThis.crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(normalized).buffer,
      { name: WEB_CRYPTO_RSA_ALG, hash: "SHA-256" },
      false,
      ["sign"],
    );

    cache.set(normalized, promise);
    return promise;
  };
})();

const normalizeClaims = (claims: Partial<StudentQrSigningClaims> & { exp: number }) => {
  const studentId = trimText(claims.student_id);
  const libraryId = trimText(claims.library_id);
  const exp = Number.isFinite(claims.exp) ? Math.floor(claims.exp) : 0;

  if (!studentId || !libraryId || !exp) {
    throw new Error("Student ID details are incomplete.");
  }

  const iat = typeof claims.iat === "number" && Number.isFinite(claims.iat) ? Math.floor(claims.iat) : nowEpochSeconds();
  const nonce = trimText(claims.nonce) || base64UrlEncode(getRandomBytes(16));

  return {
    typ: STUDENT_QR_TYP,
    version: 1 as const,
    student_id: studentId,
    library_id: libraryId,
    exp,
    iat,
    nonce,
  } satisfies StudentQrTokenClaims;
};

const parseClaims = (value: unknown): StudentQrTokenClaims | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const typ = trimText(record.typ);
  const version = Number(record.version);
  const studentId = trimText(record.student_id);
  const libraryId = trimText(record.library_id);
  const exp = Number(record.exp);
  const iat = Number(record.iat);
  const nonce = trimText(record.nonce);

  if (typ !== STUDENT_QR_TYP || version !== 1 || !studentId || !libraryId || !nonce) {
    return null;
  }

  if (!Number.isFinite(exp) || !Number.isFinite(iat)) {
    return null;
  }

  return {
    typ: STUDENT_QR_TYP,
    version: 1,
    student_id: studentId,
    library_id: libraryId,
    exp: Math.floor(exp),
    iat: Math.floor(iat),
    nonce,
  };
};

const buildInvalidResult = (
  rawValue: string,
  source: StudentQrInvalidPayload["source"],
  code: StudentQrVerificationFailureCode,
  message: string,
): StudentQrInvalidPayload => ({
  valid: false,
  rawValue,
  source,
  code,
  message,
});

export const buildStudentQrRouteValue = ({
  origin,
  signedToken,
  studentId,
  libraryId,
  qrCode,
  compactSignedToken = true,
}: {
  origin?: string;
  signedToken?: string | null;
  studentId?: string | null;
  libraryId?: string | null;
  qrCode?: string | null;
  compactSignedToken?: boolean;
}) => {
  const requestedOrigin = trimText(origin);
  const normalizedOrigin =
    requestedOrigin && !isPreviewAppUrl(requestedOrigin)
      ? requestedOrigin
      : getPublicAppBaseUrl();
  const token = trimText(signedToken);
  const studentIdentifier = trimText(studentId);
  const legacyCode = trimText(qrCode);
  const normalizedLibraryId = trimText(libraryId);

  if (token) {
    if (compactSignedToken) {
      return token;
    }

    if (!normalizedOrigin) {
      return token;
    }

    const url = new URL(`/student/${encodeURIComponent(token)}`, normalizedOrigin);
    if (normalizedLibraryId) {
      url.searchParams.set("library_id", normalizedLibraryId);
    }

    return url.toString();
  }

  const fallbackValue = legacyCode || studentIdentifier;
  if (!normalizedOrigin || !fallbackValue) {
    return fallbackValue;
  }

  const url = new URL(`/student/${encodeURIComponent(fallbackValue)}`, normalizedOrigin);
  if (normalizedLibraryId) {
    url.searchParams.set("library_id", normalizedLibraryId);
  }

  return url.toString();
};

export const createStudentQrClaims = ({
  studentId,
  libraryId,
  expiresAt,
  issuedAt,
  nonce,
}: {
  studentId: string;
  libraryId: string;
  expiresAt: Date | number | string;
  issuedAt?: Date | number | string;
  nonce?: string;
}): StudentQrTokenClaims => {
  const exp = nowEpochSeconds(expiresAt);
  const iat = issuedAt ? nowEpochSeconds(issuedAt) : nowEpochSeconds();

  return normalizeClaims({
    student_id: studentId,
    library_id: libraryId,
    exp,
    iat,
    nonce,
  });
};

export const signStudentQrToken = async (
  claims: StudentQrSigningClaims,
  privateKeyPem: string,
): Promise<string> => {
  const normalizedClaims = normalizeClaims(claims);
  const header = {
    alg: JWT_ALG,
    typ: JWT_TYP,
  };

  const headerSegment = base64UrlEncode(encodeUtf8(JSON.stringify(header)));
  const payloadSegment = base64UrlEncode(encodeUtf8(JSON.stringify(normalizedClaims)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const privateKey = await getImportedPrivateKey(privateKeyPem);
  const signature = await globalThis.crypto.subtle.sign(
    WEB_CRYPTO_RSA_ALG,
    privateKey,
    encodeUtf8(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
};

export const verifyStudentQrToken = async (
  token: string,
  publicKeyPem: string,
  {
    expectedLibraryId,
    now,
  }: {
    expectedLibraryId?: string | null;
    now?: Date | number | string;
  } = {},
): Promise<StudentQrVerifiedPayload | StudentQrInvalidPayload> => {
  const trimmedToken = trimText(token);
  if (!trimmedToken || !looksLikeJwt(trimmedToken)) {
    return buildInvalidResult(trimmedToken || token, "unknown", "INVALID_QR", "Invalid ID");
  }

  const segments = trimmedToken.split(".");
  if (segments.length !== 3) {
    return buildInvalidResult(trimmedToken, "signed", "INVALID_QR", "Invalid ID");
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  let header: Record<string, unknown> | null = null;
  let claims: StudentQrTokenClaims | null = null;

  try {
    header = JSON.parse(decodeUtf8(base64UrlDecode(headerSegment))) as Record<string, unknown>;
    claims = parseClaims(JSON.parse(decodeUtf8(base64UrlDecode(payloadSegment))));
  } catch {
    return buildInvalidResult(trimmedToken, "signed", "INVALID_QR", "Invalid ID");
  }

  if (!header || trimText(header.alg) !== JWT_ALG || trimText(header.typ) !== JWT_TYP || !claims) {
    return buildInvalidResult(trimmedToken, "signed", "INVALID_QR", "Invalid ID");
  }

  try {
    const publicKey = await getImportedPublicKey(publicKeyPem);
    const verified = await globalThis.crypto.subtle.verify(
      WEB_CRYPTO_RSA_ALG,
      publicKey,
      base64UrlDecode(signatureSegment),
      encodeUtf8(`${headerSegment}.${payloadSegment}`),
    );

    if (!verified) {
      return buildInvalidResult(trimmedToken, "signed", "INVALID_QR", "Invalid ID");
    }
  } catch {
    return buildInvalidResult(trimmedToken, "signed", "INVALID_QR", "Invalid ID");
  }

  const nowSeconds = nowEpochSeconds(now ?? Date.now());
  if (claims.exp <= nowSeconds) {
    return buildInvalidResult(trimmedToken, "signed", "EXPIRED", "Expired");
  }

  const expectedLibrary = trimText(expectedLibraryId);
  if (expectedLibrary && claims.library_id !== expectedLibrary) {
    return buildInvalidResult(trimmedToken, "signed", "WRONG_LIBRARY", "Wrong Library");
  }

  return {
    valid: true,
    source: "signed",
    rawValue: trimmedToken,
    token: trimmedToken,
    claims,
    studentId: claims.student_id,
    libraryId: claims.library_id,
    exp: claims.exp,
    nonce: claims.nonce,
    iat: claims.iat,
  };
};

export const parseStudentQrPayload = async (
  rawValue: string,
  options: StudentQrParseOptions = {},
): Promise<StudentQrParsedPayload | null> => {
  const trimmed = trimText(rawValue);
  if (!trimmed) {
    return null;
  }

  const candidate = extractStudentRouteCandidate(trimmed);
  const structuredCandidate = extractStructuredStudentCandidate(trimmed);
  const expectedLibraryId = trimText(options.expectedLibraryId);
  const allowLegacy = options.allowLegacy ?? false;

  if (structuredCandidate) {
    if (expectedLibraryId && structuredCandidate.libraryId !== expectedLibraryId) {
      return buildInvalidResult(trimmed, structuredCandidate.source, "WRONG_LIBRARY", "Wrong Library");
    }

    return {
      valid: true,
      source: "structured",
      rawValue: trimmed,
      studentId: structuredCandidate.studentId,
      libraryId: structuredCandidate.libraryId,
    };
  }

  if (candidate) {
    if (looksLikeJwt(candidate.token)) {
      if (!trimText(options.publicKeyPem)) {
        return buildInvalidResult(trimmed, candidate.source, "INVALID_QR", "ID verification key is not configured.");
      }

      const verified = await verifyStudentQrToken(candidate.token, options.publicKeyPem ?? "", {
        expectedLibraryId: expectedLibraryId || candidate.libraryId || null,
        now: options.now,
      });

      if (verified.valid === true) {
        const verifiedPayload: StudentQrVerifiedPayload = {
          ...verified,
          rawValue: trimmed,
        };
        return verifiedPayload;
      }

      const invalidPayload: StudentQrInvalidPayload = {
        ...verified,
        rawValue: trimmed,
        source: candidate.source,
      };
      return invalidPayload;
    }

    if (allowLegacy) {
      const legacyLibraryId = candidate.libraryId || null;
      if (expectedLibraryId && legacyLibraryId && legacyLibraryId !== expectedLibraryId) {
        return buildInvalidResult(trimmed, candidate.source, "WRONG_LIBRARY", "Wrong Library");
      }

      return {
        valid: true,
        source: "legacy",
        rawValue: trimmed,
        qrCode: candidate.token,
        libraryId: legacyLibraryId,
      };
    }

    return buildInvalidResult(trimmed, candidate.source, "INVALID_QR", "Invalid ID");
  }

  const legacyCandidate = extractLegacyStudentCandidate(trimmed);
  if (legacyCandidate && allowLegacy) {
    if (expectedLibraryId && legacyCandidate.libraryId && legacyCandidate.libraryId !== expectedLibraryId) {
      return buildInvalidResult(trimmed, "legacy", "WRONG_LIBRARY", "Wrong Library");
    }

    return {
      valid: true,
      source: "legacy",
      rawValue: trimmed,
      qrCode: legacyCandidate.qrCode,
      libraryId: legacyCandidate.libraryId,
    };
  }

  return buildInvalidResult(trimmed, legacyCandidate?.source ?? "unknown", "INVALID_QR", "Invalid ID");
};
