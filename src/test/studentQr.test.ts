import { describe, expect, it } from "vitest";

import { parseStudentQrPayload } from "@/lib/studentQr";

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
});
