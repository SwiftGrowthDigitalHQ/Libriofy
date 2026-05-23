import { createClient } from "@supabase/supabase-js";

import { normalizeParsedRequestBody } from "./httpRequest.server.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";
import { resolveRequestAuthUser } from "./requestAuth.server.js";

type EnvLike = Record<string, string | undefined>;

export type StudentApiHeaders = Record<string, string | string[] | undefined>;

export type StudentApiRequest = {
  body?: unknown;
  headers?: StudentApiHeaders;
  method?: string;
  url?: string;
};

export type StudentApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

type StudentApiRoutePath = `/api/students/${string}`;

type StudentUpdateBody = {
  aadhaarNumber?: unknown;
  aadhaar_number?: unknown;
  address?: unknown;
  dueDate?: unknown;
  due_date?: unknown;
  gender?: unknown;
  name?: unknown;
  notes?: unknown;
  paymentStatus?: unknown;
  payment_status?: unknown;
  phone?: unknown;
  plan?: unknown;
  planName?: unknown;
  plan_name?: unknown;
  seatNumber?: unknown;
  seat_number?: unknown;
};

type UserRoleRow = {
  library_id: string | null;
  role: string;
};

type LibraryRow = {
  id: string;
  owner_id: string | null;
};

type StudentRow = {
  aadhaar_number?: string | null;
  address?: string | null;
  expiry_date?: string | null;
  full_name?: string | null;
  gender?: string | null;
  id: string;
  library_id: string;
  notes?: string | null;
  phone?: string | null;
  plan?: string | null;
  seat_id?: string | null;
  seat_number?: string | null;
  slot_id?: string | null;
  start_date?: string | null;
  status?: string | null;
};

type PlanRow = {
  id: string;
  is_active?: boolean | null;
  name: string;
  price: number | string | null;
};

type PaymentRow = {
  amount: number | string | null;
  created_at: string;
  id: string;
  payment_method?: string | null;
  period_end?: string | null;
  period_start?: string | null;
  plan?: string | null;
  seat_id?: string | null;
  source?: string | null;
  status?: string | null;
  student_id: string;
};

type StudentUpdateResponseBody =
  | {
      message: string;
      student: {
        aadhaarNumber: string | null;
        address: string | null;
        amountDue: number;
        amountPaid: number;
        dueDate: string | null;
        gender: "female" | "male" | null;
        id: string;
        name: string;
        notes: string | null;
        phone: string | null;
        plan: string | null;
        seatNo: string | null;
        status: "Overdue" | "Paid" | "Unpaid";
      };
      success: true;
    }
  | {
      code?: string;
      message: string;
      success: false;
    };

type StudentUpdateServiceResponse = {
  body: StudentUpdateResponseBody;
  statusCode: number;
};

type ParsedStudentUpdateInput = {
  aadhaarNumber: string | null;
  address: string | null;
  dueDate: string | null;
  gender: "female" | "male" | null;
  name: string;
  notes: string | null;
  paymentStatus: "Overdue" | "Paid" | "Unpaid";
  phone: string;
  planName: string | null;
  seatNumber: string | null;
};

type PaymentSnapshot = {
  amountDue: number;
  amountPaid: number;
  dueDate: string | null;
  status: "Overdue" | "Paid" | "Unpaid";
};

type DatabaseErrorLike = {
  code?: string | null;
  details?: string | null;
  message?: string | null;
  status?: number | null;
};

const STUDENT_API_ROUTE_PATTERN = /^\/api\/students\/([^/]+)$/;
const SUCCESSFUL_PAYMENT_STATUSES = new Set(["approved", "completed", "captured", "paid", "success"]);
const STUDENT_API_ALLOWED_METHODS = "PATCH, PUT";

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toNullableText = (value: unknown) => {
  const normalized = trimText(value);
  return normalized ? normalized : null;
};

const normalizeLookupText = (value: unknown) => trimText(value).toLowerCase().replace(/\s+/g, " ");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const readHeaderValue = (headers: StudentApiHeaders | undefined, headerName: string) => {
  const value = headers?.[headerName];
  return Array.isArray(value) ? value[0] : value;
};

const sendJson = (res: StudentApiResponse, statusCode: number, body: StudentUpdateResponseBody, extraHeaders?: Record<string, string | string[]>) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }

  res.end(JSON.stringify(body));
};

const sendMethodNotAllowed = (res: StudentApiResponse) => {
  sendJson(
    res,
    405,
    {
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
      success: false,
    },
    { Allow: STUDENT_API_ALLOWED_METHODS },
  );
};

