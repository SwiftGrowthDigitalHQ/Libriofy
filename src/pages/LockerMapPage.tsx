import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CircleDollarSign, ShieldAlert, UserCheck } from "lucide-react";
import { assignLocker, getLockers, releaseLocker, updateLocker, type LockerRecord } from "@/api/lockers";
import LockerGrid, { type LockerGridItem, type LockerStatus } from "@/components/LockerGrid";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isStudentCurrentlyActive } from "@/lib/studentMembership";
import { cn } from "@/lib/utils";

type StudentOption = Pick<Database["public"]["Tables"]["students"]["Row"], "expiry_date" | "full_name" | "id" | "seat_number" | "status">;

const formatCurrency = (value: number) => `Rs ${value.toLocaleString("en-IN")}`;

const formatDueDate = (value: string | null | undefined) => {
  if (!value) return "Not scheduled";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { dateStyle: "medium" });
};

const statusLegend = [
  { color: "bg-[#22c55e]", label: "Available" },
  { color: "bg-[#facc15]", label: "Occupied" },
  { color: "bg-[#ef4444]", label: "Maintenance" },
] as const;

const LockerMapPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const [selectedLocker, setSelectedLocker] = useState<LockerRecord | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("0");

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

      if (error) {
        throw error;
      }

      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const {
    data: lockers = [],
    isLoading: lockersLoading,
    isError: lockersError,
    error: lockersQueryError,
  } = useQuery({
    queryKey: ["lockers", resolvedLibraryId],
    queryFn: async (): Promise<LockerRecord[]> => {
      if (!resolvedLibraryId) return [];
      return getLockers(resolvedLibraryId);
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 10000,
  });

  const {
    data: students = [],
    isLoading: studentsLoading,
  } = useQuery({
    queryKey: ["locker-students", resolvedLibraryId],
    queryFn: async (): Promise<StudentOption[]> => {
      if (!resolvedLibraryId) return [];

      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, status, seat_number, expiry_date")
        .eq("library_id", resolvedLibraryId)
        .order("full_name", { ascending: true });

      if (error) {
        throw error;
      }

      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!selectedLocker) {
      setSelectedStudentId("");
      setMonthlyPrice("0");
      return;
    }

    setSelectedStudentId(selectedLocker.student_id ?? "");
    setMonthlyPrice(String(Number(selectedLocker.monthly_price ?? 0)));
  }, [selectedLocker]);

  const lockerStats = useMemo(() => {
    return lockers.reduce(
      (totals, locker) => {
        totals.total += 1;
        if (locker.status === "available") totals.available += 1;
        if (locker.status === "occupied") {
          totals.occupied += 1;
          totals.revenue += Number(locker.monthly_price || 0);
        }
        if (locker.status === "maintenance") totals.maintenance += 1;
        return totals;
      },
      { available: 0, maintenance: 0, occupied: 0, revenue: 0, total: 0 },
    );
  }, [lockers]);

  const studentsById = useMemo(() => {
    const map = new Map<string, StudentOption>();
    for (const student of students) {
      map.set(student.id, student);
    }
    return map;
  }, [students]);

  const lockerGridItems = useMemo(
    (): LockerGridItem[] =>
      lockers.map((locker) => ({
        column: locker.column,
        id: locker.id,
        lockerNumber: locker.locker_number,
        monthlyPrice: Number(locker.monthly_price || 0),
        paymentDueDate: locker.payment_due_date,
        row: locker.row,
        status: locker.status as LockerStatus,
        studentName: locker.student_id ? studentsById.get(locker.student_id)?.full_name ?? null : null,
      })),
    [lockers, studentsById],
  );

  const lockerByStudentId = useMemo(() => {
    const map = new Map<string, LockerRecord>();
    for (const locker of lockers) {
      if (locker.student_id && locker.status === "occupied") {
        map.set(locker.student_id, locker);
      }
    }
    return map;
  }, [lockers]);

  const selectableStudents = useMemo(() => {
    return students.filter((student) => {
      if (!isStudentCurrentlyActive(student) && student.id !== selectedLocker?.student_id) {
        return false;
      }

      const existingLocker = lockerByStudentId.get(student.id);
      return !existingLocker || existingLocker.id === selectedLocker?.id;
    });
  }, [lockerByStudentId, selectedLocker?.id, selectedLocker?.student_id, students]);

  const refreshLockers = async () => {
    await queryClient.invalidateQueries({ queryKey: ["lockers", resolvedLibraryId] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
    await queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLocker) throw new Error("Choose a locker first.");
      if (!selectedStudentId) throw new Error("Choose a student to assign.");

      const parsedPrice = Number(monthlyPrice || "0");
      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        throw new Error("Enter a valid monthly price.");
      }

      await assignLocker({
        lockerId: selectedLocker.id,
        monthlyPrice: parsedPrice,
        studentId: selectedStudentId,
      });

      const { error } = await supabase.functions.invoke("process-renewals", {
        body: {
          includeLockerRenewalScan: false,
          includeRenewalScan: false,
          libraryId: resolvedLibraryId,
          source: "locker_assignment",
        },
      });
      return {
        deliveryTriggered: !error,
      };
    },
    onSuccess: async (result) => {
      await refreshLockers();
      setSelectedLocker(null);
      toast({
        title: "Locker assigned",
        description: result.deliveryTriggered
          ? "The student assignment was saved and the WhatsApp delivery flow was triggered."
          : "The locker was assigned. The WhatsApp notification is queued and can be retried from the reminder worker.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to assign locker", description: error.message, variant: "destructive" });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLocker) throw new Error("Choose a locker first.");
      await releaseLocker(selectedLocker.id);
    },
    onSuccess: async () => {
      await refreshLockers();
      setSelectedLocker(null);
      toast({ title: "Locker released", description: "The locker is available again." });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to release locker", description: error.message, variant: "destructive" });
    },
  });

  const priceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedLocker) throw new Error("Choose a locker first.");
      const parsedPrice = Number(monthlyPrice || "0");

      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        throw new Error("Enter a valid monthly price.");
      }

      await updateLocker({
        lockerId: selectedLocker.id,
        monthlyPrice: parsedPrice,
      });
    },
    onSuccess: async () => {
      await refreshLockers();
      setSelectedLocker((current) => (current ? { ...current, monthly_price: Number(monthlyPrice || "0") } : current));
      toast({ title: "Price updated", description: "The locker monthly price was saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update price", description: error.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: Database["public"]["Tables"]["lockers"]["Row"]["status"]) => {
      if (!selectedLocker) throw new Error("Choose a locker first.");
      await updateLocker({
        lockerId: selectedLocker.id,
        status,
      });
    },
    onSuccess: async (_, status) => {
      await refreshLockers();
      setSelectedLocker((current) => (current ? { ...current, status } : current));
      toast({
        title: status === "maintenance" ? "Locker marked for maintenance" : "Locker is available",
        description: status === "maintenance" ? "The locker has been taken out of circulation." : "The locker can be assigned again.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update locker status", description: error.message, variant: "destructive" });
    },
  });

  const loading = roleLibraryLoading || fallbackLoading || lockersLoading || studentsLoading;
  const assignDisabled =
    !selectedLocker ||
    selectedLocker.status === "maintenance" ||
    !selectedStudentId ||
    assignMutation.isPending ||
    (selectedLocker.status === "occupied" && selectedLocker.student_id === selectedStudentId);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 rounded-[28px] border border-[#e7ece6] bg-[radial-gradient(circle_at_top_left,rgba(230,247,238,0.82),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,247,0.96))] p-6 shadow-[0_22px_55px_-30px_rgba(15,23,42,0.22)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b7d70]">Storage Management</p>
              <h2 className="mt-2 text-2xl font-bold font-display text-[#1f2f26]">Locker Map</h2>
              <p className="mt-2 max-w-2xl text-sm text-[#6a7a70]">
                Live view of every rentable locker. Assign students, release lockers, change pricing, and keep maintenance lockers visible in one grid.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {statusLegend.map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-[#e1e9de] bg-white/85 px-3 py-1.5 text-xs font-medium text-[#4b5c52]"
                >
                  <span className={cn("h-2.5 w-2.5 rounded-full", item.color)} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] border border-[#e3e9df] bg-white/90 p-4 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.24)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#718278]">Total Lockers</p>
                  <p className="mt-2 text-3xl font-semibold text-[#1f2f26]">{lockerStats.total}</p>
                </div>
                <Archive className="h-5 w-5 text-[#4b5c52]" />
              </div>
            </div>

            <div className="rounded-[24px] border border-[#cfe9d8] bg-[#e6f7ee] p-4 shadow-[0_14px_32px_-24px_rgba(34,197,94,0.36)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5d6d63]">Available</p>
                  <p className="mt-2 text-3xl font-semibold text-[#166534]">{lockerStats.available}</p>
                </div>
                <UserCheck className="h-5 w-5 text-[#166534]" />
              </div>
            </div>

            <div className="rounded-[24px] border border-[#f4da75] bg-[#fff8db] p-4 shadow-[0_14px_32px_-24px_rgba(250,204,21,0.36)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c5a0a]">Occupied</p>
                  <p className="mt-2 text-3xl font-semibold text-[#854d0e]">{lockerStats.occupied}</p>
                </div>
                <Archive className="h-5 w-5 text-[#854d0e]" />
              </div>
            </div>

            <div className="rounded-[24px] border border-[#f4e4d8] bg-white/90 p-4 shadow-[0_14px_32px_-24px_rgba(15,23,42,0.24)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7a654f]">Locker Revenue</p>
                  <p className="mt-2 text-3xl font-semibold text-[#1f2f26]">{formatCurrency(lockerStats.revenue)}</p>
                </div>
                <CircleDollarSign className="h-5 w-5 text-[#7a654f]" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-[#e7ece6] bg-[radial-gradient(circle_at_bottom_left,rgba(230,247,238,0.48),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,248,0.98))] p-6 shadow-[0_22px_55px_-32px_rgba(15,23,42,0.24)]">
          {!resolvedLibraryId && !loading ? (
            <p className="py-8 text-center text-sm text-destructive">Library not linked to your account. Please check user role setup.</p>
          ) : lockersError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Unable to load lockers: {(lockersQueryError as { message?: string } | null)?.message || "Unknown error"}
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b7d70]">Locker Matrix</p>
                  <h3 className="mt-2 text-lg font-semibold font-display text-[#1f2f26]">Live Locker Status</h3>
                  <p className="mt-2 text-sm text-[#6a7a70]">Tap any locker to assign a student, remove an assignment, update pricing, or pause it for maintenance.</p>
                </div>
                <div className="rounded-2xl border border-[#edf2eb] bg-white/80 px-4 py-3 text-sm text-[#617067] shadow-[0_12px_28px_-24px_rgba(15,23,42,0.28)]">
                  {lockerStats.maintenance} locker{lockerStats.maintenance === 1 ? "" : "s"} in maintenance
                </div>
              </div>

              <LockerGrid
                lockers={lockerGridItems}
                isLoading={loading}
                emptyMessage="No lockers configured yet."
                onLockerClick={(locker) => {
                  const record = lockers.find((item) => item.id === locker.id) ?? null;
                  setSelectedLocker(record);
                }}
                selectedLockerId={selectedLocker?.id ?? null}
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!selectedLocker} onOpenChange={(open) => !open && setSelectedLocker(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{selectedLocker ? `Manage ${selectedLocker.locker_number}` : "Manage locker"}</DialogTitle>
          </DialogHeader>

          {selectedLocker ? (
            <div className="space-y-6">
              <div className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current status</p>
                  <p className="mt-2 text-base font-semibold text-foreground capitalize">{selectedLocker.status}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Monthly price</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{formatCurrency(Number(selectedLocker.monthly_price || 0))}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Assigned student</p>
                  <p className="mt-2 text-sm text-foreground">{selectedLocker.student_id ? studentsById.get(selectedLocker.student_id)?.full_name ?? "Unassigned" : "Unassigned"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Next due date</p>
                  <p className="mt-2 text-sm text-foreground">{formatDueDate(selectedLocker.payment_due_date)}</p>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="locker-student">Assign student</Label>
                <Select value={selectedStudentId || undefined} onValueChange={setSelectedStudentId} disabled={selectedLocker.status === "maintenance"}>
                  <SelectTrigger id="locker-student">
                    <SelectValue placeholder={selectedLocker.status === "maintenance" ? "Locker is under maintenance" : "Select a student"} />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableStudents.length === 0 ? (
                      <SelectItem value="__empty" disabled>
                        No active students available
                      </SelectItem>
                    ) : (
                      selectableStudents.map((student) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.full_name}
                          {student.seat_number ? ` - Seat ${student.seat_number}` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label htmlFor="locker-price">Monthly price</Label>
                <Input
                  id="locker-price"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={monthlyPrice}
                  onChange={(event) => setMonthlyPrice(event.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={() => assignMutation.mutate()} disabled={assignDisabled}>
                  {selectedLocker.status === "occupied" ? "Reassign student" : "Assign student"}
                </Button>
                <Button variant="outline" onClick={() => priceMutation.mutate()} disabled={priceMutation.isPending}>
                  Change price
                </Button>
                <Button
                  variant="outline"
                  onClick={() => statusMutation.mutate("maintenance")}
                  disabled={statusMutation.isPending || selectedLocker.status === "maintenance" || !!selectedLocker.student_id}
                >
                  Mark maintenance
                </Button>
                <Button
                  variant="outline"
                  onClick={() => statusMutation.mutate("available")}
                  disabled={statusMutation.isPending || selectedLocker.status === "available" || !!selectedLocker.student_id}
                >
                  Mark available
                </Button>
              </div>

              {selectedLocker.student_id ? (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => releaseMutation.mutate()}
                  disabled={releaseMutation.isPending}
                >
                  Remove student
                </Button>
              ) : null}

              <div className="rounded-2xl border border-[#fbe0df] bg-[#fff6f6] px-4 py-3 text-sm text-[#8b3a3a]">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p>
                    Locker assignment messages are delivered through the existing renewal automation pipeline. If WhatsApp is not configured, the message is queued and marked as skipped instead of blocking the assignment.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default LockerMapPage;
