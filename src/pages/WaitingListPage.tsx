import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ListOrdered, UserPlus, Bell, CheckCircle, XCircle, Clock, AlertTriangle, Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow, isPast } from "date-fns";

const WaitingListPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ student_name: "", phone: "", email: "", preferred_slot: "", preferred_plan: "" });

  // Get first library
  const { data: libraries = [] } = useQuery({
    queryKey: ["my-libraries"],
    queryFn: async () => {
      const { data, error } = await supabase.from("libraries").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const libraryId = libraries[0]?.id;

  // Waiting list
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["waiting-list", libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const { data, error } = await supabase
        .from("waiting_list" as any)
        .select("*")
        .eq("library_id", libraryId)
        .order("position");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!libraryId,
    refetchInterval: 15000, // Refresh for countdown timers
  });

  // Add to queue
  const addMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId) throw new Error("No library");
      const { data, error } = await supabase.rpc("add_to_waiting_list" as any, {
        p_library_id: libraryId,
        p_student_name: form.student_name,
        p_phone: form.phone || null,
        p_email: form.email || null,
        p_preferred_slot: form.preferred_slot || null,
        p_preferred_plan: form.preferred_plan || null,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Added to queue", description: `Position #${result.position}` });
        setDialogOpen(false);
        setForm({ student_name: "", phone: "", email: "", preferred_slot: "", preferred_plan: "" });
        queryClient.invalidateQueries({ queryKey: ["waiting-list"] });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Notify next
  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId) throw new Error("No library");
      const { data, error } = await supabase.rpc("notify_next_in_queue" as any, { p_library_id: libraryId });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Notified!", description: `${result.student_name} has 10 minutes to confirm` });
      } else {
        toast({ title: "Queue empty", description: result?.error, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["waiting-list"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Confirm entry
  const confirmMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { data, error } = await supabase.rpc("confirm_waiting_list" as any, { p_entry_id: entryId });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Confirmed!", description: `${result.student_name} is confirmed` });
      } else {
        toast({ title: "Failed", description: result?.error, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["waiting-list"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Cancel entry
  const cancelMutation = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("waiting_list" as any)
        .update({ status: "cancelled" })
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waiting-list"] });
      toast({ title: "Removed from queue" });
    },
  });

  const waiting = entries.filter((e: any) => e.status === "waiting");
  const notified = entries.filter((e: any) => e.status === "notified");
  const confirmed = entries.filter((e: any) => e.status === "confirmed");
  const expired = entries.filter((e: any) => e.status === "expired");

  const getStatusBadge = (entry: any) => {
    switch (entry.status) {
      case "waiting":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> #{entry.position} Waiting</Badge>;
      case "notified":
        const isExpired = entry.confirmation_deadline && isPast(new Date(entry.confirmation_deadline));
        return isExpired ? (
          <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Timed out</Badge>
        ) : (
          <Badge className="bg-warning text-warning-foreground"><Bell className="w-3 h-3 mr-1" /> Notified</Badge>
        );
      case "confirmed":
        return <Badge className="bg-success text-success-foreground"><CheckCircle className="w-3 h-3 mr-1" /> Confirmed</Badge>;
      case "expired":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Expired</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{entry.status}</Badge>;
    }
  };

  const getCountdown = (deadline: string) => {
    if (!deadline) return null;
    const d = new Date(deadline);
    if (isPast(d)) return <span className="text-xs text-destructive font-medium">Expired</span>;
    return (
      <span className="text-xs text-warning font-medium">
        {formatDistanceToNow(d, { addSuffix: false })} left
      </span>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Waiting List</h2>
            <p className="text-sm text-muted-foreground mt-1">FIFO queue with 10-minute confirmation window</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => notifyMutation.mutate()} disabled={notifyMutation.isPending || waiting.length === 0}>
              <Bell className="w-4 h-4 mr-1.5" />
              {notifyMutation.isPending ? "Notifying..." : "Notify Next"}
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><UserPlus className="w-4 h-4 mr-1.5" /> Add to Queue</Button>
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
                      <Input value={form.preferred_slot} onChange={(e) => setForm({ ...form, preferred_slot: e.target.value })} placeholder="e.g. Morning" />
                    </div>
                    <div className="space-y-2">
                      <Label>Preferred Plan</Label>
                      <Input value={form.preferred_plan} onChange={(e) => setForm({ ...form, preferred_plan: e.target.value })} placeholder="e.g. Full Day" />
                    </div>
                  </div>
                  <Button className="w-full" disabled={!form.student_name || addMutation.isPending} onClick={() => addMutation.mutate()}>
                    {addMutation.isPending ? "Adding..." : "Add to Queue"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon={ListOrdered} title="In Queue" value={String(waiting.length)} trend="up" />
          <StatsCard icon={Bell} title="Notified" value={String(notified.length)} trend="up" iconColor="text-warning" />
          <StatsCard icon={CheckCircle} title="Confirmed" value={String(confirmed.length)} trend="up" iconColor="text-success" />
          <StatsCard icon={XCircle} title="Expired" value={String(expired.length)} trend="down" iconColor="text-destructive" />
        </div>

        {/* Active notifications banner */}
        {notified.length > 0 && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3 mb-3">
                <Bell className="w-5 h-5 text-warning" />
                <span className="font-semibold font-display text-foreground">Awaiting Confirmation</span>
              </div>
              <div className="space-y-2">
                {notified.map((entry: any) => (
                  <div key={entry.id} className="flex items-center justify-between bg-card rounded-lg p-3 border">
                    <div>
                      <p className="font-medium text-foreground">{entry.student_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {getCountdown(entry.confirmation_deadline)}
                        {entry.preferred_slot && <Badge variant="outline" className="text-xs">{entry.preferred_slot}</Badge>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => confirmMutation.mutate(entry.id)} disabled={confirmMutation.isPending}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(entry.id)}>
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Queue Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display">Full Queue</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
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
                  {entries.map((entry: any) => (
                    <TableRow key={entry.id} className={entry.status === "notified" ? "bg-warning/5" : ""}>
                      <TableCell className="font-mono text-muted-foreground">{entry.position}</TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">{entry.student_name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{entry.phone || entry.email || ""}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                        {entry.phone && <p>{entry.phone}</p>}
                        {entry.email && <p className="truncate max-w-[150px]">{entry.email}</p>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex gap-1">
                          {entry.preferred_slot && <Badge variant="outline" className="text-xs">{entry.preferred_slot}</Badge>}
                          {entry.preferred_plan && <Badge variant="secondary" className="text-xs">{entry.preferred_plan}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(entry)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {entry.status === "notified" && entry.confirmation_deadline
                          ? getCountdown(entry.confirmation_deadline)
                          : entry.confirmed_at
                            ? <span className="text-xs text-muted-foreground">{format(new Date(entry.confirmed_at), "dd MMM, hh:mm a")}</span>
                            : "—"
                        }
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
