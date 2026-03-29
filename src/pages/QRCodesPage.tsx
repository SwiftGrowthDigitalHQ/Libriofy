import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, QrCode, Search } from "lucide-react";

import {
  QR_PASS_PAGE_SIZE_OPTIONS,
  fetchQrPassesPage,
  fetchQrPassesSummary,
  type QrPassPageSize,
  type QrPassStatusFilter,
} from "@/api/qrPasses";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import StudentQRCard from "@/components/dashboard/StudentQRCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE: QrPassPageSize = 12;

const buildPageItems = (currentPage: number, totalPages: number) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const;
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages] as const;
};

const QRCodesPage = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QrPassStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<QrPassPageSize>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const debouncedSearch = useDebouncedValue(search, 300);
  const gridTopRef = useRef<HTMLDivElement | null>(null);
  const hasMountedPaginationRef = useRef(false);

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["my-libraries-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const summaryQuery = useQuery({
    queryKey: ["students-qr-summary", resolvedLibraryId],
    queryFn: () => fetchQrPassesSummary(resolvedLibraryId),
    enabled: !!resolvedLibraryId,
    staleTime: 30_000,
  });

  const qrPassesQuery = useQuery({
    queryKey: ["students-qr", resolvedLibraryId, page, limit, debouncedSearch, statusFilter],
    queryFn: () =>
      fetchQrPassesPage({
        libraryId: resolvedLibraryId,
        limit,
        page,
        search: debouncedSearch,
        status: statusFilter,
      }),
    enabled: !!resolvedLibraryId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    setPage(1);
  }, [limit, search, statusFilter]);

  useEffect(() => {
    setTotalCount(qrPassesQuery.data?.total ?? 0);
  }, [qrPassesQuery.data?.total]);

  const totalPages = qrPassesQuery.data?.totalPages ?? 1;

  useEffect(() => {
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!hasMountedPaginationRef.current) {
      hasMountedPaginationRef.current = true;
      return;
    }

    gridTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [page]);

  const students = qrPassesQuery.data?.data ?? [];
  const loading = roleLibraryLoading || fallbackLoading || qrPassesQuery.isLoading;
  const isUpdatingPage = qrPassesQuery.isFetching && !qrPassesQuery.isLoading;
  const summary = summaryQuery.data ?? {
    activeCount: 0,
    noShowCount: 0,
    totalStudents: 0,
  };

  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(page * limit, totalCount);

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setPage(nextPage);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">QR Passes</h2>
          <p className="mt-1 text-sm text-muted-foreground">Student digital seat passes with QR codes</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatsCard
            icon={QrCode}
            title="Total Students"
            value={summaryQuery.isLoading && resolvedLibraryId ? "--" : String(summary.totalStudents)}
            trend="up"
          />
          <StatsCard
            icon={QrCode}
            title="Active"
            value={summaryQuery.isLoading && resolvedLibraryId ? "--" : String(summary.activeCount)}
            trend="up"
            iconColor="text-success"
          />
          <StatsCard
            icon={AlertTriangle}
            title="At Risk (2+ days)"
            value={summaryQuery.isLoading && resolvedLibraryId ? "--" : String(summary.noShowCount)}
            trend="down"
            iconColor="text-warning"
          />
        </div>

        <div ref={gridTopRef} className="flex flex-col gap-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by student name or phone"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-[180px]">
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as QrPassStatusFilter)}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {isUpdatingPage ? (
            <p className="text-sm text-muted-foreground">Updating QR passes...</p>
          ) : null}
        </div>

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-destructive">Library not linked to your account. Please check user role setup.</p>
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading QR passes...</p>
        ) : qrPassesQuery.isError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-destructive">Unable to load QR passes: {getSafeErrorMessage(qrPassesQuery.error)}</p>
            </CardContent>
          </Card>
        ) : students.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="font-medium text-foreground">No QR passes found</p>
              <p className="mt-2 text-sm text-muted-foreground">Try changing the search or status filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {students.map((student) => (
                <StudentQRCard
                  key={student.id}
                  studentName={student.full_name}
                  qrCode={student.qr_code}
                  seatNumber={student.seat_number || undefined}
                  plan={student.plan || undefined}
                  status={student.status}
                />
              ))}
            </div>

            <div className="border-t border-border/70 px-4 py-5">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
                  <p className="text-sm text-muted-foreground">
                    Showing <span className="font-semibold text-foreground">{rangeStart}-{rangeEnd}</span> of{" "}
                    <span className="font-semibold text-foreground">{totalCount.toLocaleString("en-IN")}</span> students
                  </p>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page</span>
                    <div className="w-[96px]">
                      <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value) as QrPassPageSize)}>
                        <SelectTrigger className="h-9 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {QR_PASS_PAGE_SIZE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {totalPages > 1 ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" variant="outline" className="rounded-xl" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                      Previous
                    </Button>

                    {pageItems.map((item, index) =>
                      item === "ellipsis" ? (
                        <span key={`ellipsis-${index}`} className="px-1 text-sm text-muted-foreground">
                          ...
                        </span>
                      ) : (
                        <Button
                          key={item}
                          type="button"
                          variant="outline"
                          className={cn(
                            "min-w-10 rounded-xl px-3",
                            item === page && "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                          )}
                          onClick={() => handlePageChange(item)}
                        >
                          {item}
                        </Button>
                      ),
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      disabled={page >= totalPages}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default QRCodesPage;
