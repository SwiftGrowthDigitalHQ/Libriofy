import { supabase } from "@/integrations/supabase/client";

export type StudentQrTokenMap = Record<string, string>;

type StudentQrTokenRecord = {
  student_id: string;
  library_id: string;
  token: string;
  exp: number;
  nonce: string;
  expires_at: string;
};

type StudentQrSigningResponseBody =
  | {
      status: "success";
      data: StudentQrTokenRecord[];
    }
  | {
      status: "error";
      message: string;
      code?: string;
    };

const STUDENT_QR_API_URL = import.meta.env.VITE_STUDENT_QR_API_URL ?? "/api/student-qr";

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const uniqueStudentIds = (studentIds: string[]) =>
  [...new Set(studentIds.map((studentId) => trimText(studentId)).filter(Boolean))];

const getAuthHeaders = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("Please sign in again to generate student QR cards.");
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
};

const parseResponseBody = async (response: Response): Promise<StudentQrSigningResponseBody> => {
  try {
    return (await response.json()) as StudentQrSigningResponseBody;
  } catch {
    return {
      status: "error",
      message: "Unable to sign QR cards.",
    };
  }
};

export const fetchSignedStudentQrTokens = async ({
  libraryId,
  studentIds,
}: {
  libraryId: string;
  studentIds: string[];
}): Promise<StudentQrTokenMap> => {
  const normalizedLibraryId = trimText(libraryId);
  const normalizedStudentIds = uniqueStudentIds(studentIds);

  if (!normalizedLibraryId) {
    throw new Error("Library ID is required to generate student QR cards.");
  }

  if (!normalizedStudentIds.length) {
    return {};
  }

  const response = await fetch(STUDENT_QR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({
      library_id: normalizedLibraryId,
      student_ids: normalizedStudentIds,
    }),
  });

  const body = await parseResponseBody(response);
  if (!response.ok || body.status !== "success") {
    throw new Error(body.status === "error" ? body.message : "Unable to sign QR cards.");
  }

  const tokenMap = Object.fromEntries(body.data.map((record) => [record.student_id, record.token]));
  const missingStudentIds = normalizedStudentIds.filter((studentId) => !tokenMap[studentId]);
  if (missingStudentIds.length > 0) {
    throw new Error("Unable to sign one or more student QR cards.");
  }

  return tokenMap;
};

export const fetchSignedStudentQrTokensSafe = async ({
  libraryId,
  studentIds,
}: {
  libraryId: string;
  studentIds: string[];
}): Promise<StudentQrTokenMap> => {
  try {
    return await fetchSignedStudentQrTokens({ libraryId, studentIds });
  } catch (error) {
    console.warn("Signed student QR tokens unavailable, falling back to legacy codes.", error);
    return {};
  }
};