const buildError = (message: string, statusCode: number, code?: string): StudentUpdateServiceResponse => ({
  body: {
    ...(code ? { code } : {}),
    message,
    success: false,
  },
  statusCode,
});

const buildSuccess = ({
  student,
}: {
  student: StudentUpdateResponseBody extends { success: true; student: infer T } ? T : never;
}): StudentUpdateServiceResponse => ({
  body: {
    message: "Student updated successfully.",
    student,
    success: true,
  },
  statusCode: 200,
});

const isSupportedStudentApiPath = (pathname: string): pathname is StudentApiRoutePath => STUDENT_API_ROUTE_PATTERN.test(pathname);

export const readStudentApiRequestPath = (req: StudentApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const readParsedBody = (req: StudentApiRequest) =>
  normalizeParsedRequestBody(req.body, readHeaderValue(req.headers, "content-type"));

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
      fetch: createInstrumentedServerSupabaseFetch("student_update_api"),
    },
  });
};

const parseDateOnly = (value: string | null) => {
  const normalized = trimText(value);
  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isPastDate = (value: string) => {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return false;
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parsed.getTime() < todayStart.getTime();
};

const normalizeGender = (value: unknown) => {
  const normalized = trimText(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "male" || normalized === "female") {
    return normalized;
  }

  return undefined;
};

const normalizePaymentStatus = (value: unknown) => {
  const normalized = trimText(value).toLowerCase();

  if (normalized === "paid") return "Paid";
  if (normalized === "overdue") return "Overdue";
  if (normalized === "unpaid") return "Unpaid";
  return null;
};

const parseStudentUpdateInput = (body: Record<string, unknown>): ParsedStudentUpdateInput | StudentUpdateServiceResponse => {
  const name = trimText(body.name);
  const phone = trimText(body.phone);
  const dueDate = toNullableText(body.dueDate ?? body.due_date);
  const paymentStatus = normalizePaymentStatus(body.paymentStatus ?? body.payment_status);
  const gender = normalizeGender(body.gender);

  if (!name) {
    return buildError("Student name is required.", 400, "NAME_REQUIRED");
  }

  if (!phone) {
    return buildError("Phone is required.", 400, "PHONE_REQUIRED");
  }

  if (gender === undefined) {
    return buildError("Gender must be male or female.", 400, "INVALID_GENDER");
  }

  if (!paymentStatus) {
    return buildError("Payment status must be Paid, Unpaid, or Overdue.", 400, "INVALID_PAYMENT_STATUS");
  }

  if (dueDate && !parseDateOnly(dueDate)) {
    return buildError("Due date must be a valid date.", 400, "INVALID_DUE_DATE");
  }

  if (paymentStatus !== "Paid" && !dueDate) {
    return buildError("Due date is required for unpaid or overdue students.", 400, "DUE_DATE_REQUIRED");
  }

  if (paymentStatus === "Overdue" && dueDate && !isPastDate(dueDate)) {
    return buildError("Overdue students need a past due date.", 400, "OVERDUE_DATE_REQUIRED");
  }

  if (paymentStatus === "Unpaid" && dueDate && isPastDate(dueDate)) {
    return buildError("Choose today or a future due date to keep the student unpaid instead of overdue.", 400, "UNPAID_DATE_INVALID");
  }

  return {
    aadhaarNumber: toNullableText(body.aadhaarNumber ?? body.aadhaar_number),
    address: toNullableText(body.address),
    dueDate,
    gender,
    name,
    notes: toNullableText(body.notes),
    paymentStatus,
    phone,
    planName: toNullableText(body.planName ?? body.plan_name ?? body.plan),
    seatNumber: toNullableText(body.seatNumber ?? body.seat_number),
  };
};

const isSuccessfulPaymentStatus = (status: string | null | undefined) =>
  SUCCESSFUL_PAYMENT_STATUSES.has(trimText(status).toLowerCase());

const getAveragePlanPrice = (plans: PlanRow[]) => {
  const prices = plans
    .map((plan) => Number(plan.price || 0))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (!prices.length) {
    return 0;
  }

  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
};

const getPlanPrice = (planName: string | null | undefined, plans: PlanRow[]) => {
  const normalizedPlanName = normalizeLookupText(planName);
  if (normalizedPlanName) {
    const matchedPlan = plans.find((plan) => normalizeLookupText(plan.name) === normalizedPlanName);
    if (matchedPlan) {
      const matchedPrice = Number(matchedPlan.price || 0);
      return Number.isFinite(matchedPrice) ? Math.max(matchedPrice, 0) : 0;
    }
  }

  return getAveragePlanPrice(plans);
};

const sortPaymentsNewestFirst = (payments: PaymentRow[]) =>
  [...payments].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

const derivePaymentSnapshot = ({
  dueDateOverride,
  payments,
  plans,
  student,
}: {
  dueDateOverride?: string | null;
  payments: PaymentRow[];
  plans: PlanRow[];
  student: Pick<StudentRow, "expiry_date" | "plan" | "start_date">;
}): PaymentSnapshot => {
  const sortedPayments = sortPaymentsNewestFirst(payments);
  const successfulPayments = sortedPayments.filter((payment) => isSuccessfulPaymentStatus(payment.status));
  const totalFees = Math.round(Math.max(getPlanPrice(student.plan ?? null, plans), 0));
  const amountPaid = Math.round(
    successfulPayments.reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0),
  );
  const amountDue = Math.max(totalFees - amountPaid, 0);
  const latestPaymentDueDate = sortedPayments.find((payment) => trimText(payment.period_end))?.period_end ?? null;
  const dueDate = dueDateOverride !== undefined ? dueDateOverride : latestPaymentDueDate || student.expiry_date || student.start_date || null;

  const parsedDueDate = parseDateOnly(dueDate);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const overdueDays =
    amountDue > 0 && parsedDueDate
      ? Math.max(Math.floor((todayStart.getTime() - parsedDueDate.getTime()) / 86_400_000), 0)
      : 0;

  return {
    amountDue,
    amountPaid,
    dueDate,
    status: amountDue <= 0 ? "Paid" : overdueDays > 0 ? "Overdue" : "Unpaid",
  };
};

