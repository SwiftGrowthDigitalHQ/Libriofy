import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInDays, format, isToday, isYesterday, parseISO } from "date-fns";
import { AlertTriangle, Bell, CalendarClock, CheckCircle, Copy, RefreshCw, Search } from "lucide-react";

import {
  RENEWAL_PAGE_SIZE_OPTIONS,
  RENEWAL_REMINDER_LOGS_BATCH_SIZE,
  fetchLatestRenewalReminderLogs,
  fetchRenewalReminderLogsPage,
  fetchRenewalsOverview,
  fetchRenewalsPage,
  runRenewalReminderScan,
  type ReminderLogStatusFilter,
  type ReminderLogWithStudent,
  type RenewalPageSize,
  type RenewalReminderScanResponse,
  type RenewalStatusFilter,
  type StudentRenewalRow,
} from "@/api/renewals";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { buildPublicAppUrl } from "@/lib/publicAppUrl";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE: RenewalPageSize = 20;
const REMINDER_LOG_POLL_INTERVAL_MS = 45_000;

type StudentWithDerived = StudentRenewalRow & {
  daysToExpiry: number | null;
  isActive: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean;
};

type ReminderLogGroup = {
  label: "Older" | "Today" | "Yesterday";
  logs: ReminderLogWithStudent[];
};

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

const getErrorMessage = (error: unknown): string => getSafeErrorMessage(error);

const getReminderLogTimestamp = (log: ReminderLogWithStudent) => new Date(log.sent_at || log.created_at).getTime();

const mergeReminderLogs = (...collections: ReminderLogWithStudent[][]) => {
  const uniqueLogs = new Map<string, ReminderLogWithStudent>();

  collections
    .flat()
    .filter(Boolean)
    .sort((leftLog, rightLog) => getReminderLogTimestamp(rightLog) - getReminderLogTimestamp(leftLog))
    .forEach((log) => {
      if (!uniqueLogs.has(log.id)) {
        uniqueLogs.set(log.id, log);
      }
    });

  return Array.from(uniqueLogs.values());
};

const canExpandReminderMessage = (message: string | null) => {
  if (!message) return false;

  const trimmedMessage = message.trim();
  return trimmedMessage.length > 140 || trimmedMessage.includes("\n");
};

