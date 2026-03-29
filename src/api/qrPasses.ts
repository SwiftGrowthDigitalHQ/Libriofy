import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const QR_PASS_PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
export type QrPassPageSize = (typeof QR_PASS_PAGE_SIZE_OPTIONS)[number];
export type QrPassStatusFilter = "all" | "active" | "expired";

export type QrPassListItem = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "full_name" | "id" | "no_show_days" | "phone" | "plan" | "qr_code" | "seat_number" | "status"
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
    .select("id, full_name, phone, qr_code, seat_number, plan, status, no_show_days", {
      count: "exact",
    })
    .eq("library_id", libraryId)
    .order("full_name", { ascending: true })
    .range(from, to);

  if (trimmedSearch) {
    const pattern = `%${escapeIlikeValue(trimmedSearch)}%`;
    query = query.or(`full_name.ilike.${pattern},phone.ilike.${pattern}`);
  }

  if (status !== "all") {
    query = query.eq("status", status);
  }

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
    supabase.from("students").select("id", { count: "exact", head: true }).eq("library_id", libraryId).eq("status", "active"),
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
