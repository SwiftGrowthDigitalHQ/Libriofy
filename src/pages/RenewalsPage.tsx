import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { CalendarClock, AlertTriangle, CheckCircle, RefreshCw, Search, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInDays, parseISO } from "date-fns";

const RenewalsPage = () => {
  const [search, setSearch] = useState("");
  const [renewTarget, setRenewTarget] = useState<any>(null);
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Students with expiry info
  const { data: students = [], isLoading } = useQuery({
    queryKey: ["students-renewals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students" as any)
        .select("*")
        .order("expiry_date", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  // Recent notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ["renewal-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as any)
        .select("*")
        .in("type", ["expiry", "renewal_3day", "renewal_1day", "renewal_success"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const renewMutation = useMutation({
    mutationFn: async () => {
      if (!renewTarget) return;
      const { data, error } = await supabase.rpc("renew_student" as any, {
        p_student_id: renewTarget.id,
        p_months: parseInt(months),
        p_amount: parseFloat(amount || "0"),
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (result) => {
      if (result?.success) {
        toast({ title: "Renewed!", description: `New expiry: ${result.new_expiry}` });
        setRenewTarget(null);
        setAmount("");
        queryClient.invalidateQueries({ queryKey: ["students-renewals"] });
        queryClient.invalidateQueries({ queryKey: ["renewal-notifications"] });
      } else {
        toast({ title: "Error", description: result?.error, variant: "destructive" });
      }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const today = new Date();
  const expiringSoon = students.filter((s: any) =>
    s.status === "active" && s.expiry_date &&
    differenceInDays(parseISO(s.expiry_date), today) <= 7 &&
    differenceInDays(parseISO(s.expiry_date), today) >= 0
  );
  const expired = students.filter((s: any) => s.status === "expired");
  const active = students.filter((s: any) => s.status === "active");

  const filtered = students.filter((s: any) =>
    s.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const getExpiryBadge = (student: any) => {
    if (student.status === "expired") return <Badge variant="destructive">Expired</Badge>;
    if (!student.expiry_date) return <Badge variant="outline">No expiry</Badge>;
    const days = differenceInDays(parseISO(student.expiry_date), today);
    if (days < 0) return <Badge variant="destructive">Expired</Badge>;
    if (days <= 1) return <Badge className="bg-destructive/80 text-destructive-foreground">Tomorrow</Badge>;
    if (days <= 3) return <Badge className="bg-warning text-warning-foreground">{days}d left</Badge>;
    if (days <= 7) return <Badge variant="secondary">{days}d left</Badge>;
    return <Badge variant="outline">{days}d left</Badge>;
  };

  const getNotifIcon = (type: string) => {
    if (type === "expiry") return <AlertTriangle className="w-3.5 h-3.5 text-destructive" />;
    if (type === "renewal_success") return <CheckCircle className="w-3.5 h-3.5 text-success" />;
    return <Bell className="w-3.5 h-3.5 text-warning" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Renewals</h2>
          <p className="text-sm text-muted-foreground mt-1">Track memberships, send reminders, and process renewals</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon={CheckCircle} title="Active" value={String(active.length)} trend="up" iconColor="text-success" />
          <StatsCard icon={CalendarClock} title="Expiring (7d)" value={String(expiringSoon.length)} trend="down" iconColor="text-warning" />
          <StatsCard icon={AlertTriangle} title="Expired" value={String(expired.length)} trend="down" iconColor="text-destructive" />
          <StatsCard icon={RefreshCw} title="Total Students" value={String(students.length)} trend="up" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Students Table */}
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
                {isLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
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
                      {filtered.map((student: any) => (
                        <TableRow key={student.id}>
                          <TableCell>
                            <p className="font-medium text-foreground">{student.full_name}</p>
                            <p className="text-xs text-muted-foreground">{student.seat_number ? `Seat ${student.seat_number}` : "No seat"}</p>
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">{student.plan || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {student.expiry_date ? format(parseISO(student.expiry_date), "dd MMM yyyy") : "—"}
                          </TableCell>
                          <TableCell>{getExpiryBadge(student)}</TableCell>
                          <TableCell className="text-right">
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
                                    <p><span className="text-muted-foreground">Current plan:</span> {student.plan || "N/A"}</p>
                                    <p><span className="text-muted-foreground">Current expiry:</span> {student.expiry_date ? format(parseISO(student.expiry_date), "dd MMM yyyy") : "Not set"}</p>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Renewal Period</Label>
                                    <Select value={months} onValueChange={setMonths}>
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="1">1 Month</SelectItem>
                                        <SelectItem value="3">3 Months</SelectItem>
                                        <SelectItem value="6">6 Months</SelectItem>
                                        <SelectItem value="12">12 Months</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Amount (₹)</Label>
                                    <Input type="number" placeholder="3500" value={amount} onChange={(e) => setAmount(e.target.value)} />
                                  </div>
                                  <Button className="w-full" disabled={renewMutation.isPending} onClick={() => renewMutation.mutate()}>
                                    {renewMutation.isPending ? "Processing..." : "Confirm Renewal"}
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Notifications Panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Renewal Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No renewal alerts yet.</p>
              ) : (
                <div className="space-y-3">
                  {notifications.map((notif: any) => (
                    <div key={notif.id} className="flex items-start gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        notif.type === "expiry" ? "bg-destructive/10" :
                        notif.type === "renewal_success" ? "bg-success/10" : "bg-warning/10"
                      }`}>
                        {getNotifIcon(notif.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{notif.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{notif.message}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          {format(new Date(notif.created_at), "dd MMM, hh:mm a")}
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
