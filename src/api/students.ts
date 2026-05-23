import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { getStoredAccessToken } from "@/lib/authSession";
import { buildBearerAuthorizationHeader, sanitizeHeaders } from "@/lib/httpHeaders";
import { normalizeStudentGender, type StudentGender, type StudentGenderFilter } from "@/lib/studentGender";
import { createPlanPriceLookup, derivePaymentSummary, getDefaultPaymentDueDate, groupPaymentsByStudent } from "@/lib/paymentRecovery";

export const STUDENT_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_STUDENT_ROWS_PER_PAGE = 25;

export type StudentPaymentStatus = "Paid" | "Unpaid" | "Overdue";
export type StudentPaymentStatusFilter = "all" | StudentPaymentStatus;

export type StudentListItem = {
  aadhaarPhotoPath: string | null;
  amountDue: number | null;
  amountPaid: number | null;
  dueDate: string | null;
  gender: StudentGender | null;
  id: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  plan: string | null;
  seatId: string | null;
  seatNo: string | null;
  startDate: string | null;
  status: StudentPaymentStatus;
  whatsappNumber: string | null;
};

export type StudentsSummary = {
  overdueStudents: number;
  paidStudents: number;
  pendingAmount: number;
  totalRevenue: number;
  unpaidStudents: number;
};

export type StudentsListResponse = {
  data: StudentListItem[];
  page: number;
  summary?: StudentsSummary;
  total: number;
  totalPages: number;
};

export type StudentsListParams = {
  gender: StudentGenderFilter;
  libraryId?: string | null;
  limit: number;
  page: number;
  paymentStatus: StudentPaymentStatusFilter;
  search: string;
  seatNumber: string;
};

export type StudentEditPayload = {
  aadhaarNumber: string | null;
  address: string | null;
  dueDate: string | null;
  gender: StudentGender | null;
  name: string;
  notes: string | null;
  paymentStatus: StudentPaymentStatus;
  phone: string;
  planName: string | null;
  seatNumber: string | null;
};

export type StudentEditResponse = {
  message: string;
  student: {
    aadhaarNumber: string | null;
    address: string | null;
    amountDue: number;
    amountPaid: number;
    dueDate: string | null;
    gender: StudentGender | null;
    id: string;
    name: string;
    notes: string | null;
    phone: string | null;
    plan: string | null;
    seatNo: string | null;
    status: StudentPaymentStatus;
  };
  success: true;
};

const STUDENTS_LIST_PATH = "/students";
const configuredStudentsApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
const isLocalStudentsDashboardHost =
  typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);

type FallbackStudentRowBase = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "aadhaar_photo_path" | "expiry_date" | "full_name" | "id" | "phone" | "plan" | "plan_id" | "seat_id" | "seat_number" | "start_date" | "status"
>;
type FallbackStudentRow = FallbackStudentRowBase & {
  gender?: StudentGender | null;
  photo_thumbnail_path?: string | null;
  photo_version?: number | null;
  photo_url?: string | null;
};
type FallbackPaymentRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "amount" | "created_at" | "id" | "payment_method" | "period_end" | "period_start" | "plan" | "source" | "status" | "student_id"
>;
type FallbackPlanRow = Pick<Database["public"]["Tables"]["plans"]["Row"], "id" | "name" | "price">;
type StudentHttpSupplementRow = {
  aadhaar_photo_path?: string | null;
  gender?: StudentGender | null;
  id: string;
  photo_thumbnail_path?: string | null;
  photo_version?: number | null;
  photo_url?: string | null;
};
type StudentSchemaCapabilities = {
  aadhaarDocuments: boolean;
  gender: boolean;
  photoAssets: boolean;
};

const STUDENT_SCHEMA_ATTEMPTS: StudentSchemaCapabilities[] = [
  { aadhaarDocuments: true, gender: true, photoAssets: true },
  { aadhaarDocuments: false, gender: true, photoAssets: true },
  { aadhaarDocuments: true, gender: true, photoAssets: false },
  { aadhaarDocuments: false, gender: true, photoAssets: false },
  { aadhaarDocuments: true, gender: false, photoAssets: true },
  { aadhaarDocuments: false, gender: false, photoAssets: true },
  { aadhaarDocuments: true, gender: false, photoAssets: false },
  { aadhaarDocuments: false, gender: false, photoAssets: false },
];

class HttpRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
  }
}

let shouldBypassStudentsHttpRoute = !configuredStudentsApiBaseUrl && isLocalStudentsDashboardHost;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const getStudentPhotoPublicUrl = (path: string, version?: number | null) => {
  const { data } = supabase.storage.from("student-photos").getPublicUrl(path);
  return version ? `${data.publicUrl}?v=${version}` : data.publicUrl;
};

const resolveStudentPhotoUrl = ({
  photoThumbnailPath,
  photoUrl,
  photoVersion,
}: {
  photoThumbnailPath?: string | null;
  photoUrl?: string | null;
  photoVersion?: number | null;
}) => {
  const thumbnailPath = toNullableString(photoThumbnailPath);
  if (thumbnailPath) {
    return getStudentPhotoPublicUrl(thumbnailPath, toNumber(photoVersion, 0) || undefined);
  }

  return toNullableString(photoUrl);
};

const isSchemaShapeError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /could not find the '.*' column|column .* does not exist|schema cache/i.test(String(error?.message ?? ""));

const normalizePaymentStatus = (value: unknown): StudentPaymentStatus => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "paid") return "Paid";
  if (normalized === "overdue") return "Overdue";
  return "Unpaid";
};

const normalizeStudent = (value: unknown): StudentListItem => {
  const record = toRecord(value) ?? {};

  return {
    aadhaarPhotoPath: toNullableString(record.aadhaarPhotoPath ?? record.aadhaar_photo_path),
    amountDue: toNumber(record.amountDue ?? record.amount_due ?? record.pendingAmount ?? record.pending_amount, 0),
    amountPaid: toNumber(record.amountPaid ?? record.amount_paid ?? record.totalPaid ?? record.total_paid, 0),
    dueDate: toNullableString(record.dueDate ?? record.due_date ?? record.payment_due_date ?? record.paymentDueDate),
    gender: normalizeStudentGender(record.gender),
    id: String(record.id ?? record.studentId ?? record.student_id ?? ""),
    name: String(record.name ?? record.full_name ?? record.fullName ?? "Unknown student"),
    phone: toNullableString(record.phone ?? record.phone_number ?? record.phoneNumber),
    photoUrl: resolveStudentPhotoUrl({
      photoThumbnailPath: toNullableString(record.photoThumbnailPath ?? record.photo_thumbnail_path),
      photoUrl: toNullableString(record.photoUrl ?? record.photo_url),
      photoVersion: toNumber(record.photoVersion ?? record.photo_version, 0) || null,
    }),
    plan: toNullableString(record.plan ?? record.plan_name ?? record.planName),
    seatId: toNullableString(record.seatId ?? record.seat_id),
    seatNo: toNullableString(record.seatNo ?? record.seat_no ?? record.seat_number ?? record.seatNumber),
    startDate: toNullableString(record.startDate ?? record.start_date),
    status: normalizePaymentStatus(record.status ?? record.paymentStatus ?? record.payment_status),
    whatsappNumber: toNullableString(record.whatsappNumber ?? record.whatsapp_number ?? record.phone ?? record.phone_number),
  };
};

const normalizeSummary = (value: unknown): StudentsSummary | undefined => {
  const record = toRecord(value);
  if (!record) return undefined;

  return {
    overdueStudents: toNumber(record.overdueStudents ?? record.overdue_students, 0),
    paidStudents: toNumber(record.paidStudents ?? record.paid_students, 0),
    pendingAmount: toNumber(record.pendingAmount ?? record.pending_amount, 0),
    totalRevenue: toNumber(record.totalRevenue ?? record.total_revenue, 0),
    unpaidStudents: toNumber(record.unpaidStudents ?? record.unpaid_students, 0),
  };
};

const extractErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json();
    const record = toRecord(payload);
    if (record?.message && typeof record.message === "string") return record.message;
    if (record?.error && typeof record.error === "string") return record.error;
  } catch {
    // Ignore JSON parsing failures and fall back to the status text.
  }

  return response.statusText || "Request failed";
};

const resolveBaseUrl = () => {
  if (configuredStudentsApiBaseUrl) return configuredStudentsApiBaseUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost";
};

const createStudentsUrl = (path: string, params?: Record<string, string | number | null | undefined>) => {
  const url = new URL(path, resolveBaseUrl());

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
};

