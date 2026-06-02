import { format, startOfDay } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const QR_PASS_PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
export type QrPassPageSize = (typeof QR_PASS_PAGE_SIZE_OPTIONS)[number];
export type QrPassStatusFilter = "all" | "active" | "expired";

export type QrPassListItem = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  | "expiry_date"
  | "full_name"
  | "id"
  | "no_show_days"
  | "phone"
  | "plan"
  | "photo_thumbnail_path"
  | "photo_url"
  | "photo_version"
  | "qr_code"
  | "seat_number"
  | "slot"
  | "slot_id"
  | "status"
>;

export type LibraryCardBrand = Pick<
  Database["public"]["Tables"]["libraries"]["Row"],
  "id" | "logo_url" | "name" | "library_name" | "primary_color"
>;

export type QrPassesPageParams = {
  libraryId: string | null;
  limit: number;
  page: number;
  search: string;
  status: QrPassStatusFilter;
};

export type QrPassesPageResponse = {
  data: QrPassListItem[];
  page: number;
  total: number;
  totalPages: number;
};

export type QrPassesSummary = {
  activeCount: number;
  noShowCount: number;
  totalStudents: number;
};

const escapeIlikeValue = (value: string) => value.replace(/[%_]/g, (character) => `\\${character}`);

type MembershipStatusFilterQuery<T> = {
  neq: (column: string, value: string) => T;
  or: (filters: string) => T;
};

const applyMembershipStatusFilter = <T extends MembershipStatusFilterQuery<T>>(query: T, status: QrPassStatusFilter) => {
  const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");

  if (status === "active") {
    return query
      .neq("status", "inactive")
      .neq("status", "waiting")
      .or(`expiry_date.gte.${todayIso},and(expiry_date.is.null,status.eq.active)`);
  }

  if (status === "expired") {
    return query.or(`expiry_date.lt.${todayIso},and(expiry_date.is.null,status.eq.expired)`);
  }

  return query;
};

export const fetchQrPassesPage = async ({
  libraryId,
  limit,
  page,
  search,
  status,
}: QrPassesPageParams): Promise<QrPassesPageResponse> => {
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
  const trimmedSearch = search.trim();

  let query = supabase
    .from("students")
    .select("id, full_name, phone, qr_code, seat_number, plan, status, no_show_days, slot, slot_id, expiry_date, photo_thumbnail_path, photo_version, photo_url", {
      count: "exact",
    })
    .eq("library_id", libraryId)
    .order("full_name", { ascending: true })
    .range(from, to);

  if (trimmedSearch) {
    const pattern = `%${escapeIlikeValue(trimmedSearch)}%`;
    query = query.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`);
  }

  query = applyMembershipStatusFilter(query, status);

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const total = count ?? 0;

  return {
    data: (data ?? []) as QrPassListItem[],
    page: safePage,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

export const fetchQrPassesSummary = async (libraryId: string | null): Promise<QrPassesSummary> => {
  if (!libraryId) {
    return {
      activeCount: 0,
      noShowCount: 0,
      totalStudents: 0,
    };
  }

  const [totalResult, activeResult, noShowResult] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("library_id", libraryId),
    applyMembershipStatusFilter(supabase.from("students").select("id", { count: "exact", head: true }).eq("library_id", libraryId), "active"),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("library_id", libraryId).gte("no_show_days", 2),
  ]);

  if (totalResult.error) throw totalResult.error;
  if (activeResult.error) throw activeResult.error;
  if (noShowResult.error) throw noShowResult.error;

  return {
    activeCount: activeResult.count ?? 0,
    noShowCount: noShowResult.count ?? 0,
    totalStudents: totalResult.count ?? 0,
  };
};

export const fetchQrPassesAll = async ({
  libraryId,
  search,
  status,
  batchSize = 500,
}: {
  libraryId: string | null;
  search: string;
  status: QrPassStatusFilter;
  batchSize?: number;
}): Promise<QrPassListItem[]> => {
  if (!libraryId) return [];

  const trimmedSearch = search.trim();
  const collected: QrPassListItem[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("students")
      .select("id, full_name, phone, qr_code, seat_number, plan, status, no_show_days, slot, slot_id, expiry_date, photo_thumbnail_path, photo_version, photo_url")
      .eq("library_id", libraryId)
      .order("full_name", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (trimmedSearch) {
      const pattern = `%${escapeIlikeValue(trimmedSearch)}%`;
      query = query.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`);
    }

    query = applyMembershipStatusFilter(query, status);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as QrPassListItem[];
    collected.push(...rows);
    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  return collected;
};

export const fetchLibraryCardBrand = async (libraryId: string | null): Promise<LibraryCardBrand | null> => {
  if (!libraryId) return null;

  const { data, error } = await supabase
    .from("libraries")
    .select("id, logo_url, name, library_name, primary_color")
    .eq("id", libraryId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
};