const deriveNextMembershipStatus = (currentStatus: string | null | undefined, dueDate: string | null) => {
  const normalizedStatus = trimText(currentStatus).toLowerCase();

  if (normalizedStatus === "inactive" || normalizedStatus === "waiting") {
    return normalizedStatus || "active";
  }

  if (!dueDate) {
    return normalizedStatus === "expired" || normalizedStatus === "active" ? normalizedStatus || "active" : "active";
  }

  return isPastDate(dueDate) ? "expired" : "active";
};

const canEditLibraryStudent = ({
  authUserId,
  isSuperAdmin,
  libraryId,
  ownerId,
  roles,
}: {
  authUserId: string;
  isSuperAdmin: boolean;
  libraryId: string;
  ownerId: string | null;
  roles: UserRoleRow[];
}) => {
  if (isSuperAdmin) {
    return true;
  }

  if (ownerId && ownerId === authUserId) {
    return true;
  }

  return roles.some((role) => role.role === "library_owner" && role.library_id === libraryId);
};

const mapDatabaseError = (error: unknown) => {
  const databaseError = error as DatabaseErrorLike | undefined;
  const message = trimText(databaseError?.message);
  const normalizedMessage = message.toLowerCase();

  if (!message) {
    return {
      code: "STUDENT_UPDATE_FAILED",
      message: "Unable to update the student right now.",
      statusCode: 500,
    };
  }

  if (normalizedMessage.includes("seat is already assigned")) {
    return {
      code: "SEAT_ALREADY_ASSIGNED",
      message: "That seat is already assigned for this slot.",
      statusCode: 409,
    };
  }

  if (normalizedMessage.includes("invalid seat for this library")) {
    return {
      code: "INVALID_SEAT",
      message: "That seat number does not belong to this library.",
      statusCode: 400,
    };
  }

  if (normalizedMessage.includes("column") && normalizedMessage.includes("does not exist")) {
    return {
      code: "SCHEMA_OUTDATED",
      message: "Apply the latest student edit migration before saving these fields.",
      statusCode: 503,
    };
  }

  return {
    code: databaseError?.code || "STUDENT_UPDATE_FAILED",
    message,
    statusCode: typeof databaseError?.status === "number" && databaseError.status >= 400 ? databaseError.status : 400,
  };
};

const resolveStudentIdFromPath = (pathname: string) => {
  const match = pathname.match(STUDENT_API_ROUTE_PATTERN);
  return match ? decodeURIComponent(match[1] || "").trim() : "";
};