const getStudentsAuthHeaders = async () =>
  sanitizeHeaders(
    {
      Authorization: buildBearerAuthorizationHeader(
        await getStoredAccessToken(),
        "Please sign in again to edit this student.",
      ),
    },
    {
      allowedHeaders: ["Authorization"],
    },
  );

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new HttpRequestError(response.status, await extractErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const escapeIlikeValue = (value: string) => value.replace(/[%_]/g, (character) => `\\${character}`);

const getDerivedStatus = (amountDue: number, overdueDays: number): StudentPaymentStatus => {
  if (amountDue <= 0) return "Paid";
  if (overdueDays > 0) return "Overdue";
  return "Unpaid";
};

type StudentFilterQuery<T> = {
  eq: (column: string, value: string) => T;
  ilike: (column: string, pattern: string) => T;
  or: (filters: string) => T;
};

const applyStudentBaseFilters = <T extends StudentFilterQuery<T>>(
  query: T,
  params: StudentsListParams,
  capabilities: StudentSchemaCapabilities = { aadhaarDocuments: true, gender: true, photoAssets: true },
) => {
  let nextQuery = query.eq("library_id", params.libraryId ?? "");

  const search = params.search.trim();
  if (search) {
    const pattern = `%${escapeIlikeValue(search)}%`;
    nextQuery = nextQuery.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`);
  }

  const seatNumber = params.seatNumber.trim();
  if (seatNumber) {
    nextQuery = nextQuery.ilike("seat_number", `%${escapeIlikeValue(seatNumber)}%`);
  }

  if (params.gender !== "all" && capabilities.gender) {
    nextQuery = nextQuery.eq("gender", params.gender);
  }

  return nextQuery;
};

const createStudentSelectClause = (capabilities: StudentSchemaCapabilities) =>
  [
    "id",
    capabilities.aadhaarDocuments ? "aadhaar_photo_path" : null,
    "expiry_date",
    "full_name",
    capabilities.gender ? "gender" : null,
    "phone",
    capabilities.photoAssets ? "photo_thumbnail_path" : null,
    capabilities.photoAssets ? "photo_version" : null,
    capabilities.photoAssets ? "photo_url" : null,
    "plan",
    "plan_id",
    "seat_id",
    "seat_number",
    "start_date",
    "status",
  ]
    .filter(Boolean)
    .join(", ");

const fetchStudentRowsWithSchemaFallback = async (params: StudentsListParams) => {
  let lastSchemaError: unknown = null;

  for (const capabilities of STUDENT_SCHEMA_ATTEMPTS) {
    const query = applyStudentBaseFilters(
      supabase
        .from("students")
        .select(createStudentSelectClause(capabilities), {
          count: "exact",
        })
        .order("full_name", { ascending: true }) as unknown as StudentFilterQuery<any>,
      params,
      capabilities,
    );
    const { data, error, count } = await query;

    if (!error) {
      return {
        capabilities,
        count: count ?? 0,
        rows: (data ?? []) as unknown as FallbackStudentRow[],
      };
    }

    if (!isSchemaShapeError(error)) {
      throw error;
    }

    lastSchemaError = error;
  }

  throw lastSchemaError ?? new Error("Unable to load students.");
};

const fetchStudentsPageFromSupabase = async (params: StudentsListParams): Promise<StudentsListResponse> => {
  if (!params.libraryId) {
    return {
      data: [],
      page: 1,
      summary: buildStudentsSummaryFromPage([]),
      total: 0,
      totalPages: 1,
    };
  }

  const [{ capabilities, rows: studentRows }, { data: planRows, error: planError }, { data: paymentRows, error: paymentError }] =
    await Promise.all([
      fetchStudentRowsWithSchemaFallback(params),
      supabase.from("plans").select("id, name, price").eq("library_id", params.libraryId).order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("amount, created_at, id, payment_method, period_end, period_start, plan, source, status, student_id")
        .eq("library_id", params.libraryId)
        .order("created_at", { ascending: false }),
    ]);

  if (planError) throw planError;
  if (paymentError) throw paymentError;

  const students = studentRows;
  const plans = (planRows ?? []) as FallbackPlanRow[];
  const payments = (paymentRows ?? []) as FallbackPaymentRow[];
  const paymentsByStudent = groupPaymentsByStudent(payments);
  const planLookup = createPlanPriceLookup(plans);

  const derivedStudents = students.map((student) => {
    const summary = derivePaymentSummary({
      planLookup,
      student,
      studentPayments: paymentsByStudent.get(student.id) ?? [],
    });

    return {
      aadhaarPhotoPath: capabilities.aadhaarDocuments ? student.aadhaar_photo_path ?? null : null,
      amountDue: summary.amountDue,
      amountPaid: summary.amountPaid,
      dueDate: summary.dueDate,
      gender: student.gender,
      id: student.id,
      name: student.full_name,
      phone: student.phone,
      photoUrl: resolveStudentPhotoUrl({
        photoThumbnailPath: capabilities.photoAssets ? student.photo_thumbnail_path ?? null : null,
        photoUrl: capabilities.photoAssets ? student.photo_url ?? null : null,
        photoVersion: capabilities.photoAssets ? student.photo_version ?? null : null,
      }),
      plan: summary.planName,
      seatId: student.seat_id,
      seatNo: student.seat_number,
      startDate: student.start_date,
      status: getDerivedStatus(summary.amountDue, summary.overdueDays),
      whatsappNumber: student.phone,
    } satisfies StudentListItem;
  });

  const genderFilteredStudents =
    params.gender === "all" ? derivedStudents : derivedStudents.filter((student) => capabilities.gender && student.gender === params.gender);

  const filteredStudents =
    params.paymentStatus === "all"
      ? genderFilteredStudents
      : genderFilteredStudents.filter((student) => student.status === params.paymentStatus);

  const summary = buildStudentsSummaryFromPage(filteredStudents);
  const total = filteredStudents.length;
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  const page = Math.min(Math.max(params.page, 1), totalPages);
  const startIndex = (page - 1) * params.limit;
  const data = filteredStudents.slice(startIndex, startIndex + params.limit);

  return {
    data,
    page,
    summary,
    total,
    totalPages,
  };
};

const shouldFallbackToSupabase = (error: unknown) =>
  error instanceof HttpRequestError
    ? error.status === 404
    : error instanceof SyntaxError || error instanceof TypeError || isSchemaShapeError(error as { code?: string; message?: string });

const fetchStudentSupplementsWithFallback = async (studentIds: string[]) => {
  for (const capabilities of STUDENT_SCHEMA_ATTEMPTS) {
    const selectClause = [
      "id",
      capabilities.aadhaarDocuments ? "aadhaar_photo_path" : null,
      capabilities.gender ? "gender" : null,
      capabilities.photoAssets ? "photo_thumbnail_path" : null,
      capabilities.photoAssets ? "photo_version" : null,
      capabilities.photoAssets ? "photo_url" : null,
    ]
      .filter(Boolean)
      .join(", ");

    const { data, error } = await supabase
      .from("students")
      .select(selectClause)
      .in("id", studentIds)
      .returns<StudentHttpSupplementRow[]>();

    if (!error) {
      return {
        capabilities,
        rows: (data ?? []) as StudentHttpSupplementRow[],
      };
    }

    if (!isSchemaShapeError(error)) {
      throw error;
    }
  }

  return {
    capabilities: { aadhaarDocuments: false, gender: false, photoAssets: false } satisfies StudentSchemaCapabilities,
    rows: [] as StudentHttpSupplementRow[],
  };
};

const fetchStudentsPageFromHttp = async (params: StudentsListParams): Promise<StudentsListResponse> => {
  const payload = await requestJson<unknown>(
    createStudentsUrl(STUDENTS_LIST_PATH, {
      libraryId: params.libraryId,
      limit: params.limit,
      page: params.page,
      paymentStatus: params.paymentStatus === "all" ? undefined : params.paymentStatus.toLowerCase(),
      search: params.search.trim() || undefined,
      seatNumber: params.seatNumber.trim() || undefined,
      gender: params.gender === "all" ? undefined : params.gender,
    }),
  );

  const record = toRecord(payload) ?? {};
  const rawData = Array.isArray(record.data) ? record.data : [];
  let data = rawData.map(normalizeStudent);

  if (data.length > 0) {
    const studentIds = data.map((student) => student.id).filter(Boolean);
    const { capabilities, rows: supplementRows } = await fetchStudentSupplementsWithFallback(studentIds);

    const supplementById = new Map(
      supplementRows.map((student) => [
        student.id,
        {
          aadhaarPhotoPath: capabilities.aadhaarDocuments ? student.aadhaar_photo_path ?? null : null,
          gender: capabilities.gender ? student.gender ?? null : null,
          photoUrl: resolveStudentPhotoUrl({
            photoThumbnailPath: capabilities.photoAssets ? student.photo_thumbnail_path ?? null : null,
            photoUrl: capabilities.photoAssets ? student.photo_url ?? null : null,
            photoVersion: capabilities.photoAssets ? student.photo_version ?? null : null,
          }),
        },
      ]),
    );

    data = data.map((student) => {
      const supplement = supplementById.get(student.id);
      if (!supplement) return student;

      return {
        ...student,
        aadhaarPhotoPath: supplement.aadhaarPhotoPath ?? student.aadhaarPhotoPath,
        gender: supplement.gender ?? student.gender,
        photoUrl: supplement.photoUrl ?? student.photoUrl,
      };
    });
  }

  if (params.gender !== "all") {
    data = data.filter((student) => student.gender === params.gender);
  }

  const total = toNumber(record.total, data.length);
  const page = Math.max(1, toNumber(record.page, params.page));
  const totalPages = Math.max(1, toNumber(record.totalPages ?? record.total_pages, Math.ceil(total / params.limit) || 1));
  const summary = normalizeSummary(record.summary);

  return {
    data,
    page,
    summary,
    total,
    totalPages,
  };
};

export const buildStudentsSummaryFromPage = (students: StudentListItem[]): StudentsSummary => ({
  overdueStudents: students.filter((student) => student.status === "Overdue").length,
  paidStudents: students.filter((student) => student.status === "Paid").length,
  pendingAmount: students.reduce((sum, student) => sum + toNumber(student.amountDue, 0), 0),
  totalRevenue: students.reduce((sum, student) => sum + toNumber(student.amountPaid, 0), 0),
  unpaidStudents: students.filter((student) => student.status !== "Paid").length,
});

export const fetchStudentsPage = async (params: StudentsListParams): Promise<StudentsListResponse> => {
  if (!shouldBypassStudentsHttpRoute) {
    try {
      return await fetchStudentsPageFromHttp(params);
    } catch (error) {
      if (!shouldFallbackToSupabase(error)) throw error;
      shouldBypassStudentsHttpRoute = true;
    }
  }

  return fetchStudentsPageFromSupabase(params);
};

export const markStudentPaid = async ({
  libraryId,
  student,
}: {
  libraryId: string;
  student: StudentListItem;
}) => {
  if (!shouldBypassStudentsHttpRoute) {
    try {
      await requestJson(createStudentsUrl(`${STUDENTS_LIST_PATH}/${student.id}/mark-paid`), {
        method: "POST",
      });
      return;
    } catch (error) {
      if (!shouldFallbackToSupabase(error)) throw error;
      shouldBypassStudentsHttpRoute = true;
    }
  }

  const amount = toNumber(student.amountDue, 0);
  if (amount <= 0) {
    throw new Error("No due amount left for this student.");
  }

  const payload: Database["public"]["Tables"]["payments"]["Insert"] = {
    amount,
    library_id: libraryId,
    payment_method: "cash",
    period_end: student.dueDate || getDefaultPaymentDueDate(student.startDate),
    period_start: student.startDate || new Date().toISOString().slice(0, 10),
    plan: student.plan || null,
    seat_id: student.seatId || null,
    source: "manual",
    status: "approved",
    student_id: student.id,
  };

  const { error } = await supabase.from("payments").insert(payload);
  if (error) throw error;
};

export const updateStudent = async ({
  payload,
  studentId,
}: {
  payload: StudentEditPayload;
  studentId: string;
}) =>
  requestJson<StudentEditResponse>(createStudentsUrl(`/api/students/${encodeURIComponent(studentId)}`), {
    body: JSON.stringify(payload),
    headers: sanitizeHeaders(
      {
        "Content-Type": "application/json",
        ...(await getStudentsAuthHeaders()),
      },
      {
        allowedHeaders: ["Authorization", "Content-Type"],
      },
    ),
    method: "PATCH",
  });
