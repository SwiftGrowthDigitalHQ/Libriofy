import { addDays, format, startOfDay } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RenewalReminderScanResponse = {
  results?: {
    legacyNotifications?: {
      failed?: number;
      processed?: number;
      sent?: number;
      skipped?: number;
    };
    lockerScan?: Record<string, unknown> | null;
    reminderDelivery?: {
      failed?: number;
      processed?: number;
      sent?: number;
      skipped?: number;
    };
    renewalScan?: Record<string, unknown> | null;
  };
  success?: boolean;
  timestamp?: string;
};

export const RENEWAL_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type RenewalPageSize = (typeof RENEWAL_PAGE_SIZE_OPTIONS)[number];
export type RenewalStatusFilter = "active" | "all" | "expired" | "expiring_soon" | "no_expiry";
export type ReminderLogStatusFilter = "all" | "failed" | "pending" | "success";

export type StudentRenewalRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "expiry_date" | "full_name" | "id" | "phone" | "plan" | "qr_code" | "seat_number" | "status"
>;

export type ReminderLogRow = Database["public"]["Tables"]["reminder_logs"]["Row"];

export type ReminderLogWithStudent = ReminderLogRow & {
  student: Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "phone" | "seat_number"> | null;
};

export type RenewalStudentsPageResponse = {
  data: StudentRenewalRow[];
  page: number;
  total: number;
  totalPages: number;
};

export type RenewalOverviewResponse = {
  activeCount: number;
  dueTodayCount: number;
  expiredCount: number;
  expiringSoonCount: number;
  remindersFailed: number;
  remindersPending: number;
  remindersSentToday: number;
};

export const RENEWAL_REMINDER_LOGS_BATCH_SIZE = 10;

export type RenewalReminderLogsPageResponse = {
  data: ReminderLogWithStudent[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
};

const REMINDER_LOG_TYPES = ["renewal_7day", "renewal_1day", "renewal_due_today", "subscription_reminder_3day"] as const;

const getRenewalScanErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (message.includes("Failed to send a request to the Edge Function")) {
      return "The process-renewals Edge Function is not reachable from the browser. Deploy the real function code and make sure it handles OPTIONS/CORS, then try again.";
    }

    if (message) {
      return message;
    }
  }

  return "Unable to run the renewal reminder scan.";
};

const escapeIlikeValue = (value: string) => value.replace(/[%_]/g, (character) => `\\${character}`);

const getRenewalDateRange = () => {
  const today = startOfDay(new Date());

  return {
    nextDayIso: format(addDays(today, 1), "yyyy-MM-dd"),
    soonIso: format(addDays(today, 7), "yyyy-MM-dd"),
    todayIso: format(today, "yyyy-MM-dd"),
  };
};

type RenewalFilterQuery<T> = {
  eq: (column: string, value: string) => T;
  gt: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  is: (column: string, value: null) => T;
  lte: (column: string, value: string) => T;
  neq: (column: string, value: string) => T;
  not: (column: string, operator: string, value: null) => T;
  or: (filters: string) => T;
};

const applyRenewalFilter = <T extends RenewalFilterQuery<T>>(query: T, filter: RenewalStatusFilter) => {
  const { soonIso, todayIso } = getRenewalDateRange();

  if (filter === "expired") {
    return query.eq("status", "expired");
  }

  if (filter === "expiring_soon") {
    return query
      .not("expiry_date", "is", null)
      .gte("expiry_date", todayIso)
      .lte("expiry_date", soonIso)
      .neq("status", "expired");
  }

  if (filter === "active") {
    return query.eq("status", "active").not("expiry_date", "is", null).gt("expiry_date", soonIso);
  }

  if (filter === "no_expiry") {
    return query.is("expiry_date", null);
  }

  return query;
};

