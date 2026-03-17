import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, TrendingUp, Users2, Wallet } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";

type PartnerDashboardRow = {
  affiliate_id: string;
  total_referrals: number;
  total_earnings: number;
  pending_payouts: number;
};

type LeadRow = {
  id: string;
  library_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  seats: number | null;
  status: string;
  created_at: string;
};

type CommissionRow = {
  id: string;
  commission_earned: number;
  status: string;
  created_at: string;
  libraries?: { name: string | null; city: string | null } | null;
};

type LeaderboardRow = {
  rank: number;
  partner_code: string;
  partner_name: string;
  city: string | null;
  total_sales: number;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const getReferralBaseUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : "";

  if (hostname === "partner.libriofy.com") return "https://libriofy.com";
  if (hostname === "partner.localhost") return `${protocol}//localhost${port}`;
  return `${protocol}//${hostname}${port}`;
};

const statusBadge = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "converted") return <Badge className="bg-success/15 text-success border-success/30">Converted</Badge>;
  if (normalized === "demo_done") return <Badge variant="secondary">Demo Done</Badge>;
  if (normalized === "contacted") return <Badge variant="secondary">Contacted</Badge>;
  if (normalized === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">New</Badge>;
};

const PartnerDashboard = () => {
  const { toast } = useToast();

  const { data: partner, isLoading: partnerLoading } = usePartnerAffiliate();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["partner-dashboard-metrics", partner?.id],
    queryFn: async (): Promise<PartnerDashboardRow | null> => {
      if (!partner?.id) return null;
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("admin_affiliate_dashboard" as any)
        .select("affiliate_id, total_referrals, total_earnings, pending_payouts")
        .eq("affiliate_id", partner.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        affiliate_id: String(data.affiliate_id),
        total_referrals: Number(data.total_referrals ?? 0),
        total_earnings: Number(data.total_earnings ?? 0),
        pending_payouts: Number(data.pending_payouts ?? 0),
      };
    },
    enabled: !!partner?.id,
    staleTime: 30_000,
  });

  const { data: recentLeads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["partner-recent-leads", partner?.id],
    queryFn: async (): Promise<LeadRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, library_name, owner_name, phone, city, seats, status, created_at")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as LeadRow[];
    },
    enabled: !!partner?.id,
    staleTime: 15_000,
  });

  const { data: leadsCount = 0 } = useQuery({
    queryKey: ["partner-leads-count", partner?.id],
    queryFn: async (): Promise<number> => {
      if (!partner?.id) return 0;
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", partner.id);
      if (error) throw error;
      return Number(count ?? 0);
    },
    enabled: !!partner?.id,
    staleTime: 15_000,
  });

  const { data: recentCommissions = [], isLoading: commissionsLoading } = useQuery({
    queryKey: ["partner-recent-commissions", partner?.id],
    queryFn: async (): Promise<CommissionRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliate_commissions" as any)
        .select("id, commission_earned, status, created_at, libraries(name, city)")
        .eq("affiliate_id", partner.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as CommissionRow[];
    },
    enabled: !!partner?.id,
    staleTime: 15_000,
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ["partner-leaderboard", 5],
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await supabase.rpc("get_partner_leaderboard", { p_limit: 5 });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        rank: Number(row.rank ?? 0),
        partner_code: String(row.partner_code ?? ""),
        partner_name: String(row.partner_name ?? ""),
        city: row.city == null ? null : String(row.city),
        total_sales: Number(row.total_sales ?? 0),
      }));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const referralLink = useMemo(() => {
    if (!partner?.code) return "";
    return `${getReferralBaseUrl()}/signup?ref=${encodeURIComponent(partner.code)}`;
  }, [partner?.code]);

  const isLoading = partnerLoading || dashboardLoading;
  const totalLeads = leadsCount;

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">
            Welcome{partner?.name ? `, ${partner.name}` : ""}{" "}
          </h2>
          <p className="text-sm text-muted-foreground">
            Track your leads, sales, commissions, and payouts.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Sales" value={isLoading ? "—" : String(dashboard?.total_referrals ?? 0)} icon={TrendingUp} />
          <StatsCard
            title="Commission Earned"
            value={isLoading ? "—" : formatInr(dashboard?.total_earnings ?? 0)}
            icon={Wallet}
          />
          <StatsCard
            title="Pending Payout"
            value={isLoading ? "—" : formatInr(dashboard?.pending_payouts ?? 0)}
            icon={Wallet}
            iconColor="text-warning"
          />
          <StatsCard title="Total Leads" value={isLoading ? "—" : String(totalLeads)} icon={Users2} />
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Your Referral Link</CardTitle>
            {partner?.code ? <Badge variant="secondary">{partner.code}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={referralLink} readOnly placeholder="Referral link will appear here" />
              <Button
                type="button"
                variant="outline"
                disabled={!referralLink}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(referralLink);
                    toast({ title: "Copied", description: "Referral link copied to clipboard." });
                  } catch (error: any) {
                    toast({ title: "Copy failed", description: error?.message ?? "Unable to copy.", variant: "destructive" });
                  }
                }}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this link when a library owner signs up. The system automatically tracks the sale and assigns your commission.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Recent Leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {leadsLoading ? (
                <p className="text-sm text-muted-foreground">Loading leads...</p>
              ) : recentLeads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads yet. Add your first lead from the Leads tab.</p>
              ) : (
                <div className="space-y-3">
                  {recentLeads.map((lead) => (
                    <div key={lead.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{lead.library_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {lead.owner_name} • {lead.phone} {lead.city ? `• ${lead.city}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0">{statusBadge(lead.status)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Recent Commissions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {commissionsLoading ? (
                <p className="text-sm text-muted-foreground">Loading commissions...</p>
              ) : recentCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commissions yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentCommissions.map((row) => (
                    <div key={row.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {row.libraries?.name ?? "Library"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {row.libraries?.city ?? "—"} • {new Date(row.created_at).toLocaleDateString("en-IN")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-foreground">{formatInr(Number(row.commission_earned ?? 0))}</p>
                        <Badge variant={row.status === "paid" ? "secondary" : "outline"}>{row.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Top Partners</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground">Leaderboard unavailable.</p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((row) => {
                  const isMe = !!partner?.code && row.partner_code === partner.code;
                  return (
                    <div
                      key={row.rank}
                      className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                        isMe ? "bg-primary/5 border-primary/20" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {row.rank}. {row.partner_name || row.partner_code}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {row.city ?? "—"} • {row.partner_code}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-foreground">{row.total_sales} sales</p>
                        {isMe ? <Badge variant="secondary">You</Badge> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">How to sell (quick model)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-4">
              <p className="font-medium text-foreground">1) Find libraries</p>
              <p className="mt-1 text-muted-foreground">Use Google Maps to shortlist library owners in your city.</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium text-foreground">2) Demo + follow-up</p>
              <p className="mt-1 text-muted-foreground">Call, send demo video, and schedule a 10-minute walkthrough.</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium text-foreground">3) Close via link</p>
              <p className="mt-1 text-muted-foreground">Ask them to sign up using your referral link so commission auto-tracks.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">What counts as a sale?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            A sale is counted when a referred library completes its first successful subscription payment.
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerDashboard;
