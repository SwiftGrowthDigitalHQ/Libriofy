import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  createStudentQrClaims,
  inspectStudentQrPayload,
  parseStudentQrPayload,
  signStudentQrToken,
  shouldUseSignedStudentQrToken,
} from "@/lib/studentQr";

const createPemKeyPair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
};

describe("parseStudentQrPayload", () => {
  it("accepts the new structured JSON QR format", async () => {
    const payload = await parseStudentQrPayload(
      JSON.stringify({
        studentId: "LIB123",
        libraryId: "LIB001",
      }),
      {
        expectedLibraryId: "LIB001",
      },
    );

    expect(payload).toEqual({
      valid: true,
      source: "structured",
      rawValue: "{\"studentId\":\"LIB123\",\"libraryId\":\"LIB001\"}",
      studentId: "LIB123",
      libraryId: "LIB001",
    });
  });

  it("rejects a structured QR for the wrong library", async () => {
    const payload = await parseStudentQrPayload(
      JSON.stringify({
        studentId: "LIB123",
        libraryId: "LIB002",
      }),
      {
        expectedLibraryId: "LIB001",
      },
    );

    expect(payload).toMatchObject({
      valid: false,
      code: "WRONG_LIBRARY",
      message: "Wrong Library",
      source: "structured",
    });
  });

  it("round-trips a signed student QR token with RS256 verification", async () => {
    const { privateKeyPem, publicKeyPem } = createPemKeyPair();
    const claims = createStudentQrClaims({
      expiresAt: "2030-01-01T00:00:00.000Z",
      issuedAt: "2029-12-31T00:00:00.000Z",
      libraryId: "library-123",
      studentId: "student-456",
    });
    const token = await signStudentQrToken(claims, privateKeyPem);

    const inspection = inspectStudentQrPayload(token);
    const parsed = await parseStudentQrPayload(token, {
      expectedLibraryId: "library-123",
      now: "2029-12-31T12:00:00.000Z",
      publicKeyPem,
    });

    expect(inspection.inputKind).toBe("jwt");
    expect(inspection.claims).toMatchObject({
      library_id: "library-123",
      student_id: "student-456",
      typ: "libriofy.student_qr",
      version: 1,
    });
    expect(parsed).toMatchObject({
      valid: true,
      source: "signed",
      libraryId: "library-123",
      studentId: "student-456",
    });
  });

  it("returns SIGNATURE_INVALID when the verification key does not match", async () => {
    const signer = createPemKeyPair();
    const verifier = createPemKeyPair();
    const claims = createStudentQrClaims({
      expiresAt: "2030-01-01T00:00:00.000Z",
      libraryId: "library-123",
      studentId: "student-456",
    });
    const token = await signStudentQrToken(claims, signer.privateKeyPem);

    const parsed = await parseStudentQrPayload(token, {
      expectedLibraryId: "library-123",
      now: "2029-01-01T00:00:00.000Z",
      publicKeyPem: verifier.publicKeyPem,
    });

    expect(parsed).toMatchObject({
      valid: false,
      code: "SIGNATURE_INVALID",
      message: "QR signature invalid",
      source: "token",
    });
  });

  it("allows expired signed QR tokens when expiry is intentionally ignored", async () => {
    const { privateKeyPem, publicKeyPem } = createPemKeyPair();
    const claims = createStudentQrClaims({
      expiresAt: "2029-01-01T00:00:00.000Z",
      libraryId: "library-123",
      studentId: "student-456",
    });
    const token = await signStudentQrToken(claims, privateKeyPem);

    const strictParsed = await parseStudentQrPayload(token, {
      expectedLibraryId: "library-123",
      now: "2030-01-01T00:00:00.000Z",
      publicKeyPem,
    });

    const relaxedParsed = await parseStudentQrPayload(token, {
      allowExpired: true,
      expectedLibraryId: "library-123",
      now: "2030-01-01T00:00:00.000Z",
      publicKeyPem,
    });

    expect(strictParsed).toMatchObject({
      valid: false,
      code: "EXPIRED",
      source: "token",
    });
    expect(relaxedParsed).toMatchObject({
      valid: true,
      source: "signed",
      libraryId: "library-123",
      studentId: "student-456",
    });
  });

  it("prefers signed student QR tokens for memberships that are currently valid", () => {
    expect(
      shouldUseSignedStudentQrToken({
        expiry_date: "2026-06-10",
        status: "active",
      }, new Date("2026-06-02T00:00:00.000Z")),
    ).toBe(true);

    expect(
      shouldUseSignedStudentQrToken({
        expiry_date: "2026-05-26",
        status: "active",
      }, new Date("2026-06-02T00:00:00.000Z")),
    ).toBe(false);

    expect(
      shouldUseSignedStudentQrToken({
        expiry_date: "2026-06-10",
        status: "expired",
      }, new Date("2026-06-02T00:00:00.000Z")),
    ).toBe(true);

    expect(
      shouldUseSignedStudentQrToken({
        expiry_date: "2026-06-10",
        status: "inactive",
      }, new Date("2026-06-02T00:00:00.000Z")),
    ).toBe(false);
  });
});