const applyRenewalSearch = <T extends { or: (filters: string) => T }>(query: T, search: string) => {
  const trimmedSearch = search.trim();

  if (!trimmedSearch) {
    return query;
  }

  const pattern = `%${escapeIlikeValue(trimmedSearch)}%`;
  return query.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`);
};

const applyReminderLogStatusFilter = <T extends { eq: (column: string, value: string) => T }>(query: T, filter: ReminderLogStatusFilter) => {

  if (filter === "success") {
    return query.eq("status", "sent");
  }

  if (filter === "failed") {
    return query.eq("status", "failed");
  }

  if (filter === "pending") {
    return query.eq("status", "queued");
  }

  return query;
};

export const runRenewalReminderScan = async (libraryId: string) => {
  const { data, error } = await supabase.functions.invoke<RenewalReminderScanResponse>("process-renewals", {
    body: {
      includeLockerRenewalScan: false,
      includeRenewalScan: true,
      libraryId,
      source: "renewals_page",
    },
  });

  if (error) {
    throw new Error(getRenewalScanErrorMessage(error));
  }

  return data;
};

export const fetchRenewalsPage = async ({
  filter,
  libraryId,
  limit,
  page,
  search,
}: {
  filter: RenewalStatusFilter;
  libraryId: string | null;
  limit: number;
  page: number;
  search: string;
}): Promise<RenewalStudentsPageResponse> => {
  if (!libraryId) {
    return {
      data: [],
      page: 1,
      total: 0,
      totalPages: 1,
    };
  }

  const safeLimit = Math.max(1, limit);
  const safePage = Math.max(1, page);
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  let query = supabase
    .from("students")
    .select("id, full_name, plan, seat_number, status, expiry_date, phone, qr_code", {
      count: "exact",
    })
    .eq("library_id", libraryId)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .range(from, to);

  query = applyRenewalSearch(query, search);
  query = applyRenewalFilter(query, filter);

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const total = count ?? 0;

  return {
    data: (data ?? []) as StudentRenewalRow[],
    page: safePage,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

export const fetchRenewalsOverview = async (libraryId: string | null): Promise<RenewalOverviewResponse> => {
  if (!libraryId) {
    return {
      activeCount: 0,
      dueTodayCount: 0,
      expiredCount: 0,
      expiringSoonCount: 0,
      remindersFailed: 0,
      remindersPending: 0,
      remindersSentToday: 0,
    };
  }

  const { nextDayIso, soonIso, todayIso } = getRenewalDateRange();

  const [activeResult, expiringSoonResult, dueTodayResult, expiredResult, sentTodayResult, queuedResult, failedResult] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("status", "active")
      .or(`expiry_date.is.null,expiry_date.gte.${todayIso}`),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .not("expiry_date", "is", null)
      .gte("expiry_date", todayIso)
      .lte("expiry_date", soonIso)
      .neq("status", "expired"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("expiry_date", todayIso)
      .neq("status", "expired"),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .or(`status.eq.expired,expiry_date.lt.${todayIso}`),
    supabase
      .from("reminder_logs")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .in("reminder_type", [...REMINDER_LOG_TYPES])
      .eq("status", "sent")
      .gte("sent_at", `${todayIso}T00:00:00`)
      .lt("sent_at", `${nextDayIso}T00:00:00`),
    supabase
      .from("reminder_logs")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .in("reminder_type", [...REMINDER_LOG_TYPES])
      .eq("status", "queued"),
    supabase
      .from("reminder_logs")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .in("reminder_type", [...REMINDER_LOG_TYPES])
      .eq("status", "failed"),
  ]);

  if (activeResult.error) throw activeResult.error;
  if (expiringSoonResult.error) throw expiringSoonResult.error;
  if (dueTodayResult.error) throw dueTodayResult.error;
  if (expiredResult.error) throw expiredResult.error;
  if (sentTodayResult.error) throw sentTodayResult.error;
  if (queuedResult.error) throw queuedResult.error;
  if (failedResult.error) throw failedResult.error;

  return {
    activeCount: activeResult.count ?? 0,
    dueTodayCount: dueTodayResult.count ?? 0,
    expiredCount: expiredResult.count ?? 0,
    expiringSoonCount: expiringSoonResult.count ?? 0,
    remindersFailed: failedResult.count ?? 0,
    remindersPending: queuedResult.count ?? 0,
    remindersSentToday: sentTodayResult.count ?? 0,
  };
};

const attachStudentsToReminderLogs = async (logs: ReminderLogRow[]) => {
  const studentIds = Array.from(new Set(logs.map((log) => log.student_id).filter((studentId): studentId is string => Boolean(studentId))));

  let studentMap = new Map<string, Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "phone" | "seat_number">>();

  if (studentIds.length > 0) {
    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id, full_name, phone, seat_number")
      .in("id", studentIds);

    if (studentsError) {
      throw studentsError;
    }

    studentMap = new Map(
      (students ?? []).map((student) => [
        student.id,
        {
          full_name: student.full_name,
          phone: student.phone,
          seat_number: student.seat_number,
        },
      ]),
    );
  }

  return logs.map((log) => ({
    ...log,
    student: log.student_id ? studentMap.get(log.student_id) ?? null : null,
  }));
};

export const fetchRenewalReminderLogsPage = async ({
  cursor,
  filter = "all",
  libraryId,
  limit = RENEWAL_REMINDER_LOGS_BATCH_SIZE,
}: {
  cursor?: string | null;
  filter?: ReminderLogStatusFilter;
  libraryId: string | null;
  limit?: number;
}): Promise<RenewalReminderLogsPageResponse> => {
  if (!libraryId) {
    return {
      data: [],
      hasMore: false,
      nextCursor: null,
      totalCount: 0,
    };
  }

  const safeLimit = Math.max(1, limit);
  let countQuery = supabase
    .from("reminder_logs")
    .select("id", { count: "exact", head: true })
    .eq("library_id", libraryId)
    .in("reminder_type", [...REMINDER_LOG_TYPES]);

  let query = supabase
    .from("reminder_logs")
    .select("id, created_at, reminder_type, phone, message, status, sent_at, delivery_channel, error_message, student_id")
    .eq("library_id", libraryId)
    .in("reminder_type", [...REMINDER_LOG_TYPES])
    .returns<ReminderLogRow[]>();

  countQuery = applyReminderLogStatusFilter(countQuery, filter);
  query = applyReminderLogStatusFilter(query, filter);
  query = query.order("created_at", { ascending: false }).limit(safeLimit + 1);

  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const [{ count, error: countError }, { data, error }] = await Promise.all([countQuery, query]);

  if (countError) {
    throw countError;
  }
  if (error) {
    throw error;
  }

  const logs = (data ?? []).filter(Boolean);
  const hasMore = logs.length > safeLimit;
  const visibleLogs = hasMore ? logs.slice(0, safeLimit) : logs;
  const enrichedLogs = await attachStudentsToReminderLogs(visibleLogs);
  const nextCursor = hasMore && visibleLogs.length > 0 ? visibleLogs[visibleLogs.length - 1].created_at ?? null : null;

  return {
    data: enrichedLogs,
    hasMore,
    nextCursor,
    totalCount: count ?? 0,
  };
};

export const fetchLatestRenewalReminderLogs = async ({
  after,
  filter = "all",
  libraryId,
  limit = RENEWAL_REMINDER_LOGS_BATCH_SIZE,
}: {
  after?: string | null;
  filter?: ReminderLogStatusFilter;
  libraryId: string | null;
  limit?: number;
}): Promise<ReminderLogWithStudent[]> => {
  if (!libraryId) {
    return [];
  }

  const safeLimit = Math.max(1, limit);
  let query = supabase
    .from("reminder_logs")
    .select("id, created_at, reminder_type, phone, message, status, sent_at, delivery_channel, error_message, student_id")
    .eq("library_id", libraryId)
    .in("reminder_type", [...REMINDER_LOG_TYPES])
    .returns<ReminderLogRow[]>();

  query = applyReminderLogStatusFilter(query, filter);
  query = query.order("created_at", { ascending: false }).limit(safeLimit);

  if (after) {
    query = query.gt("created_at", after);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return attachStudentsToReminderLogs((data ?? []).filter(Boolean));
};
