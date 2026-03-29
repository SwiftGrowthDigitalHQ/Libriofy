import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isPast } from "date-fns";
import {
  ListOrdered,
  UserPlus,
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { STUDENT_GENDER_OPTIONS, formatStudentGender, getStudentGenderBadgeClassName, type StudentGender } from "@/lib/studentGender";

type WaitingEntry = Database["public"]["Tables"]["waiting_list"]["Row"];
type TimeSlotOption = Pick<Database["public"]["Tables"]["time_slots"]["Row"], "id" | "name">;
type PlanOption = Pick<Database["public"]["Tables"]["plans"]["Row"], "id" | "name">;
type WaitingListStatusFilter = "all" | "waiting" | "notified" | "confirmed" | "expired";

type WaitingListOverviewResponse = {
  confirmedCount: number;
  expiredCount: number;
  inQueueCount: number;
  notifiedCount: number;
};

type WaitingListPageResponse = {
  data: WaitingEntry[];
  page: number;
  total: number;
  totalPages: number;
};

const WAITING_LIST_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type WaitingListPageSize = (typeof WAITING_LIST_PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: WaitingListPageSize = 10;

type QueueResult = {
  success?: boolean;
  error?: string;
  position?: number;
  student_name?: string;
  student_id?: string;
  seat_number?: string | null;
  plan_name?: string | null;
  slot_names?: string[] | null;
};

const getErrorMessage = (error: unknown): string => getSafeErrorMessage(error);

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

const escapeIlikeValue = (value: string) => value.replace(/[%_]/g, (character) => `\\${character}`);

const fetchWaitingListPage = async ({
  filter,
  libraryId,
  limit,
  page,
  search,
}: {
  filter: WaitingListStatusFilter;
  libraryId: string | null;
  limit: number;
  page: number;
  search: string;
}): Promise<WaitingListPageResponse> => {
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

  let query = supabase.from("waiting_list").select("*", { count: "exact" }).eq("library_id", libraryId);

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    const pattern = `%${escapeIlikeValue(trimmedSearch)}%`;
    query = query.or(`student_name.ilike.${pattern},phone.ilike.${pattern}`);
  }

  const { data, error, count } = await query.order("created_at", { ascending: true }).range(from, to);

  if (error) {
    throw error;
  }

  const total = count ?? 0;

  return {
    data: data ?? [],
    page: safePage,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

const fetchWaitingListOverview = async (libraryId: string | null): Promise<WaitingListOverviewResponse> => {
  if (!libraryId) {
    return {
      confirmedCount: 0,
      expiredCount: 0,
      inQueueCount: 0,
      notifiedCount: 0,
    };
  }

  const [waitingResult, notifiedResult, confirmedResult, expiredResult] = await Promise.all([
    supabase.from("waiting_list").select("id", { count: "exact", head: true }).eq("library_id", libraryId).eq("status", "waiting"),
    supabase.from("waiting_list").select("id", { count: "exact", head: true }).eq("library_id", libraryId).eq("status", "notified"),
    supabase.from("waiting_list").select("id", { count: "exact", head: true }).eq("library_id", libraryId).eq("status", "confirmed"),
    supabase.from("waiting_list").select("id", { count: "exact", head: true }).eq("library_id", libraryId).eq("status", "expired"),
  ]);

  if (waitingResult.error) throw waitingResult.error;
  if (notifiedResult.error) throw notifiedResult.error;
  if (confirmedResult.error) throw confirmedResult.error;
  if (expiredResult.error) throw expiredResult.error;

  return {
    confirmedCount: confirmedResult.count ?? 0,
    expiredCount: expiredResult.count ?? 0,
    inQueueCount: waitingResult.count ?? 0,
    notifiedCount: notifiedResult.count ?? 0,
  };
};

const fetchNotifiedEntries = async (libraryId: string | null): Promise<WaitingEntry[]> => {
  if (!libraryId) {
    return [];
  }

  const { data, error } = await supabase
    .from("waiting_list")
    .select("*")
    .eq("library_id", libraryId)
    .eq("status", "notified")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
};

const WaitingListPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WaitingListStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<WaitingListPageSize>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    student_name: "",
    gender: "" as StudentGender | "",
    phone: "",
    email: "",
    preferred_slot: "",
    preferred_plan: "",
  });
  const debouncedSearch = useDebouncedValue(search, 300);
  const tableTopRef = useRef<HTMLDivElement | null>(null);
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

  const overviewQuery = useQuery({
    queryKey: ["waiting-list-overview", resolvedLibraryId],
    queryFn: () => fetchWaitingListOverview(resolvedLibraryId),
    enabled: !!resolvedLibraryId,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const entriesQuery = useQuery({
    queryKey: ["waiting-list", resolvedLibraryId, page, limit, debouncedSearch, statusFilter],
    queryFn: () =>
      fetchWaitingListPage({
        filter: statusFilter,
        libraryId: resolvedLibraryId,
        limit,
        page,
        search: debouncedSearch,
      }),
    enabled: !!resolvedLibraryId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 15000,
  });

  const notifiedEntriesQuery = useQuery({
    queryKey: ["waiting-list-notified", resolvedLibraryId],
    queryFn: () => fetchNotifiedEntries(resolvedLibraryId),
    enabled: !!resolvedLibraryId,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const { data: slots = [] } = useQuery({
    queryKey: ["waiting-list-slots", resolvedLibraryId],
    queryFn: async (): Promise<TimeSlotOption[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("time_slots")
        .select("id, name")
        .eq("library_id", resolvedLibraryId)
        .eq("is_active", true)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["waiting-list-plans", resolvedLibraryId],
    queryFn: async (): Promise<PlanOption[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("plans")
        .select("id, name")
        .eq("library_id", resolvedLibraryId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, limit, statusFilter]);

  useEffect(() => {
    setTotalCount(entriesQuery.data?.total ?? 0);
  }, [entriesQuery.data?.total]);

  useEffect(() => {
    if (page <= (entriesQuery.data?.totalPages ?? 1)) {
      return;
    }

    setPage(entriesQuery.data?.totalPages ?? 1);
  }, [entriesQuery.data?.totalPages, page]);

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

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      const { data, error } = await supabase.rpc("add_to_waiting_list", {
        p_library_id: resolvedLibraryId,
        p_student_name: form.student_name,
        p_gender: form.gender || undefined,
        p_phone: form.phone || null,
        p_email: form.email || null,
        p_preferred_slot: form.preferred_slot || null,
        p_preferred_plan: form.preferred_plan || null,
      });
      if (error) throw error;
      return data as QueueResult;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Added to queue", description: `Position #${result.position}` });
        setDialogOpen(false);
        setForm({ student_name: "", gender: "", phone: "", email: "", preferred_slot: "", preferred_plan: "" });
        queryClient.invalidateQueries({ queryKey: ["waiting-list", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["waiting-list-overview", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["waiting-list-notified", resolvedLibraryId] });
      } else {
        toast({ title: "Failed", description: result?.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      const { data, error } = await supabase.rpc("notify_next_in_queue", { p_library_id: resolvedLibraryId });
      if (error) throw error;
      return data as QueueResult;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Notified", description: `${result.student_name} has 10 minutes to confirm` });
      } else {
        toast({ title: "Queue empty", description: result?.error, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["waiting-list", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-notified", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.rpc("confirm_waiting_list", { p_entry_id: entryId });
      if (error) throw error;
      return data as QueueResult;
    },
    onSuccess: (result) => {
      if (result?.success) {
        const seatLabel = result.seat_number ? ` on seat ${result.seat_number}` : "";
        toast({
          title: "Student admitted",
          description: `${result.student_name} is now an active student${seatLabel}.`,
        });
      } else {
        toast({ title: "Failed", description: result?.error, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["waiting-list", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["student-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-qr", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["plans-page-student-count", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-notified", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase.from("waiting_list").update({ status: "cancelled" }).eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waiting-list", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-notified", resolvedLibraryId] });
      toast({ title: "Removed from queue" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const entries = entriesQuery.data?.data ?? [];
  const notifiedEntries = notifiedEntriesQuery.data ?? [];
  const overview = overviewQuery.data ?? {
    confirmedCount: 0,
    expiredCount: 0,
    inQueueCount: 0,
    notifiedCount: 0,
  };
  const totalPages = entriesQuery.data?.totalPages ?? 1;
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(page * limit, totalCount);
  const pageItems = useMemo(() => buildPageItems(page, totalPages), [page, totalPages]);

  const getStatusBadge = (entry: WaitingEntry) => {
    if (entry.status === "waiting") {
      return (
        <Badge variant="secondary">
          <Clock className="w-3 h-3 mr-1" /> Queue #{entry.position}
        </Badge>
      );
    }

    if (entry.status === "notified") {
      const timedOut = entry.confirmation_deadline ? isPast(new Date(entry.confirmation_deadline)) : false;
      return timedOut ? (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" /> Timed out
        </Badge>
      ) : (
        <Badge className="bg-warning text-warning-foreground">
          <Bell className="w-3 h-3 mr-1" /> Notified
        </Badge>
      );
    }

    if (entry.status === "confirmed") {
      return (
        <Badge className="bg-success text-success-foreground">
          <CheckCircle className="w-3 h-3 mr-1" /> Confirmed
        </Badge>
      );
    }

    if (entry.status === "expired") {
      return (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" /> Expired
        </Badge>
      );
    }

    if (entry.status === "cancelled") {
      return <Badge variant="outline">Cancelled</Badge>;
    }

    return <Badge variant="outline">{entry.status}</Badge>;
  };

  const getCountdown = (deadline: string | null) => {
    if (!deadline) return null;
    const deadlineDate = new Date(deadline);
    if (isPast(deadlineDate)) return <span className="text-xs text-destructive font-medium">Expired</span>;
    return <span className="text-xs text-warning font-medium">{formatDistanceToNow(deadlineDate, { addSuffix: false })} left</span>;
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) {
      return;
    }

    setPage(nextPage);
  };

  const loading = roleLibraryLoading || fallbackLoading || entriesQuery.isLoading;
  const tableUpdating = entriesQuery.isFetching && !entriesQuery.isLoading;
  const entriesError = entriesQuery.isError;
  const entriesQueryError = entriesQuery.error;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Waiting List</h2>
            <p className="text-sm text-muted-foreground mt-1">FIFO queue with 10-minute confirmation window</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => notifyMutation.mutate()}
              disabled={notifyMutation.isPending || overview.inQueueCount === 0 || !resolvedLibraryId}
            >
              <Bell className="w-4 h-4 mr-1.5" />
              {notifyMutation.isPending ? "Notifying..." : "Notify Next"}
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={!resolvedLibraryId}>
                  <UserPlus className="w-4 h-4 mr-1.5" /> Add to Queue
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">Add to Waiting List</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Student Name *</Label>
                    <Input value={form.student_name} onChange={(e) => setForm({ ...form, student_name: e.target.value })} placeholder="Full name" />
                  </div>
                  <div className="space-y-3">
                    <Label>Gender *</Label>
                    <RadioGroup
                      value={form.gender}
                      onValueChange={(value) => setForm({ ...form, gender: value as StudentGender })}
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      {STUDENT_GENDER_OPTIONS.map((option) => {
                        const inputId = `waiting-list-gender-${option.value}`;

                        return (
                          <label
                            key={option.value}
                            htmlFor={inputId}
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-muted/40"
                          >
                            <RadioGroupItem id={inputId} value={option.value} />
                            <span className="text-sm font-medium text-foreground">{option.label}</span>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9876543210" />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="student@email.com" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Preferred Slot</Label>
                      <Select
                        value={form.preferred_slot || "none"}
                        onValueChange={(value) => setForm({ ...form, preferred_slot: value === "none" ? "" : value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select slot" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No preference</SelectItem>
                          {slots.map((slot) => (
                            <SelectItem key={slot.id} value={slot.name}>
                              {slot.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Preferred Plan</Label>
                      <Select
                        value={form.preferred_plan || "none"}
                        onValueChange={(value) => setForm({ ...form, preferred_plan: value === "none" ? "" : value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select plan" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No preference</SelectItem>
                          {plans.map((plan) => (
                            <SelectItem key={plan.id} value={plan.name}>
                              {plan.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button className="w-full" disabled={!form.student_name || !form.gender || addMutation.isPending} onClick={() => addMutation.mutate()}>
                    {addMutation.isPending ? "Adding..." : "Add to Queue"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            icon={ListOrdered}
            title="In Queue"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.inQueueCount)}
            trend="up"
          />
          <StatsCard
            icon={Bell}
            title="Notified"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.notifiedCount)}
            trend="up"
            iconColor="text-warning"
          />
          <StatsCard
            icon={CheckCircle}
            title="Confirmed"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.confirmedCount)}
            trend="up"
            iconColor="text-success"
          />
          <StatsCard
            icon={XCircle}
            title="Expired"
            value={overviewQuery.isLoading && resolvedLibraryId ? "--" : String(overview.expiredCount)}
            trend="down"
            iconColor="text-destructive"
          />
        </div>

        {notifiedEntries.length > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3 mb-3">
                <Bell className="w-5 h-5 text-warning" />
                <span className="font-semibold font-display text-foreground">Awaiting Confirmation</span>
              </div>
              <div className="space-y-2">
                {notifiedEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between bg-card rounded-lg p-3 border">
                    <div>
                      <p className="font-medium text-foreground">{entry.student_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {getCountdown(entry.confirmation_deadline)}
                        {entry.preferred_slot && (
                          <Badge variant="outline" className="text-xs">
                            {entry.preferred_slot}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => confirmMutation.mutate(entry.id)} disabled={confirmMutation.isPending}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(entry.id)} disabled={cancelMutation.isPending}>
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div ref={tableTopRef} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-lg font-display">Full Queue</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Oldest entries stay first to preserve FIFO order
                    {tableUpdating ? " - refreshing current page..." : ""}
                  </p>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative w-full lg:w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by name or phone"
                      className="pl-9"
                    />
                  </div>

                  <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as WaitingListStatusFilter)}>
                    <SelectTrigger className="w-full lg:w-[160px]">
                      <SelectValue placeholder="All entries" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All entries</SelectItem>
                      <SelectItem value="waiting">In Queue</SelectItem>
                      <SelectItem value="notified">Notified</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value) as WaitingListPageSize)}>
                    <SelectTrigger className="w-full lg:w-[120px]">
                      <SelectValue placeholder="10 rows" />
                    </SelectTrigger>
                    <SelectContent>
                      {WAITING_LIST_PAGE_SIZE_OPTIONS.map((pageSize) => (
                        <SelectItem key={pageSize} value={String(pageSize)}>
                          {pageSize} rows
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!resolvedLibraryId && !loading ? (
              <p className="text-sm text-destructive py-8 text-center">Library not linked to your account. Please check user role setup.</p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
            ) : entriesError ? (
              <p className="text-sm text-destructive py-8 text-center">Unable to load waiting list: {getErrorMessage(entriesQueryError)}</p>
            ) : entries.length === 0 ? (
              <div className="py-12 text-center">
                <ListOrdered className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">No students in waiting list</p>
              </div>
            ) : (
              <div className="space-y-5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead className="hidden sm:table-cell">Contact</TableHead>
                      <TableHead className="hidden md:table-cell">Preference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Countdown</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry, index) => {
                      const rowNumber = (page - 1) * limit + index + 1;

                      return (
                        <TableRow key={entry.id} className={entry.status === "notified" ? "bg-warning/5" : ""}>
                          <TableCell className="font-mono text-muted-foreground">{rowNumber}</TableCell>
                          <TableCell>
                            <p className="font-medium text-foreground">{entry.student_name}</p>
                            {entry.gender ? (
                              <Badge variant="outline" className={`mt-1 rounded-full px-2.5 py-0.5 text-[11px] ${getStudentGenderBadgeClassName(entry.gender)}`}>
                                {formatStudentGender(entry.gender)}
                              </Badge>
                            ) : null}
                            <p className="text-xs text-muted-foreground sm:hidden">{entry.phone || entry.email || ""}</p>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                            {entry.phone && <p>{entry.phone}</p>}
                            {entry.email && <p className="truncate max-w-[150px]">{entry.email}</p>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex gap-1">
                              {entry.preferred_slot && (
                                <Badge variant="outline" className="text-xs">
                                  {entry.preferred_slot}
                                </Badge>
                              )}
                              {entry.preferred_plan && (
                                <Badge variant="secondary" className="text-xs">
                                  {entry.preferred_plan}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(entry)}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            {entry.status === "notified" && entry.confirmation_deadline
                              ? getCountdown(entry.confirmation_deadline)
                              : entry.confirmed_at
                                ? <span className="text-xs text-muted-foreground">{format(new Date(entry.confirmed_at), "dd MMM, hh:mm a")}</span>
                                : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {entry.status === "notified" && (
                                <Button size="sm" variant="ghost" onClick={() => confirmMutation.mutate(entry.id)}>
                                  <CheckCircle className="w-4 h-4 text-success" />
                                </Button>
                              )}
                              {(entry.status === "waiting" || entry.status === "notified") && (
                                <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(entry.id)}>
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="border-t border-border/70 pt-5">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Showing <span className="font-semibold text-foreground">{rangeStart}-{rangeEnd}</span> of{" "}
                      <span className="font-semibold text-foreground">{totalCount.toLocaleString("en-IN")}</span> entries
                    </p>

                    {totalPages > 1 ? (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <Button type="button" variant="outline" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
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
                              variant={item === page ? "default" : "outline"}
                              className="min-w-10 px-3"
                              onClick={() => handlePageChange(item)}
                            >
                              {item}
                            </Button>
                          ),
                        )}

                        <Button type="button" variant="outline" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>
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
    </DashboardLayout>
  );
};

export default WaitingListPage;
