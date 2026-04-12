import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  BarChart3,
  BellRing,
  Flame,
  Handshake,
  TrendingUp,
  Users2,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import PartnerAiAssistant from "@/components/partner/PartnerAiAssistant";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { getReferralLink } from "@/lib/partnerLinks";

type PartnerDashboardRow = {
  affiliate_id: string;
  total_referrals: number;
  total_earnings: number;
  pending_payouts: number;
  commission_rate?: number | null;
};

type LeadRow = {
  id: string;
  owner_name: string;
  library_name: string;
  city: string | null;
  phone: string;
  status: string;
  created_at: string;
  expected_value: number | null;
};

type CommissionRow = {
  id: string;
  commission_earned: number;
  created_at: string;
  status: string;
};

type LeaderboardRow = {
  rank: number;
  partner_code: string;
  partner_name: string;
  city: string | null;
  total_sales: number;
};

type NotificationRow = {
  id: string;
  title: string;
  message: string | null;
  created_at: string;
  scheduled_at: string | null;
  read: boolean;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const buildDailySeries = (rows: CommissionRow[], days: number) => {
  const today = new Date();
  const series = Array.from({ length: days }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const label = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    return { label, value: 0 };
  });

  rows.forEach((row) => {
    const date = new Date(row.created_at);
    const label = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    const bucket = series.find((item) => item.label === label);
    if (bucket) bucket.value += Number(row.commission_earned ?? 0);
  });

  return series;
};

const getPartnerLevel = (totalSales: number) => {
  if (totalSales >= 30) return { label: "Champion", next: 50 };
  if (totalSales >= 15) return { label: "Pro", next: 30 };
  if (totalSales >= 5) return { label: "Closer", next: 15 };
  return { label: "Beginner", next: 5 };
};

