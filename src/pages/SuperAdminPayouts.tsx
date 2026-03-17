import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PayoutStatus = "pending" | "approved" | "paid" | "rejected";

type AdminPayoutRow = {
  id: string;
  partner_id: string;
  amount: number;
  status: PayoutStatus;
  payout_method: string | null;
  payout_destination: string | null;
  requested_at: string;
  approved_at: string | null;
  paid_at: string | null;
  affiliates?: { code: string | null; name: string | null; email: string | null; phone: string | null } | null;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

const badgeForStatus = (status: PayoutStatus) => {
  if (status === "paid") return <Badge className="bg-success/15 text-success border-success/30">Paid</Badge>;
  if (status === "approved") return <Badge variant="secondary">Approved</Badge>;
  if (status === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
};

const SuperAdminPayouts = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PayoutStatus | "all">("all");

  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: async (): Promise<AdminPayoutRow[]> => {
      const { data, error } = await supabase
        .from("payouts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id, partner_id, amount, status, payout_method, payout_destination, requested_at, approved_at, paid_at, affiliates(code, name, email, phone)" as any)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: String(row.id),
        partner_id: String(row.partner_id),
        amount: Number(row.amount ?? 0),
        status: String(row.status ?? "pending") as PayoutStatus,
        payout_method: row.payout_method == null ? null : String(row.payout_method),
        payout_destination: row.payout_destination == null ? null : String(row.payout_destination),
        requested_at: String(row.requested_at ?? row.created_at ?? ""),
        approved_at: row.approved_at == null ? null : String(row.approved_at),
        paid_at: row.paid_at == null ? null : String(row.paid_at),
        affiliates: row.affiliates ?? null,
      }));
    },
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payouts.filter((payout) => {
      const matchesStatus = statusFilter === "all" ? true : payout.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      const partnerLabel = `${payout.affiliates?.code ?? ""} ${payout.affiliates?.name ?? ""} ${payout.affiliates?.email ?? ""} ${payout.affiliates?.phone ?? ""}`;
      return `${partnerLabel} ${payout.payout_destination ?? ""} ${payout.payout_method ?? ""}`.toLowerCase().includes(q);
    });
  }, [payouts, search, statusFilter]);

  const totals = useMemo(
    () =>
      payouts.reduce(
        (acc, payout) => {
          acc.total += 1;
          if (payout.status === "pending") acc.pending += payout.amount;
          if (payout.status === "approved") acc.approved += payout.amount;
          if (payout.status === "paid") acc.paid += payout.amount;
          return acc;
        },
        { total: 0, pending: 0, approved: 0, paid: 0 },
      ),
    [payouts],
  );

  const approveMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await supabase.rpc("admin_approve_partner_payout", { p_payout_id: payoutId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      toast({ title: "Payout approved" });
    },
    onError: (error: Error) => toast({ title: "Approval failed", description: error.message, variant: "destructive" }),
  });

  const paidMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await supabase.rpc("admin_mark_partner_payout_paid", { p_payout_id: payoutId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
      toast({ title: "Marked as paid" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (payoutId: string) => {
      const { error } = await supabase.from("payouts").update({ status: "rejected" }).eq("id", payoutId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      toast({ title: "Payout rejected" });
    },
    onError: (error: Error) => toast({ title: "Reject failed", description: error.message, variant: "destructive" }),
  });

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Payouts</h2>
            <p className="text-sm text-muted-foreground mt-1">Approve and pay partner commissions</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Requests</p><p className="text-xl font-bold font-display">{totals.total}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold font-display">{formatInr(totals.pending)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Approved</p><p className="text-xl font-bold font-display">{formatInr(totals.approved)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-bold font-display">{formatInr(totals.paid)}</p></CardContent></Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-[360px]">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payouts..." />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">All payout requests</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading payouts...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No payouts found.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Partner</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((payout) => (
                      <TableRow key={payout.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{payout.affiliates?.name ?? "—"}</span>
                              {payout.affiliates?.code ? <Badge variant="secondary">{payout.affiliates.code}</Badge> : null}
                            </div>
                            <p className="text-xs text-muted-foreground">{payout.affiliates?.email ?? "—"}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-foreground">{payout.payout_method ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{payout.payout_destination ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-right">{formatInr(payout.amount)}</TableCell>
                        <TableCell>{badgeForStatus(payout.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(payout.requested_at).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {payout.status === "pending" ? (
                              <>
                                <Button variant="outline" onClick={() => approveMutation.mutate(payout.id)} disabled={approveMutation.isPending}>
                                  Approve
                                </Button>
                                <Button variant="outline" onClick={() => rejectMutation.mutate(payout.id)} disabled={rejectMutation.isPending}>
                                  Reject
                                </Button>
                              </>
                            ) : payout.status === "approved" ? (
                              <Button onClick={() => paidMutation.mutate(payout.id)} disabled={paidMutation.isPending}>
                                Mark Paid
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminPayouts;