const resolveStudentUpdateRequest = async (
  env: EnvLike,
  studentId: string,
  requestBody: unknown,
  headers: { authorization?: string } = {},
): Promise<StudentUpdateServiceResponse> => {
  const normalizedStudentId = trimText(studentId);
  if (!normalizedStudentId) {
    return buildError("Student ID is required.", 400, "INVALID_STUDENT_ID");
  }

  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : {};
  const parsedInput = parseStudentUpdateInput(body);
  if ("statusCode" in parsedInput) {
    return parsedInput;
  }

  const authorization = trimText(headers.authorization);
  if (!authorization) {
    return buildError("Missing authorization header.", 401, "UNAUTHORIZED");
  }

  const authUser = await resolveRequestAuthUser(env, authorization);
  if (!authUser) {
    return buildError("Unauthorized.", 401, "UNAUTHORIZED");
  }

  const serviceClient = buildServiceClient(env);

  try {
    const [{ data: rolesData, error: rolesError }, { data: rawStudent, error: studentError }] = await Promise.all([
      serviceClient.from("user_roles").select("role, library_id").eq("user_id", authUser.id),
      serviceClient.from("students").select("*").eq("id", normalizedStudentId).maybeSingle(),
    ]);

    if (rolesError) throw rolesError;
    if (studentError) throw studentError;

    const student = rawStudent as StudentRow | null;
    if (!student?.id) {
      return buildError("Student not found.", 404, "STUDENT_NOT_FOUND");
    }

    const { data: rawLibrary, error: libraryError } = await serviceClient
      .from("libraries")
      .select("id, owner_id")
      .eq("id", student.library_id)
      .maybeSingle();

    if (libraryError) throw libraryError;

    const library = rawLibrary as LibraryRow | null;
    if (!library?.id) {
      return buildError("Library not found.", 404, "LIBRARY_NOT_FOUND");
    }

    const roles = (rolesData ?? []) as UserRoleRow[];
    const isSuperAdmin =
      authUser.roles.includes("super_admin") ||
      authUser.realUser?.roles.includes("super_admin") ||
      roles.some((role) => role.role === "super_admin");

    if (
      !canEditLibraryStudent({
        authUserId: authUser.id,
        isSuperAdmin,
        libraryId: student.library_id,
        ownerId: library.owner_id,
        roles,
      })
    ) {
      return buildError("Only admins or superadmins can edit student records.", 403, "FORBIDDEN");
    }

    const [{ data: rawPlans, error: plansError }, { data: rawPayments, error: paymentsError }] = await Promise.all([
      serviceClient.from("plans").select("id, name, price, is_active").eq("library_id", student.library_id),
      serviceClient
        .from("payments")
        .select("amount, created_at, id, payment_method, period_end, period_start, plan, seat_id, source, status, student_id")
        .eq("library_id", student.library_id)
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
    ]);

    if (plansError) throw plansError;
    if (paymentsError) throw paymentsError;

    const plans = (rawPlans ?? []) as PlanRow[];
    const payments = (rawPayments ?? []) as PaymentRow[];
    const candidateStudent = {
      ...student,
      expiry_date: parsedInput.dueDate,
      plan: parsedInput.planName,
      start_date: student.start_date || new Date().toISOString().slice(0, 10),
    } satisfies Pick<StudentRow, "expiry_date" | "plan" | "start_date">;

    const preUpdateSnapshot = derivePaymentSnapshot({
      dueDateOverride: parsedInput.dueDate,
      payments,
      plans,
      student: candidateStudent,
    });

    if (parsedInput.paymentStatus === "Paid" && preUpdateSnapshot.amountDue <= 0) {
      // Already satisfied. Allow the edit and keep the payment history untouched.
    } else if (parsedInput.paymentStatus !== "Paid") {
      if (preUpdateSnapshot.amountDue <= 0) {
        return buildError(
          "Recorded payments already cover this plan, so the student cannot be marked unpaid or overdue without a payment adjustment.",
          400,
          "PAYMENT_STATE_LOCKED",
        );
      }

      if (preUpdateSnapshot.status !== parsedInput.paymentStatus) {
        return buildError(
          parsedInput.paymentStatus === "Overdue"
            ? "The selected due date does not make this student overdue yet."
            : "The selected due date would mark this student overdue instead of unpaid.",
          400,
          "PAYMENT_STATUS_MISMATCH",
        );
      }
    }

    const nextMembershipStatus = deriveNextMembershipStatus(student.status, parsedInput.dueDate);
    const { data: updatedStudentRaw, error: updateError } = await serviceClient
      .from("students")
      .update({
        aadhaar_number: parsedInput.aadhaarNumber,
        address: parsedInput.address,
        expiry_date: parsedInput.dueDate,
        full_name: parsedInput.name,
        gender: parsedInput.gender,
        notes: parsedInput.notes,
        phone: parsedInput.phone,
        plan: parsedInput.planName,
        plan_id: null,
        seat_id: null,
        seat_number: parsedInput.seatNumber,
        status: nextMembershipStatus,
      })
      .eq("id", student.id)
      .eq("library_id", student.library_id)
      .select("*")
      .maybeSingle();

    if (updateError) throw updateError;

    const updatedStudent = (updatedStudentRaw ?? null) as StudentRow | null;
    if (!updatedStudent?.id) {
      return buildError("Student could not be updated.", 404, "STUDENT_NOT_FOUND");
    }

    const dueDateSourcePayment = sortPaymentsNewestFirst(payments).find((payment) => trimText(payment.period_end));
    const needsCatchUpPayment = parsedInput.paymentStatus === "Paid" && preUpdateSnapshot.amountDue > 0;

    let nextPayments = payments.map((payment) => ({ ...payment }));

    if (!needsCatchUpPayment && dueDateSourcePayment) {
      const { data: updatedPaymentRow, error: paymentUpdateError } = await serviceClient
        .from("payments")
        .update({
          period_end: parsedInput.dueDate,
        })
        .eq("id", dueDateSourcePayment.id)
        .eq("student_id", student.id)
        .select("amount, created_at, id, payment_method, period_end, period_start, plan, seat_id, source, status, student_id")
        .maybeSingle();

      if (paymentUpdateError) throw paymentUpdateError;

      if (updatedPaymentRow) {
        nextPayments = nextPayments.map((payment) =>
          payment.id === dueDateSourcePayment.id ? ({ ...payment, ...(updatedPaymentRow as PaymentRow) } satisfies PaymentRow) : payment,
        );
      }
    }

    if (needsCatchUpPayment) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data: insertedPaymentRow, error: insertPaymentError } = await serviceClient
        .from("payments")
        .insert({
          amount: preUpdateSnapshot.amountDue,
          library_id: student.library_id,
          payment_method: "cash",
          period_end: parsedInput.dueDate || updatedStudent.expiry_date || updatedStudent.start_date || todayIso,
          period_start: updatedStudent.start_date || todayIso,
          plan: updatedStudent.plan || parsedInput.planName || null,
          seat_id: updatedStudent.seat_id ?? null,
          source: "manual",
          status: "approved",
          student_id: student.id,
        })
        .select("amount, created_at, id, payment_method, period_end, period_start, plan, seat_id, source, status, student_id")
        .maybeSingle();

      if (insertPaymentError) throw insertPaymentError;

      if (insertedPaymentRow) {
        nextPayments = [insertedPaymentRow as PaymentRow, ...nextPayments];
      }
    }

    const finalSnapshot = derivePaymentSnapshot({
      payments: nextPayments,
      plans,
      student: {
        expiry_date: updatedStudent.expiry_date ?? null,
        plan: updatedStudent.plan ?? null,
        start_date: updatedStudent.start_date || new Date().toISOString().slice(0, 10),
      },
    });

    return buildSuccess({
      student: {
        aadhaarNumber: toNullableText(updatedStudent.aadhaar_number),
        address: toNullableText(updatedStudent.address),
        amountDue: finalSnapshot.amountDue,
        amountPaid: finalSnapshot.amountPaid,
        dueDate: finalSnapshot.dueDate,
        gender: normalizeGender(updatedStudent.gender) ?? null,
        id: updatedStudent.id,
        name: trimText(updatedStudent.full_name) || parsedInput.name,
        notes: toNullableText(updatedStudent.notes),
        phone: toNullableText(updatedStudent.phone),
        plan: toNullableText(updatedStudent.plan),
        seatNo: toNullableText(updatedStudent.seat_number),
        status: finalSnapshot.status,
      },
    });
  } catch (error) {
    const mappedError = mapDatabaseError(error);
    return buildError(mappedError.message, mappedError.statusCode, mappedError.code);
  }
};

export const handleStudentApiRequest = async (
  req: StudentApiRequest,
  res: StudentApiResponse,
  env: EnvLike,
  pathname = readStudentApiRequestPath(req),
) => {
  if (!isSupportedStudentApiPath(pathname)) {
    sendJson(res, 404, {
      code: "ROUTE_NOT_FOUND",
      message: "API route not found.",
      success: false,
    });
    return;
  }

  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "PATCH" && method !== "PUT") {
    sendMethodNotAllowed(res);
    return;
  }

  const studentId = resolveStudentIdFromPath(pathname);
  const result = await resolveStudentUpdateRequest(env, studentId, readParsedBody(req), {
    authorization: readHeaderValue(req.headers, "authorization"),
  });

  sendJson(res, result.statusCode, result.body);
};

export { isSupportedStudentApiPath };