const PartnerDashboard = () => {
  const { data: partner, isLoading: partnerLoading } = usePartnerAffiliate();
  const isMissingColumnError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: string }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
    return code === "42703" || /column .* does not exist/i.test(message);
  };
  const isMissingTableError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: string }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
    return code === "42P01" || /relation .* does not exist/i.test(message);
  };

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["partner-dashboard-metrics", partner?.id],
    queryFn: async (): Promise<PartnerDashboardRow | null> => {
      if (!partner?.id) return null;
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("admin_affiliate_dashboard" as any)
        .select("affiliate_id, total_referrals, total_earnings, pending_payouts, commission_rate")
        .eq("affiliate_id", partner.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const metrics = data as Record<string, unknown>;
      return {
        affiliate_id: String(metrics.affiliate_id),
        total_referrals: Number(metrics.total_referrals ?? 0),
        total_earnings: Number(metrics.total_earnings ?? 0),
        pending_payouts: Number(metrics.pending_payouts ?? 0),
        commission_rate: Number(metrics.commission_rate ?? partner.commission_rate ?? 10),
      };
    },
    enabled: !!partner?.id,
    staleTime: 30_000,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["partner-leads", partner?.id],
    queryFn: async (): Promise<LeadRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, owner_name, library_name, city, phone, status, created_at, expected_value")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });
      if (!error) {
        return (data ?? []) as LeadRow[];
      }
      if (isMissingColumnError(error)) {
        console.warn("[partner-dashboard] Legacy leads schema detected. Falling back to core columns.", error);
        const fallback = await supabase
          .from("leads")
          .select("id, owner_name, library_name, city, phone, status, created_at")
          .eq("partner_id", partner.id)
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return ((fallback.data ?? []) as LeadRow[]).map((lead) => ({ ...lead, expected_value: null }));
      }
      throw error;
    },
    enabled: !!partner?.id,
  });

  const { data: commissions = [] } = useQuery({
    queryKey: ["partner-commissions-30d", partner?.id],
    queryFn: async (): Promise<CommissionRow[]> => {
      if (!partner?.id) return [];
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliate_commissions" as any)
        .select("id, commission_earned, created_at, status")
        .eq("affiliate_id", partner.id)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as CommissionRow[]).map((row) => ({
        ...row,
        commission_earned: Number(row.commission_earned ?? 0),
      }));
    },
    enabled: !!partner?.id,
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ["partner-notifications-preview", partner?.id],
    queryFn: async (): Promise<NotificationRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("partner_notifications")
        .select("id, title, message, created_at, scheduled_at, read")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[partner-dashboard] partner_notifications table missing. Skipping preview.", error);
          return [];
        }
        throw error;
      }
      return (data ?? []) as NotificationRow[];
    },
    enabled: !!partner?.id,
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
  });

  const now = new Date();
  const todayLabel = now.toDateString();

  const todayEarnings = commissions
    .filter((row) => new Date(row.created_at).toDateString() === todayLabel)
    .reduce((sum, row) => sum + Number(row.commission_earned ?? 0), 0);

  const monthEarnings = commissions
    .filter((row) => {
      const date = new Date(row.created_at);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((sum, row) => sum + Number(row.commission_earned ?? 0), 0);

  const totalLeads = leads.length;
  const convertedLeads = leads.filter((lead) => lead.status === "converted").length;
  const conversionRate = totalLeads ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const leadsToday = leads.filter((lead) => new Date(lead.created_at).toDateString() === todayLabel).length;
  const leadsLast7 = leads.filter((lead) => {
    const created = new Date(lead.created_at);
    const diff = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;
  const leadsPerDay = Math.round((leadsLast7 / 7) * 10) / 10;

  const avgCommission = dashboard?.total_referrals
    ? dashboard.total_earnings / Math.max(1, dashboard.total_referrals)
    : 0;
  const expectedEarnings = Math.round(totalLeads * (conversionRate / 100) * avgCommission);

  const funnelData = useMemo(() => {
    const counts = {
      New: leads.filter((lead) => lead.status === "new").length,
      Contacted: leads.filter((lead) => lead.status === "contacted").length,
      "Demo Scheduled": leads.filter((lead) => lead.status === "demo_done").length,
      Converted: leads.filter((lead) => lead.status === "converted").length,
    };

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leads]);

  const dailySeries = useMemo(() => buildDailySeries(commissions, 7), [commissions]);
  const monthlySeries = useMemo(() => buildDailySeries(commissions, 30), [commissions]);

  const level = getPartnerLevel(dashboard?.total_referrals ?? 0);
  const progress = Math.min(100, Math.round(((dashboard?.total_referrals ?? 0) / level.next) * 100));
  const goalProgress = Math.min(100, Math.round(((dashboard?.total_earnings ?? 0) / 10000) * 100));

  const referralLink = partner?.code ? getReferralLink(partner.code) : "";
  const bestCity = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (!lead.city) return;
      counts.set(lead.city, (counts.get(lead.city) ?? 0) + 1);
    });
    let topCity = "—";
    let topCount = 0;
    counts.forEach((count, city) => {
      if (count > topCount) {
        topCity = city;
        topCount = count;
      }
    });
    return topCity;
  }, [leads]);

  const motivationMessage = () => {
    if ((dashboard?.total_referrals ?? 0) === 0) return "🔥 You’re close to your first sale. Add 3 leads today.";
    if ((dashboard?.total_referrals ?? 0) < 5) return "🎯 1 more sale = ₹2000 earned (approx).";
    if ((dashboard?.total_referrals ?? 0) < 15) return "🚀 You’re growing fast. Push to Pro level this week.";
    return "🏆 You’re in the top performers. Keep the streak alive.";
  };

  const isLoading = partnerLoading || dashboardLoading;

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">
            Welcome{partner?.name ? `, ${partner.name}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            Your income command center — track earnings, move leads, and close faster.
          </p>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <Flame className="h-6 w-6 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Motivation</p>
                <p className="text-base font-semibold text-foreground">{motivationMessage()}</p>
              </div>
            </div>
            <Button asChild>
              <a href="/partner/leads">Start Earning Now</a>
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <StatsCard title="Today’s Earnings" value={isLoading ? "—" : formatInr(todayEarnings)} icon={Wallet} />
          <StatsCard title="This Month" value={isLoading ? "—" : formatInr(monthEarnings)} icon={TrendingUp} />
          <StatsCard title="Pending Payout" value={isLoading ? "—" : formatInr(dashboard?.pending_payouts ?? 0)} icon={Wallet} iconColor="text-warning" />
          <StatsCard title="Conversion Rate" value={isLoading ? "—" : `${conversionRate}%`} icon={BarChart3} />
          <StatsCard title="Expected Earnings" value={isLoading ? "—" : formatInr(expectedEarnings)} icon={Handshake} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-display">Sales Last 7 Days</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatInr(Number(value))} />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Lead Funnel</CardTitle>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#22c55e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-display">Action Center — Start Earning Now</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { title: "Add 10 leads", link: "/partner/leads", desc: "Create your pipeline and unlock earnings." },
                { title: "Contact via WhatsApp / Call", link: "/partner/leads", desc: "Use one-tap outreach actions." },
                { title: "Schedule demo", link: "/partner/leads", desc: "Move leads to demo stage quickly." },
                { title: "Close using referral link", link: "/partner/kit", desc: "Track conversions and commissions." },
              ].map((step, index) => (
                <Card key={step.title} className="border border-border/70">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Step {index + 1}</p>
                    <p className="text-base font-semibold text-foreground">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                    <Button asChild size="sm">
                      <a href={step.link}>Go</a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Income Goal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">₹10,000 goal</span>
                <span className="font-semibold text-foreground">{goalProgress}%</span>
              </div>
              <Progress value={goalProgress} />
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Current level</p>
                <p className="text-base font-semibold text-foreground">{level.label}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={progress} className="flex-1" />
                  <span className="text-xs text-muted-foreground">{progress}%</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "First Sale", active: (dashboard?.total_referrals ?? 0) >= 1 },
                  { label: "5 Sales", active: (dashboard?.total_referrals ?? 0) >= 5 },
                  { label: "10 Sales", active: (dashboard?.total_referrals ?? 0) >= 10 },
                ].map((badge) => (
                  <Badge key={badge.label} variant={badge.active ? "secondary" : "outline"}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Commission Structure</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Commission Rate</p>
              <p className="text-lg font-semibold text-foreground">{dashboard?.commission_rate ?? partner?.commission_rate ?? 10}%</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Avg Commission / Sale</p>
              <p className="text-lg font-semibold text-foreground">{formatInr(Math.round(avgCommission || 0))}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Paid Amount</p>
              <p className="text-lg font-semibold text-foreground">
                {formatInr(Math.max(0, (dashboard?.total_earnings ?? 0) - (dashboard?.pending_payouts ?? 0)))}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Smart Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No alerts yet. Add leads to trigger reminders.</p>
              ) : (
                notifications.map((note) => (
                  <div key={note.id} className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-sm font-medium text-foreground">{note.title}</p>
                    {note.message ? <p className="text-xs text-muted-foreground mt-1">{note.message}</p> : null}
                  </div>
                ))
              )}
              {leadsToday === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">You haven’t added leads today</p>
                  <p className="text-xs text-amber-700 mt-1">Add 3 new leads to keep your streak alive.</p>
                </div>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <a href="/partner/notifications">View all</a>
              </Button>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-display">Sales Performance (30 days)</CardTitle>
            </CardHeader>
            <CardContent className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatInr(Number(value))} />
                  <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <PartnerAiAssistant />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Referral Link</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm break-all">
                {referralLink || "Your referral link will appear here."}
              </div>
              <Button asChild size="sm">
                <a href="/partner/kit">Open Marketing Kit</a>
              </Button>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <Award className="h-4 w-4" /> Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">Leaderboard unavailable.</p>
              ) : (
                leaderboard.map((row) => (
                  <div key={row.rank} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {row.rank}. {row.partner_name || row.partner_code}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.city ?? "—"}</p>
                    </div>
                    <Badge variant="secondary">{row.total_sales} sales</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <BellRing className="h-4 w-4" /> Smart Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Leads Added</p>
              <p className="text-lg font-semibold text-foreground">{totalLeads}</p>
              <p className="text-xs text-muted-foreground mt-1">~{leadsPerDay} per day (last 7d)</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Best Performing City</p>
              <p className="text-lg font-semibold text-foreground">
                {bestCity}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Best Time To Call</p>
              <p className="text-lg font-semibold text-foreground">11 AM – 2 PM</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerDashboard;
