import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Wallet } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";

type PartnerDashboardRow = {
  affiliate_id: string;
  commission_rate?: number | null;
  total_referrals: number;
  total_earnings: number;
  pending_payouts: number;
};

type PayoutRow = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  payout_method: string | null;
  payout_destination: string | null;
  requested_at: string;
  approved_at: string | null;
  paid_at: string | null;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const payoutBadge = (status: PayoutRow["status"]) => {
  if (status === "paid") return <Badge className="bg-success/15 text-success border-success/30">Paid</Badge>;
  if (status === "approved") return <Badge variant="secondary">Approved</Badge>;
  if (status === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">Pending</Badge>;
};

const MIN_PAYOUT_THRESHOLD = 1000;

const PartnerPayoutsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: partner, isLoading: partnerLoading } = usePartnerAffiliate();
  const [calcLeads, setCalcLeads] = useState("10");
  const [calcRate, setCalcRate] = useState("20");

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["partner-dashboard-metrics", partner?.id],
    queryFn: async (): Promise<PartnerDashboardRow | null> => {
      if (!partner?.id) return null;
      const { data, error } = await supabase
        .from("admin_affiliate_dashboard")
        .select("affiliate_id, total_referrals, total_earnings, pending_payouts")
        .eq("affiliate_id", partner.id)
        .returns<PartnerDashboardRow[]>()
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const metrics = data;
      return {
        affiliate_id: String(metrics.affiliate_id),
        total_referrals: Number(metrics.total_referrals ?? 0),
        total_earnings: Number(metrics.total_earnings ?? 0),
        pending_payouts: Number(metrics.pending_payouts ?? 0),
      };
    },
    enabled: !!partner?.id,
    staleTime: 15_000,
  });

  const { data: payouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ["partner-payouts", partner?.id],
    queryFn: async (): Promise<PayoutRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("payouts")
        .select("id, amount, status, payout_method, payout_destination, requested_at, approved_at, paid_at")
        .eq("partner_id", partner.id)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String((row as any).id),
        amount: Number((row as any).amount ?? 0),
        status: String((row as any).status ?? "pending") as PayoutRow["status"],
        payout_method: (row as any).payout_method == null ? null : String((row as any).payout_method),
        payout_destination: (row as any).payout_destination == null ? null : String((row as any).payout_destination),
        requested_at: String((row as any).requested_at ?? (row as any).created_at ?? ""),
        approved_at: (row as any).approved_at == null ? null : String((row as any).approved_at),
        paid_at: (row as any).paid_at == null ? null : String((row as any).paid_at),
      }));
    },
    enabled: !!partner?.id,
    staleTime: 10_000,
  });

  const pendingAmount = dashboard?.pending_payouts ?? 0;
  const commissionRate = dashboard?.commission_rate ?? partner?.commission_rate ?? 10;
  const avgCommission = dashboard?.total_referrals
    ? (dashboard?.total_earnings ?? 0) / Math.max(1, dashboard?.total_referrals ?? 0)
    : 2000;

  const activeRequest = useMemo(
    () => payouts.find((p) => p.status === "pending" || p.status === "approved") ?? null,
    [payouts],
  );

  const requestPayoutMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("request_partner_payout", {
        p_amount: null,
        p_payout_method: partner?.payout_method ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-payouts", partner?.id] });
      queryClient.invalidateQueries({ queryKey: ["partner-dashboard-metrics", partner?.id] });
      toast({ title: "Payout requested", description: "Admin will review your request." });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to request payout", description: error.message, variant: "destructive" });
    },
  });

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">Payouts</h2>
          <p className="text-sm text-muted-foreground">Request withdrawals and track payout status.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatsCard title="Commission Earned" value={dashboardLoading ? "—" : formatInr(dashboard?.total_earnings ?? 0)} icon={Wallet} />
          <StatsCard title="Pending Balance" value={dashboardLoading ? "—" : formatInr(pendingAmount)} icon={Clock} iconColor="text-warning" />
          <StatsCard title="Total Sales" value={dashboardLoading ? "—" : String(dashboard?.total_referrals ?? 0)} icon={CheckCircle2} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Estimated Income Calculator</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Leads</p>
              <Input value={calcLeads} onChange={(event) => setCalcLeads(event.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Conversion Rate (%)</p>
              <Input value={calcRate} onChange={(event) => setCalcRate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Estimated Earnings</p>
              <p className="text-lg font-semibold text-foreground">
                {formatInr(
                  Math.round(
                    (Number(calcLeads) || 0) * (Number(calcRate) || 0) / 100 * avgCommission,
                  ),
                )}
              </p>
            </div>
            <p className="text-xs text-muted-foreground md:col-span-3">
              Estimate uses your average commission (~{formatInr(Math.round(avgCommission))}). Commission rate is {commissionRate}%.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Request a payout</CardTitle>
            <Button
              disabled={
                partnerLoading ||
                dashboardLoading ||
                requestPayoutMutation.isPending ||
                pendingAmount < MIN_PAYOUT_THRESHOLD ||
                !!activeRequest
              }
              onClick={() => requestPayoutMutation.mutate()}
            >
              {requestPayoutMutation.isPending ? "Requesting..." : "Request Payout"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-muted-foreground">
                Minimum payout threshold: <span className="font-medium text-foreground">{formatInr(MIN_PAYOUT_THRESHOLD)}</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Your pending balance: <span className="font-medium text-foreground">{formatInr(pendingAmount)}</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                Payout method:{" "}
                <span className="font-medium text-foreground">{partner?.payout_method ?? "upi"}</span>
                {partner?.upi_id ? <span className="text-muted-foreground"> • {partner.upi_id}</span> : null}
              </p>
            </div>
            {activeRequest ? (
              <p className="text-muted-foreground">
                You already have a payout request in progress ({activeRequest.status}). Please wait for admin review.
              </p>
            ) : pendingAmount < MIN_PAYOUT_THRESHOLD ? (
              <p className="text-muted-foreground">
                Your pending balance is below the minimum threshold.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Requesting a payout submits your full pending balance to admin for approval.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Payout history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {payoutsLoading ? (
              <p className="text-sm text-muted-foreground">Loading payouts...</p>
            ) : payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payout requests yet.</p>
            ) : (
              <div className="space-y-3">
                {payouts.map((payout) => (
                  <div key={payout.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{formatInr(payout.amount)}</p>
                        {payoutBadge(payout.status)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {payout.payout_method ?? "upi"}
                        {payout.payout_destination ? ` • ${payout.payout_destination}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Requested {new Date(payout.requested_at).toLocaleString("en-IN")}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {payout.paid_at ? (
                        <span>Paid {new Date(payout.paid_at).toLocaleDateString("en-IN")}</span>
                      ) : payout.approved_at ? (
                        <span>Approved {new Date(payout.approved_at).toLocaleDateString("en-IN")}</span>
                      ) : (
                        <span>Awaiting approval</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerPayoutsPage;
