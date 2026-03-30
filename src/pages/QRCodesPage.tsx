import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, QrCode, Search, Sparkles } from "lucide-react";
import { format } from "date-fns";

import {
  QR_PASS_PAGE_SIZE_OPTIONS,
  fetchLibraryCardBrand,
  fetchQrPassesAll,
  fetchQrPassesPage,
  fetchQrPassesSummary,
  type QrPassPageSize,
  type QrPassListItem,
  type QrPassStatusFilter,
} from "@/api/qrPasses";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import StudentIdCard from "@/components/dashboard/StudentIdCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLibrarySubscription } from "@/hooks/useLibrarySubscription";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { downloadBulkIdCardZip, downloadIdCardPdf, downloadIdCardPng } from "@/lib/idCardExport";
import { formatTimeLabel } from "@/lib/seatUtils";
import { isPlanAtLeast, resolveSubscriptionPlanCode } from "@/lib/subscription";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE: QrPassPageSize = 12;
const STUDENT_PHOTO_BUCKET = "student-photos";

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
  const [cardVariant, setCardVariant] = useState<"digital" | "print">("digital");
  const [showVerifiedBadge, setShowVerifiedBadge] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [showLanyard, setShowLanyard] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [bulkExporting, setBulkExporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkStudents, setBulkStudents] = useState<QrPassListItem[]>([]);

  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const { data: subscription } = useLibrarySubscription();
  const debouncedSearch = useDebouncedValue(search, 300);
  const gridTopRef = useRef<HTMLDivElement | null>(null);
  const hasMountedPaginationRef = useRef(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const bulkRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const libraryQuery = useQuery({
    queryKey: ["qr-card-brand", resolvedLibraryId],
    queryFn: () => fetchLibraryCardBrand(resolvedLibraryId),
    enabled: !!resolvedLibraryId,
    staleTime: 60_000,
  });

  const slotsQuery = useQuery({
    queryKey: ["qr-card-slots", resolvedLibraryId],
    queryFn: async (): Promise<Array<{ id: string; name: string; start_time: string | null; end_time: string | null }>> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("time_slots")
        .select("id, name, start_time, end_time")
        .eq("library_id", resolvedLibraryId)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; start_time: string | null; end_time: string | null }>;
    },
    enabled: !!resolvedLibraryId,
    staleTime: 60_000,
  });

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
  const libraryBrand = libraryQuery.data;
  const libraryName = libraryBrand?.library_name || libraryBrand?.name || "Library";
  const libraryLogoUrl = libraryBrand?.logo_url ?? null;
  const brandColor = libraryBrand?.primary_color ?? null;
  const planCode = resolveSubscriptionPlanCode(subscription);
  const isPro = isPlanAtLeast(planCode, "pro");
  const slotsById = useMemo(() => new Map((slotsQuery.data ?? []).map((slot) => [slot.id, slot])), [slotsQuery.data]);
  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(page * limit, totalCount);

  const resolveSlotLabel = (slotId?: string | null, slotLabel?: string | null) => {
    if (slotId && slotsById.has(slotId)) {
      const slot = slotsById.get(slotId);
      const start = slot?.start_time ? formatTimeLabel(slot.start_time) : "";
      const end = slot?.end_time ? formatTimeLabel(slot.end_time) : "";
      const range = start && end ? `${start} - ${end}` : "";
      return `${slot?.name}${range ? ` (${range})` : ""}`;
    }
    return slotLabel || "";
  };

  const resolvePhotoUrl = (student: typeof students[number]) => {
    if (student.photo_thumbnail_path) {
      const { data } = supabase.storage.from(STUDENT_PHOTO_BUCKET).getPublicUrl(student.photo_thumbnail_path);
      return student.photo_version ? `${data.publicUrl}?v=${student.photo_version}` : data.publicUrl;
    }
    if (student.photo_url) {
      return student.photo_version ? `${student.photo_url}?v=${student.photo_version}` : student.photo_url;
    }
    return null;
  };

  const buildQrValue = (qrCode: string) => {
    const base = window.location.origin;
    return `${base}/student/${qrCode}`;
  };

  const handleDownloadPng = async (studentId: string, studentName: string) => {
    const node = cardRefs.current[studentId];
    if (!node) return;
    setExportingId(studentId);
    try {
      await downloadIdCardPng(node, `${studentName}-id-card`);
    } finally {
      setExportingId(null);
    }
  };

  const handleDownloadPdf = async (studentId: string, studentName: string) => {
    const node = cardRefs.current[studentId];
    if (!node) return;
    setExportingId(studentId);
    try {
      await downloadIdCardPdf(node, `${studentName}-id-card`);
    } finally {
      setExportingId(null);
    }
  };

  const handleBulkDownload = async () => {
    if (!resolvedLibraryId || bulkExporting) return;
    setBulkExporting(true);
    setBulkProgress(0);
    try {
      const allStudents = await fetchQrPassesAll({
        libraryId: resolvedLibraryId,
        search,
        status: statusFilter,
      });
      setBulkStudents(allStudents);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const items = allStudents
        .map((student) => ({
          name: `${student.full_name}-${student.seat_number || "seat"}`,
          node: bulkRefs.current[student.id],
        }))
        .filter((item): item is { name: string; node: HTMLElement } => !!item.node);
      await downloadBulkIdCardZip({
        items,
        zipName: `${libraryName}-id-cards`,
        onProgress: setBulkProgress,
      });
    } finally {
      setBulkStudents([]);
      setBulkProgress(0);
      setBulkExporting(false);
    }
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setPage(nextPage);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">Smart Student ID Cards</h2>
          <p className="mt-1 text-sm text-muted-foreground">Branded ID cards with QR verification, printable PDFs, and mobile wallet views.</p>
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
              <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Print preview</span>
                <Switch
                  checked={cardVariant === "print"}
                  onCheckedChange={(value) => setCardVariant(value ? "print" : "digital")}
                />
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Verified badge</span>
                <Switch
                  checked={showVerifiedBadge}
                  onCheckedChange={(value) => setShowVerifiedBadge(value)}
                  disabled={!isPro}
                />
                {!isPro ? <Sparkles className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Watermark</span>
                <Switch checked={showWatermark} onCheckedChange={(value) => setShowWatermark(value)} disabled={!isPro} />
                {!isPro ? <Sparkles className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Lanyard</span>
                <Switch checked={showLanyard} onCheckedChange={(value) => setShowLanyard(value)} />
              </div>

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

              <Button
                variant="outline"
                className="rounded-2xl"
                disabled={bulkExporting || loading || students.length === 0}
                onClick={handleBulkDownload}
              >
                <Download className="mr-2 h-4 w-4" />
                {bulkExporting ? `Preparing ZIP ${bulkProgress}%` : "Bulk Download ZIP (PDF)"}
              </Button>
            </div>
          </div>

          {isUpdatingPage ? (
            <p className="text-sm text-muted-foreground">Updating ID cards...</p>
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
          <p className="py-8 text-center text-sm text-muted-foreground">Loading student ID cards...</p>
        ) : qrPassesQuery.isError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-destructive">Unable to load ID cards: {getSafeErrorMessage(qrPassesQuery.error)}</p>
            </CardContent>
          </Card>
        ) : students.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="font-medium text-foreground">No ID cards found</p>
              <p className="mt-2 text-sm text-muted-foreground">Try changing the search or status filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {students.map((student) => (
                <div key={student.id} className="space-y-3">
                  <StudentIdCard
                    ref={(node) => {
                      cardRefs.current[student.id] = node;
                    }}
                    studentName={student.full_name}
                    libraryName={libraryName}
                    libraryLogoUrl={libraryLogoUrl}
                    brandColor={brandColor}
                    qrValue={buildQrValue(student.qr_code)}
                    seatNumber={student.seat_number}
                    plan={student.plan}
                    timeSlot={resolveSlotLabel(student.slot_id, student.slot)}
                    expiryLabel={student.expiry_date ? format(new Date(student.expiry_date), "dd MMM yyyy") : "--"}
                    status={student.status}
                    photoUrl={resolvePhotoUrl(student)}
                    showVerifiedBadge={showVerifiedBadge && isPro}
                    showWatermark={showWatermark && isPro}
                    showLanyard={showLanyard}
                    variant={cardVariant}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-xl"
                      disabled={exportingId === student.id}
                      onClick={() => handleDownloadPng(student.id, student.full_name)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" /> PNG
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-xl"
                      disabled={exportingId === student.id}
                      onClick={() => handleDownloadPdf(student.id, student.full_name)}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
                    </Button>
                  </div>
                </div>
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

      {bulkStudents.length > 0 ? (
        <div className="absolute left-[-9999px] top-0 space-y-4">
          {bulkStudents.map((student) => (
            <StudentIdCard
              key={student.id}
              ref={(node) => {
                bulkRefs.current[student.id] = node;
              }}
              studentName={student.full_name ?? "Student"}
              libraryName={libraryName}
              libraryLogoUrl={libraryLogoUrl}
              brandColor={brandColor}
              qrValue={buildQrValue(student.qr_code ?? "")}
              seatNumber={student.seat_number ?? null}
              plan={student.plan ?? null}
              timeSlot={resolveSlotLabel(student.slot_id ?? null, student.slot ?? null)}
              expiryLabel={student.expiry_date ? format(new Date(student.expiry_date), "dd MMM yyyy") : "--"}
              status={student.status ?? "active"}
              photoUrl={resolvePhotoUrl(student)}
              showVerifiedBadge={showVerifiedBadge && isPro}
              showWatermark={showWatermark && isPro}
              showLanyard={showLanyard}
              variant={cardVariant}
            />
          ))}
        </div>
      ) : null}
    </DashboardLayout>
  );
};

export default QRCodesPage;
