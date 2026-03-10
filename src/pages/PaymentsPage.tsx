import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Download, Eye, ImageIcon, Plus } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { exportToCsv } from "@/lib/exportCsv";
import { isPendingPaymentStatus, isSuccessfulPaymentStatus, PAYMENT_SCREENSHOT_BUCKET } from "@/lib/payments";

type PaymentLedgerRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "id" | "amount" | "created_at" | "payment_method" | "payment_screenshot" | "plan" | "seat_id" | "source" | "status"
> & {
  students: Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "seat_number"> | null;
};

type PaymentRow = {
  amount: number;
  created_at: string;
  id: string;
  payment_method: string | null;
  payment_screenshot: string | null;
  plan: string | null;
  seat_id: string | null;
  source: string;
  status: string;
  student_name: string;
  student_seat_number: string | null;
};

type StudentOption = Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "id" | "plan" | "seat_number">;

const initialForm = {
  amount: "",
  payment_method: "manual",
  plan: "",
  status: "completed",
  student_id: "",
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const getStatusBadge = (status: string) => {
  if (isSuccessfulPaymentStatus(status)) {
    return <Badge className="bg-success/10 text-success hover:bg-success/10">{status}</Badge>;
  }
  if (isPendingPaymentStatus(status)) {
    return <Badge variant="secondary">{status}</Badge>;
  }
  return <Badge variant="destructive">{status}</Badge>;
};

const PaymentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["payments-library-fallback", user?.id],
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

  const { data: studentOptions = [], isLoading: studentsLoading } = useQuery({
    queryKey: ["payments-students", resolvedLibraryId],
    queryFn: async (): Promise<StudentOption[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, plan, seat_number")
        .eq("library_id", resolvedLibraryId)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const {
    data: rows = [],
    error,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ["dashboard-payments", resolvedLibraryId],
    queryFn: async (): Promise<PaymentRow[]> => {
      if (!resolvedLibraryId) return [];

      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, created_at, payment_method, payment_screenshot, plan, seat_id, source, status, students:student_id(full_name, seat_number)")
        .eq("library_id", resolvedLibraryId)
        .order("created_at", { ascending: false })
        .limit(250);
      if (error) throw error;

      return ((data ?? []) as PaymentLedgerRow[]).map((payment) => ({
        amount: Number(payment.amount),
        created_at: payment.created_at,
        id: payment.id,
        payment_method: payment.payment_method,
        payment_screenshot: payment.payment_screenshot,
        plan: payment.plan,
        seat_id: payment.seat_id,
        source: payment.source,
        status: payment.status,
        student_name: payment.students?.full_name ?? "Student",
        student_seat_number: payment.students?.seat_number ?? payment.seat_id ?? null,
      }));
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === form.student_id) ?? null,
    [form.student_id, studentOptions],
  );

  const addPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (!form.student_id) throw new Error("Please select a student.");
      if (!form.amount || Number(form.amount) <= 0) throw new Error("Enter a valid amount.");

      const payload: Database["public"]["Tables"]["payments"]["Insert"] = {
        amount: Number(form.amount),
        library_id: resolvedLibraryId,
        payment_method: form.payment_method || "manual",
        plan: form.plan || selectedStudent?.plan || null,
        seat_id: selectedStudent?.seat_number || null,
        source: "manual",
        status: form.status,
        student_id: form.student_id,
      };

      const { error } = await supabase.from("payments").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Payment added" });
      setDialogOpen(false);
      setForm(initialForm);
      queryClient.invalidateQueries({ queryKey: ["dashboard-payments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to add payment", description: error.message, variant: "destructive" });
    },
  });

  const approvePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("payments")
        .update({ status: "approved" })
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Renewal approved", description: "Student expiry date has been extended by 30 days." });
      queryClient.invalidateQueries({ queryKey: ["dashboard-payments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const openScreenshotPreview = async (payment: PaymentRow) => {
    if (!payment.payment_screenshot) return;

    const { data, error } = await supabase.storage
      .from(PAYMENT_SCREENSHOT_BUCKET)
      .createSignedUrl(payment.payment_screenshot, 3600);

    if (error) {
      toast({ title: "Unable to open screenshot", description: error.message, variant: "destructive" });
      return;
    }

    setPreviewTitle(`${payment.student_name} • ${format(new Date(payment.created_at), "dd MMM yyyy, hh:mm a")}`);
    setPreviewUrl(data.signedUrl);
    setPreviewOpen(true);
  };

  const pendingRenewals = useMemo(
    () => rows.filter((payment) => payment.source === "student_renewal" && payment.status.toLowerCase() === "pending"),
    [rows],
  );
  const approvedRenewals = useMemo(
    () => rows.filter((payment) => payment.source === "student_renewal" && payment.status.toLowerCase() === "approved"),
    [rows],
  );
  const collectedRevenue = useMemo(
    () =>
      rows
        .filter((payment) => isSuccessfulPaymentStatus(payment.status))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [rows],
  );

  const handleExport = () => {
    if (rows.length === 0) {
      toast({ title: "No payments to export", variant: "destructive" });
      return;
    }

    exportToCsv(
      "payments",
      rows.map((row) => ({
        amount: row.amount,
        date: row.created_at,
        method: row.payment_method || "",
        payer: row.student_name,
        plan: row.plan || "",
        seat: row.student_seat_number || "",
        source: row.source,
        status: row.status,
      })),
    );
    toast({ title: "Export started" });
  };

  const loading = roleLibraryLoading || fallbackLoading || isLoading;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Payments</h2>
            <p className="text-sm text-muted-foreground mt-1">Review student renewal proofs and maintain the payment ledger.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!resolvedLibraryId}>
                  <Plus className="w-4 h-4 mr-1" /> Add Payment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">Add Manual Payment</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Student</Label>
                    <Select
                      value={form.student_id || "none"}
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          student_id: value === "none" ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select student" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select student</SelectItem>
                        {studentOptions.map((student) => (
                          <SelectItem key={student.id} value={student.id}>
                            {student.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Amount (INR)</Label>
                      <Input type="number" placeholder="3500" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={form.status} onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                          <SelectItem value="refunded">Refunded</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Input
                      placeholder="Plan name"
                      value={form.plan || selectedStudent?.plan || ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Input
                      placeholder="cash / upi / card"
                      value={form.payment_method}
                      onChange={(e) => setForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                    />
                  </div>

                  <Button className="w-full" disabled={studentsLoading || addPaymentMutation.isPending || !form.student_id || !form.amount} onClick={() => addPaymentMutation.mutate()}>
                    {addPaymentMutation.isPending ? "Saving..." : "Save Payment"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Pending Proofs</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{pendingRenewals.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Approved Renewals</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{approvedRenewals.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Collected Revenue</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">Rs {collectedRevenue.toLocaleString("en-IN")}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display">Renewal Proof Verification</CardTitle>
            <CardDescription>Approve student UPI screenshot submissions. Approval automatically extends seat validity by 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Seat</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Screenshot</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!resolvedLibraryId && !loading ? (
                    <TableRow>
                      <TableCell className="text-center text-destructive" colSpan={6}>
                        Library not linked to your account. Please check user role setup.
                      </TableCell>
                    </TableRow>
                  ) : loading ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={6}>
                        Loading renewal proofs...
                      </TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell className="text-center text-destructive" colSpan={6}>
                        Unable to load payments: {getErrorMessage(error)}
                      </TableCell>
                    </TableRow>
                  ) : pendingRenewals.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={6}>
                        No pending payment screenshots.
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingRenewals.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <p className="font-medium text-foreground">{payment.student_name}</p>
                          <p className="text-xs text-muted-foreground">{payment.plan || "Membership"}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{payment.student_seat_number || "-"}</TableCell>
                        <TableCell className="font-semibold text-foreground">Rs {payment.amount.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(payment.created_at), "dd MMM yyyy, hh:mm a")}</TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => openScreenshotPreview(payment)} disabled={!payment.payment_screenshot}>
                            <Eye className="w-3.5 h-3.5 mr-1" /> View
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => approvePaymentMutation.mutate(payment.id)} disabled={approvePaymentMutation.isPending}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-display">Payment Ledger</CardTitle>
            <CardDescription>All manual and renewal payments recorded for this library.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Payer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Proof</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!resolvedLibraryId && !loading ? (
                    <TableRow>
                      <TableCell className="text-center text-destructive" colSpan={8}>
                        Library not linked to your account. Please check user role setup.
                      </TableCell>
                    </TableRow>
                  ) : loading ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={8}>
                        Loading payments...
                      </TableCell>
                    </TableRow>
                  ) : isError ? (
                    <TableRow>
                      <TableCell className="text-center text-destructive" colSpan={8}>
                        Unable to load payments: {getErrorMessage(error)}
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={8}>
                        No payments found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{payment.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{payment.student_name}</p>
                          <p className="text-xs text-muted-foreground">{payment.student_seat_number || "-"}</p>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground">Rs {payment.amount.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="capitalize text-muted-foreground">{payment.source.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-muted-foreground">{payment.payment_method || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(payment.created_at), "dd MMM yyyy")}</TableCell>
                        <TableCell>{getStatusBadge(payment.status)}</TableCell>
                        <TableCell>
                          {payment.payment_screenshot ? (
                            <Button variant="ghost" size="sm" onClick={() => openScreenshotPreview(payment)}>
                              <ImageIcon className="w-3.5 h-3.5 mr-1" /> View
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">{previewTitle || "Payment Screenshot"}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <img src={previewUrl} alt="Payment screenshot" className="w-full rounded-lg border border-border object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">Screenshot preview unavailable.</p>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default PaymentsPage;