const RenewalsPage = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RenewalStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<RenewalPageSize>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [renewTarget, setRenewTarget] = useState<StudentRenewalRow | null>(null);
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("");
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [logStatusFilter, setLogStatusFilter] = useState<ReminderLogStatusFilter>("all");
  const [pendingLatestLogs, setPendingLatestLogs] = useState<ReminderLogWithStudent[]>([]);
  const [manualLatestLogs, setManualLatestLogs] = useState<ReminderLogWithStudent[]>([]);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const debouncedSearch = useDebouncedValue(search, 300);
  const tableTopRef = useRef<HTMLDivElement | null>(null);
  const reminderLogListRef = useRef<HTMLDivElement | null>(null);
  const hasMountedPaginationRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{ id: string; top: number } | null>(null);

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

  const overviewQuery = useQuery({
    queryKey: ["renewal-overview", resolvedLibraryId],
    queryFn: () => fetchRenewalsOverview(resolvedLibraryId),
    enabled: !!resolvedLibraryId,
    staleTime: 30_000,
  });

  const renewalsQuery = useQuery({
    queryKey: ["students-renewals", resolvedLibraryId, page, limit, debouncedSearch, statusFilter],
    queryFn: () =>
      fetchRenewalsPage({
        filter: statusFilter,
        libraryId: resolvedLibraryId,
        limit,
        page,
        search: debouncedSearch,
      }),
    enabled: !!resolvedLibraryId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const reminderLogsQuery = useInfiniteQuery({
    queryKey: ["renewal-reminder-logs", resolvedLibraryId, logStatusFilter],
    queryFn: ({ pageParam }) =>
      fetchRenewalReminderLogsPage({
        cursor: pageParam,
        filter: logStatusFilter,
        libraryId: resolvedLibraryId,
        limit: RENEWAL_REMINDER_LOGS_BATCH_SIZE,
      }),
    enabled: !!resolvedLibraryId,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    staleTime: 30_000,
  });

  const baseReminderLogs = useMemo(
    () => mergeReminderLogs(reminderLogsQuery.data?.pages.flatMap((logsPage) => logsPage.data) ?? []),
    [reminderLogsQuery.data],
  );

  const displayedReminderLogs = useMemo(() => mergeReminderLogs(manualLatestLogs, baseReminderLogs), [baseReminderLogs, manualLatestLogs]);
  const baseReminderLogIds = useMemo(() => new Set(baseReminderLogs.map((log) => log.id)), [baseReminderLogs]);

  const latestReminderLogsQuery = useQuery({
    queryKey: ["renewal-reminder-logs-latest", resolvedLibraryId, logStatusFilter, displayedReminderLogs[0]?.created_at ?? "initial"],
    queryFn: () =>
      fetchLatestRenewalReminderLogs({
        after: displayedReminderLogs[0]?.created_at ?? null,
        filter: logStatusFilter,
        libraryId: resolvedLibraryId,
        limit: RENEWAL_REMINDER_LOGS_BATCH_SIZE,
      }),
    enabled: !!resolvedLibraryId && !reminderLogsQuery.isLoading,
    refetchInterval: REMINDER_LOG_POLL_INTERVAL_MS,
    staleTime: 0,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, limit, statusFilter]);

  useEffect(() => {
    setTotalCount(renewalsQuery.data?.total ?? 0);
  }, [renewalsQuery.data?.total]);

  useEffect(() => {
    if (page <= (renewalsQuery.data?.totalPages ?? 1)) return;
    setPage(renewalsQuery.data?.totalPages ?? 1);
  }, [page, renewalsQuery.data?.totalPages]);

  useEffect(() => {
    if (!hasMountedPaginationRef.current) {
      hasMountedPaginationRef.current = true;
      return;
    }

    tableTopRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [page]);

  useEffect(() => {
    setLoadMoreError(null);
  }, [resolvedLibraryId]);

  useEffect(() => {
    setLoadMoreError(null);
    setPendingLatestLogs([]);
    setManualLatestLogs([]);
    setExpandedMessages({});
  }, [logStatusFilter, resolvedLibraryId]);

  useEffect(() => {
    const latestLogs = latestReminderLogsQuery.data ?? [];

    if (latestLogs.length === 0) {
      return;
    }

    setPendingLatestLogs((previousLogs) => {
      const knownIds = new Set([...displayedReminderLogs, ...previousLogs].map((log) => log.id));
      const unseenLogs = latestLogs.filter((log) => !knownIds.has(log.id));

      if (unseenLogs.length === 0) {
        return previousLogs;
      }

      return mergeReminderLogs(unseenLogs, previousLogs);
    });
  }, [displayedReminderLogs, latestReminderLogsQuery.data]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current) {
      return;
    }

    const { id, top } = pendingScrollRestoreRef.current;
    const anchorElement = reminderLogListRef.current?.querySelector<HTMLElement>(`[data-log-id="${id}"]`);

    if (anchorElement) {
      const delta = anchorElement.getBoundingClientRect().top - top;

      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta });
      }
    }

    pendingScrollRestoreRef.current = null;
  }, [displayedReminderLogs]);

  const renewMutation = useMutation({
    mutationFn: async () => {
      if (!renewTarget) throw new Error("Please choose a student.");

      const { data, error } = await supabase.rpc("renew_student", {
        p_amount: parseFloat(amount || "0"),
        p_months: parseInt(months, 10),
        p_student_id: renewTarget.id,
      });

      if (error) throw error;
      return data as { error?: string; new_expiry?: string; success?: boolean } | null;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Renewed", description: `New expiry: ${result.new_expiry}` });
        setRenewTarget(null);
        setMonths("1");
        setAmount("");
        queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["renewal-overview", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs-latest", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      } else {
        toast({ title: "Unable to renew", description: result?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Renewal failed", description: error.message, variant: "destructive" });
    },
  });

  const scanRenewalsMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("No library selected.");
      return runRenewalReminderScan(resolvedLibraryId);
    },
    onSuccess: (result: RenewalReminderScanResponse | null) => {
      const reminderSummary = result?.results?.reminderDelivery;
      const scanSummary = result?.results?.renewalScan as
        | {
            expired_students?: number;
            library_owner_reminders_3day?: number;
            student_reminders_1day?: number;
            student_reminders_7day?: number;
            student_reminders_due_today?: number;
          }
        | null
        | undefined;

      if (reminderSummary) {
        toast({
          title: "Renewal scan completed",
          description:
            `${reminderSummary.sent ?? 0} sent, ${reminderSummary.failed ?? 0} failed, ${reminderSummary.skipped ?? 0} skipped` +
            (scanSummary
              ? `, ${
                  Number(scanSummary.student_reminders_7day ?? 0) +
                  Number(scanSummary.student_reminders_1day ?? 0) +
                  Number(scanSummary.student_reminders_due_today ?? 0) +
                  Number(scanSummary.library_owner_reminders_3day ?? 0)
                } queued`
              : ""),
        });
      } else {
        toast({ title: "Renewal scan completed" });
      }

      queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs-latest", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["library-notifications", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const retryFailedLogMutation = useMutation({
    mutationFn: async (logId: string) => {
      if (!resolvedLibraryId) throw new Error("No library selected.");

      return {
        logId,
        result: await runRenewalReminderScan(resolvedLibraryId),
      };
    },
    onSuccess: ({ logId }) => {
      toast({
        title: "Retry started",
        description: "Failed reminders are being retried through the reminder scan.",
      });
      queryClient.invalidateQueries({ queryKey: ["renewal-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-reminder-logs-latest", resolvedLibraryId] });
      setExpandedMessages((previous) => {
        if (!previous[logId]) return previous;

        const next = { ...previous };
        delete next[logId];
        return next;
      });
    },
    onError: (error: Error) => {
      toast({ title: "Retry failed", description: error.message, variant: "destructive" });
    },
  });

  const students = renewalsQuery.data?.data ?? [];
  const studentsWithState = useMemo((): StudentWithDerived[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return students.map((student) => {
      const daysToExpiry = student.expiry_date ? differenceInDays(parseISO(student.expiry_date), today) : null;
      const isExpired = student.status === "expired" || (daysToExpiry !== null && daysToExpiry < 0);
      const isExpiringSoon = !isExpired && daysToExpiry !== null && daysToExpiry <= 7 && daysToExpiry >= 0;
      const isActive = !isExpired && student.status === "active";

      return {
        ...student,
        daysToExpiry,
        isActive,
        isExpired,
        isExpiringSoon,
      };
    });
  }, [students]);

  const totalPages = renewalsQuery.data?.totalPages ?? 1;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(page * limit, totalCount);
  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);

  const overview = overviewQuery.data ?? {
    activeCount: 0,
    dueTodayCount: 0,
    expiredCount: 0,
    expiringSoonCount: 0,
    remindersFailed: 0,
    remindersPending: 0,
    remindersSentToday: 0,
  };

  const tableLoading = roleLibraryLoading || fallbackLoading || renewalsQuery.isLoading;
  const tableUpdating = renewalsQuery.isFetching && !renewalsQuery.isLoading;
  const reminderLogsInitialLoading = reminderLogsQuery.isLoading;
  const reminderLogsInitialError = reminderLogsQuery.isError && displayedReminderLogs.length === 0;
  const manualLatestOnlyCount = manualLatestLogs.filter((log) => !baseReminderLogIds.has(log.id)).length;
  const reminderLogsTotalCount = (reminderLogsQuery.data?.pages[0]?.totalCount ?? 0) + manualLatestOnlyCount + pendingLatestLogs.length;
  const reminderLogsLoadedCount = displayedReminderLogs.length;
  const reminderLogsHasMore = reminderLogsLoadedCount < reminderLogsTotalCount;
  const reminderLogsFetchingMore = reminderLogsQuery.isFetchingNextPage;

  useEffect(() => {
    console.log({
      totalLogs: reminderLogsTotalCount,
      loadedLogs: reminderLogsLoadedCount,
      hasMore: reminderLogsHasMore,
    });
  }, [reminderLogsHasMore, reminderLogsLoadedCount, reminderLogsTotalCount]);

  const groupedReminderLogs = useMemo<ReminderLogGroup[]>(() => {
    const groupedLogs: Record<ReminderLogGroup["label"], ReminderLogWithStudent[]> = {
      Older: [],
      Today: [],
      Yesterday: [],
    };

    displayedReminderLogs.forEach((log) => {
      const logDate = new Date(log.sent_at || log.created_at);

      if (isToday(logDate)) {
        groupedLogs.Today.push(log);
        return;
      }

      if (isYesterday(logDate)) {
        groupedLogs.Yesterday.push(log);
        return;
      }

      groupedLogs.Older.push(log);
    });

    return (["Today", "Yesterday", "Older"] as const)
      .filter((label) => groupedLogs[label].length > 0)
      .map((label) => ({
        label,
        logs: groupedLogs[label],
      }));
  }, [displayedReminderLogs]);

  const getExpiryBadge = (student: StudentWithDerived) => {
    if (student.isExpired) return <Badge variant="destructive">Expired</Badge>;
    if (student.daysToExpiry === null) return <Badge variant="outline">No expiry</Badge>;
    if (student.daysToExpiry === 0) return <Badge className="bg-destructive/80 text-destructive-foreground">Today</Badge>;
    if (student.daysToExpiry === 1) return <Badge className="bg-destructive/80 text-destructive-foreground">Tomorrow</Badge>;
    if (student.daysToExpiry <= 3) return <Badge className="bg-warning text-warning-foreground">{student.daysToExpiry}d left</Badge>;
    if (student.daysToExpiry <= 7) return <Badge variant="secondary">{student.daysToExpiry}d left</Badge>;
    return <Badge variant="outline">{student.daysToExpiry}d left</Badge>;
  };

  const getReminderStageLabel = (type: string) => {
    if (type === "renewal_7day") return "7 days before";
    if (type === "renewal_1day") return "1 day before";
    if (type === "renewal_due_today") return "Expiry day";
    if (type === "subscription_reminder_3day") return "Library plan - 3 days before";
    return type;
  };

  const getNotificationIcon = (type: string) => {
    if (type === "renewal_due_today") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    if (type === "renewal_1day") return <Bell className="h-3.5 w-3.5 text-warning" />;
    if (type === "subscription_reminder_3day") return <RefreshCw className="h-3.5 w-3.5 text-primary" />;
    return <CalendarClock className="h-3.5 w-3.5 text-primary" />;
  };

  const getDeliveryBadge = (status: string) => {
    if (status === "sent") return <Badge className="bg-success/10 text-success hover:bg-success/10">Sent</Badge>;
    if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
    if (status === "skipped") return <Badge variant="secondary">Skipped</Badge>;
    return <Badge variant="outline">Queued</Badge>;
  };

  const getChannelBadge = (channel: string | null) => {
    if (!channel) return <Badge variant="outline">Pending</Badge>;
    if (channel === "whatsapp") return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">WhatsApp</Badge>;
    if (channel === "sms") return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">SMS</Badge>;
    if (channel === "webhook") return <Badge variant="secondary">Webhook</Badge>;
    return <Badge variant="outline">{channel}</Badge>;
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setPage(nextPage);
  };

  const handleLoadLatestLogs = () => {
    if (pendingLatestLogs.length === 0) {
      return;
    }

    const firstVisibleLog = reminderLogListRef.current?.querySelector<HTMLElement>("[data-log-id]");

    if (firstVisibleLog?.dataset.logId) {
      pendingScrollRestoreRef.current = {
        id: firstVisibleLog.dataset.logId,
        top: firstVisibleLog.getBoundingClientRect().top,
      };
    }

    setManualLatestLogs((previousLogs) => mergeReminderLogs(pendingLatestLogs, previousLogs));
    setPendingLatestLogs([]);
  };

  const handleLoadMoreLogs = async () => {
    setLoadMoreError(null);

    try {
      if (reminderLogsQuery.hasNextPage) {
        await reminderLogsQuery.fetchNextPage();
        return;
      }

      if (pendingLatestLogs.length > 0) {
        handleLoadLatestLogs();
      }
    } catch (error) {
      setLoadMoreError(getErrorMessage(error));
    }
  };

  const handleToggleMessage = (logId: string) => {
    setExpandedMessages((previous) => ({
      ...previous,
      [logId]: !previous[logId],
    }));
  };

  const copyRenewalLink = async (student: StudentRenewalRow) => {
    const renewalUrl = buildPublicAppUrl(`/renew/${student.qr_code}`);

    try {
      await navigator.clipboard.writeText(renewalUrl);
      toast({ title: "Renewal link copied", description: `${student.full_name}'s renewal page URL is ready to share.` });
    } catch {
      toast({ title: "Copy failed", description: "Unable to copy renewal link.", variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-foreground">Renewals</h2>
            <p className="mt-1 text-sm text-muted-foreground">Track memberships, send WhatsApp/SMS reminders, and process renewals</p>
          </div>

          <Button variant="outline" onClick={() => scanRenewalsMutation.mutate()} disabled={scanRenewalsMutation.isPending || !resolvedLibraryId}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", scanRenewalsMutation.isPending && "animate-spin")} />
            {scanRenewalsMutation.isPending ? "Scanning..." : "Run Reminder Scan"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatsCard
            icon={CheckCircle}
            title="Active"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.activeCount)}
            trend="up"
            iconColor="text-success"
          />
          <StatsCard
            icon={CalendarClock}
            title="Expiring (7d)"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.expiringSoonCount)}
            trend="down"
            iconColor="text-warning"
          />
          <StatsCard
            icon={Bell}
            title="Due Today"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.dueTodayCount)}
            trend="down"
            iconColor="text-destructive"
          />
          <StatsCard
            icon={Bell}
            title="Sent Today"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.remindersSentToday)}
            trend="up"
            iconColor="text-primary"
          />
          <StatsCard
            icon={AlertTriangle}
            title="Expired"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.expiredCount)}
            trend="down"
            iconColor="text-destructive"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div ref={tableTopRef} className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <CardTitle className="text-lg font-display">Membership Status</CardTitle>

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative w-full lg:w-64">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="Search by name or phone"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>

                    <div className="w-full lg:w-[160px]">
                      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as RenewalStatusFilter)}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="All students" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All students</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
                          <SelectItem value="expiring_soon">Expiring soon</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="no_expiry">No expiry</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-full lg:w-[120px]">
                      <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value) as RenewalPageSize)}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RENEWAL_PAGE_SIZE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option} rows
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                {tableUpdating ? <p className="mb-3 text-sm text-muted-foreground">Updating renewals...</p> : null}

                {!resolvedLibraryId && !tableLoading ? (
                  <p className="py-8 text-center text-sm text-destructive">Library not linked to your account. Please check user role setup.</p>
                ) : tableLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading renewals...</p>
                ) : renewalsQuery.isError ? (
                  <p className="py-8 text-center text-sm text-destructive">Unable to load renewals: {getErrorMessage(renewalsQuery.error)}</p>
                ) : studentsWithState.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No students found</p>
                ) : (
                  <div className="space-y-5">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Student</TableHead>
                            <TableHead className="hidden sm:table-cell">Plan</TableHead>
                            <TableHead>Expiry</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {studentsWithState.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell>
                                <p className="font-medium text-foreground">{student.full_name}</p>
                                <p className="text-xs text-muted-foreground">{student.seat_number ? `Seat ${student.seat_number}` : "No seat"}</p>
                              </TableCell>
                              <TableCell className="hidden text-muted-foreground sm:table-cell">{student.plan || "-"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {student.expiry_date ? format(parseISO(student.expiry_date), "dd MMM yyyy") : "-"}
                              </TableCell>
                              <TableCell>{getExpiryBadge(student)}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="ghost" onClick={() => copyRenewalLink(student)}>
                                    <Copy className="mr-1 h-3.5 w-3.5" /> Link
                                  </Button>

                                  <Dialog open={renewTarget?.id === student.id} onOpenChange={(open) => !open && setRenewTarget(null)}>
                                    <DialogTrigger asChild>
                                      <Button size="sm" variant="outline" onClick={() => setRenewTarget(student)}>
                                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Renew
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                      <DialogHeader>
                                        <DialogTitle className="font-display">Renew {student.full_name}</DialogTitle>
                                      </DialogHeader>

                                      <div className="space-y-4 pt-2">
                                        <div className="rounded-lg bg-secondary p-3 text-sm">
                                          <p>
                                            <span className="text-muted-foreground">Current plan:</span> {student.plan || "N/A"}
                                          </p>
                                          <p>
                                            <span className="text-muted-foreground">Current expiry:</span>{" "}
                                            {student.expiry_date ? format(parseISO(student.expiry_date), "dd MMM yyyy") : "Not set"}
                                          </p>
                                        </div>

                                        <div className="space-y-2">
                                          <Label>Renewal Period</Label>
                                          <Select value={months} onValueChange={setMonths}>
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="1">1 Month</SelectItem>
                                              <SelectItem value="3">3 Months</SelectItem>
                                              <SelectItem value="6">6 Months</SelectItem>
                                              <SelectItem value="12">12 Months</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        <div className="space-y-2">
                                          <Label>Amount (INR)</Label>
                                          <Input type="number" placeholder="3500" value={amount} onChange={(event) => setAmount(event.target.value)} />
                                        </div>

                                        <Button className="w-full" disabled={renewMutation.isPending || !renewTarget} onClick={() => renewMutation.mutate()}>
                                          {renewMutation.isPending ? "Processing..." : "Confirm Renewal"}
                                        </Button>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="border-t border-border/70 px-4 pt-5">
                      <div className="flex flex-col items-center gap-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Showing <span className="font-semibold text-foreground">{rangeStart}-{rangeEnd}</span> of{" "}
                          <span className="font-semibold text-foreground">{totalCount.toLocaleString("en-IN")}</span> students
                        </p>

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
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-lg font-display">
                    <Bell className="h-5 w-5 text-primary" />
                    Reminder Delivery Log
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {overview.remindersSentToday} sent today, {overview.remindersPending} queued, {overview.remindersFailed} failed
                  </p>
                </div>

                <div className="w-full">
                  <Select value={logStatusFilter} onValueChange={(value) => setLogStatusFilter(value as ReminderLogStatusFilter)}>
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="All logs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {reminderLogsInitialLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Loading reminders...</p>
              ) : reminderLogsInitialError ? (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-sm text-destructive">Failed to load logs</p>
                  <p className="text-xs text-muted-foreground">{getErrorMessage(reminderLogsQuery.error)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => reminderLogsQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : displayedReminderLogs.length === 0 && pendingLatestLogs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No reminders sent yet</p>
              ) : (
                <div className="space-y-3">
                  {pendingLatestLogs.length > 0 ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-medium text-foreground">
                          {pendingLatestLogs.length} new {pendingLatestLogs.length === 1 ? "log" : "logs"} available
                        </p>
                        <Button type="button" size="sm" onClick={handleLoadLatestLogs}>
                          Load latest
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div ref={reminderLogListRef} className="space-y-4">
                    {groupedReminderLogs.map((group) => (
                      <div key={group.label} className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-border/70" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{group.label}</p>
                          <div className="h-px flex-1 bg-border/70" />
                        </div>

                        {group.logs.map((log) => {
                          const expanded = Boolean(expandedMessages[log.id]);
                          const shouldExpand = canExpandReminderMessage(log.message);

                          return (
                            <div key={log.id} data-log-id={log.id} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                              <div
                                className={cn(
                                  "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full",
                                  log.reminder_type === "renewal_due_today" ? "bg-destructive/10" : "bg-primary/10",
                                )}
                              >
                                {getNotificationIcon(log.reminder_type)}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {log.student?.full_name || (log.reminder_type === "subscription_reminder_3day" ? "Library owner" : "Student")}
                                  </p>
                                  {getDeliveryBadge(log.status)}
                                  {getChannelBadge(log.delivery_channel)}
                                </div>

                                <p className="text-xs text-muted-foreground">
                                  {getReminderStageLabel(log.reminder_type)}
                                  {log.student?.seat_number ? ` - Seat ${log.student.seat_number}` : ""}
                                </p>
                                <p className="text-xs text-muted-foreground">{log.phone || log.student?.phone || "Phone number missing"}</p>
                                <p className={cn("mt-2 whitespace-pre-line text-xs text-muted-foreground", !expanded && "line-clamp-3")}>
                                  {log.message}
                                </p>

                                {shouldExpand ? (
                                  <button
                                    type="button"
                                    className="mt-1 text-xs font-medium text-primary transition hover:text-primary/80"
                                    onClick={() => handleToggleMessage(log.id)}
                                  >
                                    {expanded ? "Show less" : "Show more"}
                                  </button>
                                ) : null}

                                {log.error_message ? <p className="mt-2 text-xs text-destructive">{log.error_message}</p> : null}

                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs text-muted-foreground/60">{format(new Date(log.sent_at || log.created_at), "dd MMM, hh:mm a")}</p>

                                  {log.status === "failed" ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 rounded-lg px-3"
                                      disabled={retryFailedLogMutation.isPending || !resolvedLibraryId}
                                      onClick={() => retryFailedLogMutation.mutate(log.id)}
                                    >
                                      <RefreshCw className={cn("mr-2 h-3.5 w-3.5", retryFailedLogMutation.isPending && "animate-spin")} />
                                      {retryFailedLogMutation.isPending ? "Retrying..." : "Retry"}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {loadMoreError ? (
                    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                      <p className="text-sm text-destructive">Failed to load logs</p>
                      <p className="text-xs text-muted-foreground">{loadMoreError}</p>
                    </div>
                  ) : null}

                  <p className="text-center text-xs text-muted-foreground">
                    Showing {reminderLogsLoadedCount.toLocaleString("en-IN")} of {reminderLogsTotalCount.toLocaleString("en-IN")} logs
                  </p>

                  {reminderLogsHasMore ? (
                    <div className="flex justify-center pt-1">
                      <Button type="button" variant="outline" onClick={handleLoadMoreLogs} disabled={reminderLogsFetchingMore}>
                        <RefreshCw className={cn("mr-2 h-4 w-4", reminderLogsFetchingMore && "animate-spin")} />
                        {reminderLogsFetchingMore ? "Loading..." : "Load More"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">No more logs</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RenewalsPage;
