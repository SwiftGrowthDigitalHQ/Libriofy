import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInDays, format, parseISO } from "date-fns";
import { CalendarClock, AlertTriangle, CheckCircle, RefreshCw, Search, Bell, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";

type StudentRenewalRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "id" | "full_name" | "plan" | "seat_number" | "status" | "expiry_date" | "phone" | "qr_code"
>;

type RenewalNotificationRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "type" | "title" | "message" | "created_at" | "channel" | "delivery_status" | "recipient_phone" | "sent_at" | "provider_error"
> & {
  students: Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "phone" | "seat_number"> | null;
};

const REMINDER_NOTIFICATION_TYPES = ["renewal_2day", "renewal_1day", "renewal_due_today"] as const;

type StudentWithDerived = StudentRenewalRow & {
  daysToExpiry: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
  isActive: boolean;
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const RenewalsPage = () => {
  const [search, setSearch] = useState("");
  const [renewTarget, setRenewTarget] = useState<StudentRenewalRow | null>(null);
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

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
    data: students = [],
    isLoading: studentsLoading,
    isError: studentsError,
    error: studentsQueryError,
  } = useQuery({
    queryKey: ["students-renewals", resolvedLibraryId],
    queryFn: async (): Promise<StudentRenewalRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, plan, seat_number, status, expiry_date, phone, qr_code")
        .eq("library_id", resolvedLibraryId)
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const {
    data: notifications = [],
    isLoading: notificationsLoading,
    isError: notificationsError,
    error: notificationsQueryError,
  } = useQuery({
    queryKey: ["renewal-notifications", resolvedLibraryId],
    queryFn: async (): Promise<RenewalNotificationRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, message, created_at, channel, delivery_status, recipient_phone, sent_at, provider_error, students:student_id(full_name, phone, seat_number)")
        .eq("library_id", resolvedLibraryId)
        .in("type", [...REMINDER_NOTIFICATION_TYPES])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as RenewalNotificationRow[];
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const renewMutation = useMutation({
    mutationFn: async () => {
      if (!renewTarget) throw new Error("Please choose a student.");
      const { data, error } = await supabase.rpc("renew_student", {
        p_student_id: renewTarget.id,
        p_months: parseInt(months, 10),
        p_amount: parseFloat(amount || "0"),
      });
      if (error) throw error;
      return data as { success?: boolean; error?: string; new_expiry?: string } | null;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Renewed", description: `New expiry: ${result.new_expiry}` });
        setRenewTarget(null);
        setMonths("1");
        setAmount("");
        queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
        queryClient.invalidateQueries({ queryKey: ["renewal-notifications", resolvedLibraryId] });
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
      const { data, error } = await supabase.functions.invoke<{
        results?: {
          reminders?: {
            failed?: number;
            processed?: number;
            sent?: number;
            skipped?: number;
          };
        };
        success?: boolean;
      }>("process-renewals");
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      const reminderSummary = result?.results?.reminders;
      if (reminderSummary) {
        toast({
          title: "Renewal scan completed",
          description: `${reminderSummary.sent ?? 0} sent, ${reminderSummary.failed ?? 0} failed, ${reminderSummary.skipped ?? 0} skipped`,
        });
      } else {
        toast({ title: "Renewal scan completed" });
      }
      queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["renewal-notifications", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

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
        isExpired,
        isExpiringSoon,
        isActive,
      };
    });
  }, [students]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return studentsWithState;
    return studentsWithState.filter((student) =>
      [student.full_name, student.seat_number || "", student.plan || ""].some((value) => value.toLowerCase().includes(q)),
    );
  }, [search, studentsWithState]);

  const activeCount = studentsWithState.filter((student) => student.isActive).length;
  const expiringSoonCount = studentsWithState.filter((student) => student.isExpiringSoon).length;
  const dueTodayCount = studentsWithState.filter((student) => student.daysToExpiry === 0 && !student.isExpired).length;
  const expiredCount = studentsWithState.filter((student) => student.isExpired).length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const remindersSentToday = notifications.filter((notification) => notification.sent_at?.startsWith(todayIso)).length;
  const remindersPending = notifications.filter((notification) => notification.delivery_status === "queued").length;
  const remindersFailed = notifications.filter((notification) => notification.delivery_status === "failed").length;

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
    if (type === "renewal_2day") return "2 days before";
    if (type === "renewal_1day") return "1 day before";
    if (type === "renewal_due_today") return "Expiry day";
    return type;
  };

  const getNotifIcon = (type: string) => {
    if (type === "renewal_due_today") return <AlertTriangle className="w-3.5 h-3.5 text-destructive" />;
    if (type === "renewal_1day") return <Bell className="w-3.5 h-3.5 text-warning" />;
    return <CalendarClock className="w-3.5 h-3.5 text-primary" />;
  };

  const getDeliveryBadge = (notification: RenewalNotificationRow) => {
    if (notification.delivery_status === "sent") return <Badge className="bg-success/10 text-success hover:bg-success/10">Sent</Badge>;
    if (notification.delivery_status === "failed") return <Badge variant="destructive">Failed</Badge>;
    if (notification.delivery_status === "skipped") return <Badge variant="secondary">Skipped</Badge>;
    return <Badge variant="outline">Queued</Badge>;
  };

  const getChannelBadge = (channel: string | null) => {
    if (!channel) return <Badge variant="outline">Pending</Badge>;
    if (channel === "whatsapp") return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">WhatsApp</Badge>;
    if (channel === "sms") return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">SMS</Badge>;
    if (channel === "webhook") return <Badge variant="secondary">Webhook</Badge>;
    return <Badge variant="outline">{channel}</Badge>;
  };

  const copyRenewalLink = async (student: StudentRenewalRow) => {
    const renewalUrl = `${window.location.origin}/renew/${student.qr_code}`;
    try {
      await navigator.clipboard.writeText(renewalUrl);
      toast({ title: "Renewal link copied", description: `${student.full_name}'s renewal page URL is ready to share.` });
    } catch {
      toast({ title: "Copy failed", description: "Unable to copy renewal link.", variant: "destructive" });
    }
  };

  const loading = roleLibraryLoading || fallbackLoading || studentsLoading;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Renewals</h2>
            <p className="text-sm text-muted-foreground mt-1">Track memberships, send WhatsApp/SMS reminders, and process renewals</p>
          </div>
          <Button variant="outline" onClick={() => scanRenewalsMutation.mutate()} disabled={scanRenewalsMutation.isPending || !resolvedLibraryId}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            {scanRenewalsMutation.isPending ? "Scanning..." : "Run Reminder Scan"}
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatsCard icon={CheckCircle} title="Active" value={String(activeCount)} trend="up" iconColor="text-success" />
          <StatsCard icon={CalendarClock} title="Expiring (7d)" value={String(expiringSoonCount)} trend="down" iconColor="text-warning" />
          <StatsCard icon={Bell} title="Due Today" value={String(dueTodayCount)} trend="down" iconColor="text-destructive" />
          <StatsCard icon={Bell} title="Sent Today" value={String(remindersSentToday)} trend="up" iconColor="text-primary" />
          <StatsCard icon={AlertTriangle} title="Expired" value={String(expiredCount)} trend="down" iconColor="text-destructive" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <CardTitle className="text-lg font-display">Membership Status</CardTitle>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search students..." value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!resolvedLibraryId && !loading ? (
                  <p className="text-sm text-destructive py-8 text-center">Library not linked to your account. Please check user role setup.</p>
                ) : loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
                ) : studentsError ? (
                  <p className="text-sm text-destructive py-8 text-center">Unable to load renewals: {getErrorMessage(studentsQueryError)}</p>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No students found.</p>
                ) : (
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
                      {filtered.map((student) => (
                        <TableRow key={student.id}>
                          <TableCell>
                            <p className="font-medium text-foreground">{student.full_name}</p>
                            <p className="text-xs text-muted-foreground">{student.seat_number ? `Seat ${student.seat_number}` : "No seat"}</p>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">{student.plan || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {student.expiry_date ? format(parseISO(student.expiry_date), "dd MMM yyyy") : "-"}
                          </TableCell>
                          <TableCell>{getExpiryBadge(student)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => copyRenewalLink(student)}>
                                <Copy className="w-3.5 h-3.5 mr-1" /> Link
                              </Button>
                              <Dialog open={renewTarget?.id === student.id} onOpenChange={(open) => !open && setRenewTarget(null)}>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="outline" onClick={() => setRenewTarget(student)}>
                                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Renew
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle className="font-display">Renew {student.full_name}</DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-4 pt-2">
                                    <div className="p-3 bg-secondary rounded-lg text-sm">
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
                                      <Input type="number" placeholder="3500" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="space-y-1">
                <CardTitle className="text-lg font-display flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" />
                  Reminder Delivery Log
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {remindersSentToday} sent today, {remindersPending} queued, {remindersFailed} failed
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Loading reminders...</p>
              ) : notificationsError ? (
                <p className="text-sm text-destructive py-4 text-center">Unable to load reminders: {getErrorMessage(notificationsQueryError)}</p>
              ) : notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No reminder activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notif) => (
                    <div key={notif.id} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          notif.type === "renewal_due_today" ? "bg-destructive/10" : "bg-primary/10"
                        }`}
                      >
                        {getNotifIcon(notif.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-foreground">{notif.students?.full_name || notif.title}</p>
                          {getDeliveryBadge(notif)}
                          {getChannelBadge(notif.channel)}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {getReminderStageLabel(notif.type)}
                          {notif.students?.seat_number ? ` • Seat ${notif.students.seat_number}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {notif.recipient_phone || notif.students?.phone || "Phone number missing"}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-3 mt-2 whitespace-pre-line">{notif.message}</p>
                        {notif.provider_error && (
                          <p className="text-xs text-destructive mt-2">{notif.provider_error}</p>
                        )}
                        <p className="text-xs text-muted-foreground/60 mt-2">
                          {format(new Date(notif.sent_at || notif.created_at), "dd MMM, hh:mm a")}
                        </p>
                      </div>
                    </div>
                  ))}
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
