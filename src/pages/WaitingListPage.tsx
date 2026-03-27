import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isPast } from "date-fns";
import {
  ListOrdered,
  UserPlus,
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Trash2,
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
import { STUDENT_GENDER_OPTIONS, formatStudentGender, getStudentGenderBadgeClassName, type StudentGender } from "@/lib/studentGender";

type WaitingEntry = Database["public"]["Tables"]["waiting_list"]["Row"];
type TimeSlotOption = Pick<Database["public"]["Tables"]["time_slots"]["Row"], "id" | "name">;
type PlanOption = Pick<Database["public"]["Tables"]["plans"]["Row"], "id" | "name">;

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

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const WaitingListPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    student_name: "",
    gender: "" as StudentGender | "",
    phone: "",
    email: "",
    preferred_slot: "",
    preferred_plan: "",
  });

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

  const {
    data: entries = [],
    isLoading: entriesLoading,
    isError: entriesError,
    error: entriesQueryError,
  } = useQuery({
    queryKey: ["waiting-list", resolvedLibraryId],
    queryFn: async (): Promise<WaitingEntry[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("waiting_list")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .order("position", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
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
      toast({ title: "Removed from queue" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const waiting = useMemo(() => entries.filter((entry) => entry.status === "waiting"), [entries]);
  const notified = useMemo(() => entries.filter((entry) => entry.status === "notified"), [entries]);
  const confirmed = useMemo(() => entries.filter((entry) => entry.status === "confirmed"), [entries]);
  const expired = useMemo(() => entries.filter((entry) => entry.status === "expired"), [entries]);

  const getStatusBadge = (entry: WaitingEntry) => {
    if (entry.status === "waiting") {
      return (
        <Badge variant="secondary">
          <Clock className="w-3 h-3 mr-1" /> #{entry.position} Waiting
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

  const loading = roleLibraryLoading || fallbackLoading || entriesLoading;

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
              disabled={notifyMutation.isPending || waiting.length === 0 || !resolvedLibraryId}
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
          <StatsCard icon={ListOrdered} title="In Queue" value={String(waiting.length)} trend="up" />
          <StatsCard icon={Bell} title="Notified" value={String(notified.length)} trend="up" iconColor="text-warning" />
          <StatsCard icon={CheckCircle} title="Confirmed" value={String(confirmed.length)} trend="up" iconColor="text-success" />
          <StatsCard icon={XCircle} title="Expired" value={String(expired.length)} trend="down" iconColor="text-destructive" />
        </div>

        {notified.length > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3 mb-3">
                <Bell className="w-5 h-5 text-warning" />
                <span className="font-semibold font-display text-foreground">Awaiting Confirmation</span>
              </div>
              <div className="space-y-2">
                {notified.map((entry) => (
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
            <CardTitle className="text-lg font-display">Full Queue</CardTitle>
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
                <p className="text-muted-foreground">Waiting list is empty. Add someone to get started.</p>
              </div>
            ) : (
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
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className={entry.status === "notified" ? "bg-warning/5" : ""}>
                      <TableCell className="font-mono text-muted-foreground">{entry.position}</TableCell>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WaitingListPage;
