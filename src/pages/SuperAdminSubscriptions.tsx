import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Plus, Rocket, Search, Trash2, Zap } from "lucide-react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  formatInr,
  formatSeatLimit,
  SUBSCRIPTION_BILLING_DAYS,
} from "@/lib/subscription";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type LibrarySummaryRow = Pick<
  Database["public"]["Tables"]["libraries"]["Row"],
  "id" | "name" | "city" | "enabled"
>;

type SubscriptionRowBase = Database["public"]["Tables"]["library_subscriptions"]["Row"] & {
  plan_price?: number | null;
  plan_start_date?: string | null;
  plan_expiry_date?: string | null;
  payment_status?: string | null;
};

type AdminSubscriptionRow = {
  id: string;
  library_id: string;
  plan_name: string | null;
  plan_price: number | null;
  plan_start_date: string | null;
  plan_expiry_date: string | null;
  payment_status: string | null;
  status: string;
  price: number;
  seats_limit: number;
  features: string[];
  libraries: LibrarySummaryRow | null;
};

type SubscriptionPlanAdminRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  seats_limit: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type CouponDashboardRow = {
  id: string;
  code: string;
  discount_type: "percentage" | "flat";
  discount_value: number;
  expires_at: string | null;
  max_uses: number | null;
  is_active: boolean;
  uses_reserved: number;
  uses_captured: number;
  created_at: string;
  updated_at: string;
};

type AffiliateDashboardRow = {
  affiliate_id: string;
  code: string;
  name: string;
  email: string;
  commission_rate: number;
  is_active: boolean;
  total_referrals: number;
  total_earnings: number;
  pending_payouts: number;
  created_at: string;
  updated_at: string;
};

const planIcons = {
  starter: Zap,
  growth: Rocket,
  pro: Crown,
} as const;

const toDateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
const setEndOfDayIso = (value: string) => new Date(`${value}T23:59:59.000Z`).toISOString();
const normalizePlanCode = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
const normalizeCouponCode = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const featuresToTextarea = (features: string[] | null | undefined) => (features?.length ? features.join("\n") : "");
const parseFeaturesTextarea = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const statusVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
  if (status === "active") return "default";
  if (status === "trial") return "secondary";
  if (status === "expired") return "outline";
  return "destructive";
};

const paymentVariant = (paymentStatus: string | null): "default" | "secondary" | "outline" | "destructive" => {
  const status = (paymentStatus || "").toLowerCase();
  if (status === "paid") return "default";
  if (status === "trial") return "secondary";
  if (status === "pending") return "outline";
  return "destructive";
};

const normalizeSubscriptionRow = (
  subscription: SubscriptionRowBase,
  librariesById: Map<string, LibrarySummaryRow>,
): AdminSubscriptionRow => ({
  id: subscription.id,
  library_id: subscription.library_id,
  plan_name: subscription.plan_name,
  plan_price: subscription.plan_price ?? subscription.price,
  plan_start_date: subscription.plan_start_date ?? subscription.started_at,
  plan_expiry_date: subscription.plan_expiry_date ?? subscription.expires_at,
  payment_status: subscription.payment_status ?? (subscription.status === "trial" ? "trial" : subscription.status),
  status: subscription.status,
  price: subscription.price,
  seats_limit: subscription.seats_limit,
  features: Array.isArray(subscription.features) ? (subscription.features as string[]) : [],
  libraries: librariesById.get(subscription.library_id) ?? null,
});

const SuperAdminSubscriptions = () => {
  const [tab, setTab] = useState("subscriptions");
  const [search, setSearch] = useState("");
  const [editSub, setEditSub] = useState<AdminSubscriptionRow | null>(null);
  const [extendDays, setExtendDays] = useState(String(SUBSCRIPTION_BILLING_DAYS));

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlanAdminRow | null>(null);
  const [planForm, setPlanForm] = useState({
    code: "",
    name: "",
    description: "",
    price: "",
    seats_limit: "",
    features: "",
    sort_order: "100",
    is_active: true,
  });

  const [couponDialogOpen, setCouponDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponDashboardRow | null>(null);
  const [couponForm, setCouponForm] = useState({
    code: "",
    discount_type: "percentage" as "percentage" | "flat",
    discount_value: "",
    expires_on: "",
    max_uses: "",
    is_active: true,
  });

  const [affiliateDialogOpen, setAffiliateDialogOpen] = useState(false);
  const [editingAffiliate, setEditingAffiliate] = useState<AffiliateDashboardRow | null>(null);
  const [affiliateForm, setAffiliateForm] = useState({
    name: "",
    email: "",
    commission_rate: "10",
    is_active: true,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: planRows = [], isLoading: planRowsLoading } = useQuery({
    queryKey: ["admin-subscription-plans"],
    queryFn: async (): Promise<SubscriptionPlanAdminRow[]> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("subscription_plans" as any)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;

      return (data as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        code: normalizePlanCode(String(row.code ?? "")),
        name: String(row.name ?? ""),
        description: row.description == null ? null : String(row.description),
        price: Number(row.price ?? 0),
        seats_limit: row.seats_limit == null ? null : Number(row.seats_limit),
        features: Array.isArray(row.features) ? row.features.map((feature) => String(feature)) : [],
        is_active: Boolean(row.is_active ?? true),
        sort_order: Number(row.sort_order ?? 100),
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? ""),
      }));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const plansByCode = useMemo(() => new Map(planRows.map((plan) => [plan.code, plan])), [planRows]);

  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async (): Promise<AdminSubscriptionRow[]> => {
      const [{ data: subscriptionRows, error: subscriptionError }, { data: libraryRows, error: libraryError }] = await Promise.all([
        supabase.from("library_subscriptions").select("*").order("created_at", { ascending: false }),
        supabase.from("libraries").select("id, name, city, enabled"),
      ]);

      if (subscriptionError) throw subscriptionError;
      if (libraryError) throw libraryError;

      const librariesById = new Map((libraryRows as LibrarySummaryRow[]).map((library) => [library.id, library]));
      return (subscriptionRows as SubscriptionRowBase[]).map((subscription) => normalizeSubscriptionRow(subscription, librariesById));
    },
  });

  const { data: coupons = [], isLoading: couponsLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async (): Promise<CouponDashboardRow[]> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("admin_coupon_dashboard" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      return (data as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ""),
        discount_type: (row.discount_type as "percentage" | "flat") ?? "percentage",
        discount_value: Number(row.discount_value ?? 0),
        expires_at: row.expires_at == null ? null : String(row.expires_at),
        max_uses: row.max_uses == null ? null : Number(row.max_uses),
        is_active: Boolean(row.is_active ?? true),
        uses_reserved: Number(row.uses_reserved ?? 0),
        uses_captured: Number(row.uses_captured ?? 0),
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? ""),
      }));
    },
    enabled: tab === "coupons",
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });

  const { data: affiliates = [], isLoading: affiliatesLoading } = useQuery({
    queryKey: ["admin-affiliates"],
    queryFn: async (): Promise<AffiliateDashboardRow[]> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("admin_affiliate_dashboard" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      return (data as Array<Record<string, unknown>>).map((row) => ({
        affiliate_id: String(row.affiliate_id),
        code: String(row.code ?? ""),
        name: String(row.name ?? ""),
        email: String(row.email ?? ""),
        commission_rate: Number(row.commission_rate ?? 0),
        is_active: Boolean(row.is_active ?? true),
        total_referrals: Number(row.total_referrals ?? 0),
        total_earnings: Number(row.total_earnings ?? 0),
        pending_payouts: Number(row.pending_payouts ?? 0),
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? ""),
      }));
    },
    enabled: tab === "affiliates",
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });

  const affiliateTotals = useMemo(
    () =>
      affiliates.reduce(
        (acc, affiliate) => ({
          total_referrals: acc.total_referrals + (affiliate.total_referrals || 0),
          total_earnings: acc.total_earnings + (affiliate.total_earnings || 0),
          pending_payouts: acc.pending_payouts + (affiliate.pending_payouts || 0),
        }),
        { total_referrals: 0, total_earnings: 0, pending_payouts: 0 },
      ),
    [affiliates],
  );

  const filtered = useMemo(
    () =>
      subscriptions.filter((subscription) =>
        `${subscription.libraries?.name || ""} ${subscription.libraries?.city || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [search, subscriptions],
  );

  const updateMutation = useMutation({
    mutationFn: async ({
      libraryId,
      subscription,
      library,
    }: {
      libraryId: string;
      subscription?: Record<string, unknown>;
      library?: Record<string, unknown>;
    }) => {
      const { error } = await supabase.functions.invoke("admin-libraries", {
        body: {
          library_id: libraryId,
          library,
          subscription,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions-stats"] });
      toast({ title: "Subscription updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to update subscription",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      const code = normalizePlanCode(planForm.code);
      const name = planForm.name.trim();
      const description = planForm.description.trim() || null;
      const price = Number(planForm.price);
      const sortOrder = Math.trunc(Number(planForm.sort_order || 100));
      const seatsLimitRaw = planForm.seats_limit.trim();
      const seatsLimit = seatsLimitRaw ? Math.trunc(Number(seatsLimitRaw)) : null;
      const features = parseFeaturesTextarea(planForm.features);

      if (!code) throw new Error("Plan code is required.");
      if (!name) throw new Error("Plan name is required.");
      if (!Number.isFinite(price) || price < 0) throw new Error("Price must be 0 or greater.");
      if (!Number.isFinite(sortOrder)) throw new Error("Sort order must be a number.");
      if (seatsLimitRaw && (!Number.isFinite(seatsLimit) || Number(seatsLimit) <= 0)) {
        throw new Error("Seat limit must be greater than 0 (or leave blank for unlimited).");
      }

      const payload = {
        code,
        name,
        description,
        price,
        seats_limit: seatsLimit,
        features,
        is_active: planForm.is_active,
        sort_order: sortOrder,
      };

      if (editingPlan) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("subscription_plans" as any)
          .update(payload)
          .eq("id", editingPlan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("subscription_plans" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      setPlanDialogOpen(false);
      setEditingPlan(null);
      setPlanForm({
        code: "",
        name: "",
        description: "",
        price: "",
        seats_limit: "",
        features: "",
        sort_order: "100",
        is_active: true,
      });
      toast({ title: editingPlan ? "Plan updated" : "Plan created" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save plan", description: error.message, variant: "destructive" });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("subscription_plans" as any)
        .delete()
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscription-plans"] });
      toast({ title: "Plan deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete plan", description: error.message, variant: "destructive" });
    },
  });

  const saveCouponMutation = useMutation({
    mutationFn: async () => {
      const code = normalizeCouponCode(couponForm.code);
      const discountType = couponForm.discount_type;
      const discountValue = Number(couponForm.discount_value);
      const maxUsesRaw = couponForm.max_uses.trim();
      const maxUses = maxUsesRaw ? Math.trunc(Number(maxUsesRaw)) : null;
      const expiresAt = couponForm.expires_on ? setEndOfDayIso(couponForm.expires_on) : null;

      if (!code) throw new Error("Coupon code is required.");
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new Error("Discount value must be greater than 0.");
      }
      if (maxUsesRaw && (!Number.isFinite(maxUses) || Number(maxUses) <= 0)) {
        throw new Error("Max uses must be greater than 0 (or leave blank for unlimited).");
      }

      const payload = {
        code,
        discount_type: discountType,
        discount_value: discountValue,
        expires_at: expiresAt,
        max_uses: maxUses,
        is_active: couponForm.is_active,
      };

      if (editingCoupon) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("coupons" as any)
          .update(payload)
          .eq("id", editingCoupon.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("coupons" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      setCouponDialogOpen(false);
      setEditingCoupon(null);
      setCouponForm({
        code: "",
        discount_type: "percentage",
        discount_value: "",
        expires_on: "",
        max_uses: "",
        is_active: true,
      });
      toast({ title: editingCoupon ? "Coupon updated" : "Coupon created" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save coupon", description: error.message, variant: "destructive" });
    },
  });

  const deleteCouponMutation = useMutation({
    mutationFn: async (couponId: string) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("coupons" as any)
        .delete()
        .eq("id", couponId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      toast({ title: "Coupon deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete coupon", description: error.message, variant: "destructive" });
    },
  });

  const saveAffiliateMutation = useMutation({
    mutationFn: async () => {
      const name = affiliateForm.name.trim();
      const email = affiliateForm.email.trim().toLowerCase();
      const commissionRate = Number(affiliateForm.commission_rate);

      if (!name) throw new Error("Partner name is required.");
      if (!email) throw new Error("Partner email is required.");
      if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        throw new Error("Commission rate must be between 0 and 100.");
      }

      const payload = {
        name,
        email,
        commission_rate: commissionRate,
        is_active: affiliateForm.is_active,
      };

      if (editingAffiliate) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("affiliates" as any)
          .update(payload)
          .eq("id", editingAffiliate.affiliate_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("affiliates" as any)
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      setAffiliateDialogOpen(false);
      setEditingAffiliate(null);
      setAffiliateForm({
        name: "",
        email: "",
        commission_rate: "10",
        is_active: true,
      });
      toast({ title: editingAffiliate ? "Partner updated" : "Partner created" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save affiliate", description: error.message, variant: "destructive" });
    },
  });

  const deleteAffiliateMutation = useMutation({
    mutationFn: async (affiliateId: string) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliates" as any)
        .delete()
        .eq("id", affiliateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      toast({ title: "Partner deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete affiliate", description: error.message, variant: "destructive" });
    },
  });

  const resolvePlan = (value: string | null | undefined) => plansByCode.get(normalizePlanCode(value)) ?? null;

  const applyPlan = (planCode: string) => {
    if (!editSub) return;
    const plan = resolvePlan(planCode);
    if (!plan) return;

    setEditSub({
      ...editSub,
      plan_name: plan.code,
      plan_price: plan.price,
      price: plan.price,
      seats_limit: plan.seats_limit ?? 0,
      features: plan.features,
    });
  };

  const saveSubscription = (subscription: Record<string, unknown>, library?: Record<string, unknown>) => {
    if (!editSub) return;
    updateMutation.mutate({
      libraryId: editSub.library_id,
      subscription,
      library,
    });
  };

  const handleSaveChanges = () => {
    if (!editSub) return;

    const subscriptionPayload: Record<string, unknown> = {
      plan_name: editSub.plan_name,
      plan_price: editSub.plan_price,
      plan_start_date: editSub.plan_start_date,
      plan_expiry_date: editSub.plan_expiry_date,
      payment_status: editSub.payment_status,
      status: editSub.status,
      price: editSub.plan_price ?? editSub.price,
      seats_limit: editSub.seats_limit,
      features: editSub.features,
    };

    if (editSub.plan_start_date) {
      subscriptionPayload.started_at = editSub.plan_start_date;
    }
    if (editSub.plan_expiry_date) {
      subscriptionPayload.expires_at = editSub.plan_expiry_date;
    }

    saveSubscription(subscriptionPayload, {
      enabled: editSub.libraries?.enabled ?? true,
    });
  };

  const handleActivatePlan = () => {
    if (!editSub) return;
    const plan = resolvePlan(editSub.plan_name) ?? planRows[0] ?? null;
    if (!plan) return;

    const now = new Date();
    const expiry = addDays(now, SUBSCRIPTION_BILLING_DAYS);

    setEditSub({
      ...editSub,
      plan_name: plan.code,
      plan_price: plan.price,
      price: plan.price,
      seats_limit: plan.seats_limit ?? 0,
      features: plan.features,
      payment_status: "paid",
      status: "active",
      plan_start_date: now.toISOString(),
      plan_expiry_date: expiry.toISOString(),
      libraries: editSub.libraries ? { ...editSub.libraries, enabled: true } : editSub.libraries,
    });

    saveSubscription(
      {
        plan_name: plan.code,
        plan_price: plan.price,
        price: plan.price,
        seats_limit: plan.seats_limit ?? 0,
        features: plan.features,
        payment_status: "paid",
        status: "active",
        plan_start_date: now.toISOString(),
        plan_expiry_date: expiry.toISOString(),
        started_at: now.toISOString(),
        expires_at: expiry.toISOString(),
      },
      { enabled: true },
    );
  };

  const handleExtendPlan = () => {
    if (!editSub) return;

    const days = Math.max(1, Number(extendDays) || SUBSCRIPTION_BILLING_DAYS);
    const baseDate =
      editSub.plan_expiry_date && new Date(editSub.plan_expiry_date) > new Date()
        ? new Date(editSub.plan_expiry_date)
        : new Date();
    const nextExpiry = addDays(baseDate, days);
    const nextStart = editSub.plan_start_date ?? new Date().toISOString();

    setEditSub({
      ...editSub,
      payment_status: "paid",
      status: "active",
      plan_start_date: nextStart,
      plan_expiry_date: nextExpiry.toISOString(),
    });

    saveSubscription({
      payment_status: "paid",
      status: "active",
      plan_start_date: nextStart,
      plan_expiry_date: nextExpiry.toISOString(),
      started_at: nextStart,
      expires_at: nextExpiry.toISOString(),
    });
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Subscriptions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage library access, plans, coupons, and partner performance.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="subscriptions">Libraries</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="coupons">Coupons</TabsTrigger>
            <TabsTrigger value="affiliates">Partners</TabsTrigger>
          </TabsList>

          <TabsContent value="subscriptions" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {planRowsLoading ? (
                <Card className="md:col-span-3">
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading plans...</CardContent>
                </Card>
              ) : planRows.length ? (
                planRows.map((plan) => {
                  const Icon = planIcons[plan.code as keyof typeof planIcons] ?? Zap;
                  return (
                    <Card
                      key={plan.id}
                      className={[
                        plan.code === "growth" ? "border-primary ring-1 ring-primary/30" : "",
                        plan.is_active ? "" : "opacity-80",
                      ].join(" ")}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-5 w-5 text-primary" />
                          <div className="flex flex-col">
                            <CardTitle className="text-lg font-display">{plan.name}</CardTitle>
                            <span className="text-xs text-muted-foreground">{plan.code}</span>
                          </div>
                          {!plan.is_active ? (
                            <Badge variant="outline" className="ml-auto">
                              Disabled
                            </Badge>
                          ) : plan.code === "growth" ? (
                            <Badge className="ml-auto">Popular</Badge>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-3xl font-bold text-foreground">{formatInr(plan.price)}</p>
                          <p className="text-sm text-muted-foreground">per 30 days</p>
                        </div>
                        <p className="text-sm font-medium text-foreground">{formatSeatLimit(plan.seats_limit)}</p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {plan.features.slice(0, 5).map((feature) => (
                            <li key={feature}>{feature}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card className="md:col-span-3">
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No subscription plans yet. Create one under Plans.
                  </CardContent>
                </Card>
              )}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg font-display">Library subscriptions</CardTitle>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Search library or city"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading subscriptions...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Library</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead className="hidden md:table-cell">Expiry</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Account</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((subscription) => {
                        const planDisplay = resolvePlan(subscription.plan_name)?.name ?? subscription.plan_name ?? "Not set";
                        return (
                          <TableRow key={subscription.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{subscription.libraries?.name || "Unknown library"}</p>
                                <p className="text-xs text-muted-foreground">{subscription.libraries?.city || "No city"}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="text-foreground">{planDisplay}</p>
                                <p className="text-xs text-muted-foreground">{formatInr(subscription.plan_price ?? subscription.price)}</p>
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {subscription.plan_expiry_date ? format(new Date(subscription.plan_expiry_date), "dd MMM yyyy") : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={paymentVariant(subscription.payment_status)}>
                                {(subscription.payment_status || "trial").toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(subscription.status)}>{subscription.status}</Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Badge variant={subscription.libraries?.enabled === false ? "destructive" : "secondary"}>
                                {subscription.libraries?.enabled === false ? "Disabled" : "Enabled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => setEditSub(subscription)}>
                                Manage
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg font-display">Subscription plans</CardTitle>
                  <Button
                    onClick={() => {
                      setEditingPlan(null);
                      setPlanForm({
                        code: "",
                        name: "",
                        description: "",
                        price: "",
                        seats_limit: "",
                        features: "",
                        sort_order: "100",
                        is_active: true,
                      });
                      setPlanDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create plan
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {planRowsLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading plans...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead className="hidden md:table-cell">Seats</TableHead>
                        <TableHead className="hidden md:table-cell">Active</TableHead>
                        <TableHead className="hidden md:table-cell">Sort</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planRows.map((plan) => (
                        <TableRow key={plan.id}>
                          <TableCell className="font-mono text-xs">{plan.code}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-foreground">{plan.name}</p>
                              {plan.description ? (
                                <p className="text-xs text-muted-foreground">{plan.description}</p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>{formatInr(plan.price)}</TableCell>
                          <TableCell className="hidden md:table-cell">{formatSeatLimit(plan.seats_limit)}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant={plan.is_active ? "secondary" : "outline"}>{plan.is_active ? "Active" : "Disabled"}</Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">{plan.sort_order}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingPlan(plan);
                                  setPlanForm({
                                    code: plan.code,
                                    name: plan.name,
                                    description: plan.description ?? "",
                                    price: String(plan.price),
                                    seats_limit: plan.seats_limit == null ? "" : String(plan.seats_limit),
                                    features: featuresToTextarea(plan.features),
                                    sort_order: String(plan.sort_order),
                                    is_active: plan.is_active,
                                  });
                                  setPlanDialogOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (!window.confirm(`Delete plan ${plan.name} (${plan.code})?`)) return;
                                  deletePlanMutation.mutate(plan.id);
                                }}
                                disabled={deletePlanMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coupons" className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg font-display">Coupons</CardTitle>
                  <Button
                    onClick={() => {
                      setEditingCoupon(null);
                      setCouponForm({
                        code: "",
                        discount_type: "percentage",
                        discount_value: "",
                        expires_on: "",
                        max_uses: "",
                        is_active: true,
                      });
                      setCouponDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create coupon
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {couponsLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading coupons...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Discount</TableHead>
                        <TableHead className="hidden md:table-cell">Expires</TableHead>
                        <TableHead className="hidden md:table-cell">Uses</TableHead>
                        <TableHead className="hidden md:table-cell">Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coupons.map((coupon) => (
                        <TableRow key={coupon.id}>
                          <TableCell className="font-mono text-xs">{coupon.code}</TableCell>
                          <TableCell>
                            {coupon.discount_type === "percentage"
                              ? `${coupon.discount_value}%`
                              : formatInr(coupon.discount_value)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {coupon.expires_at ? format(new Date(coupon.expires_at), "dd MMM yyyy") : "-"}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {coupon.uses_captured} captured / {coupon.uses_reserved} active
                            {coupon.max_uses ? ` (max ${coupon.max_uses})` : ""}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant={coupon.is_active ? "secondary" : "outline"}>
                              {coupon.is_active ? "Active" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingCoupon(coupon);
                                  setCouponForm({
                                    code: coupon.code,
                                    discount_type: coupon.discount_type,
                                    discount_value: String(coupon.discount_value),
                                    expires_on: toDateInput(coupon.expires_at),
                                    max_uses: coupon.max_uses == null ? "" : String(coupon.max_uses),
                                    is_active: coupon.is_active,
                                  });
                                  setCouponDialogOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (!window.confirm(`Delete coupon ${coupon.code}?`)) return;
                                  deleteCouponMutation.mutate(coupon.id);
                                }}
                                disabled={deleteCouponMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="affiliates" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-display">Total referrals</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-bold text-foreground">{affiliateTotals.total_referrals}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-display">Total earnings</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-bold text-foreground">{formatInr(affiliateTotals.total_earnings)}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-display">Pending payouts</CardTitle>
                </CardHeader>
                <CardContent className="text-3xl font-bold text-foreground">{formatInr(affiliateTotals.pending_payouts)}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg font-display">Partners</CardTitle>
                  <Button
                    onClick={() => {
                      setEditingAffiliate(null);
                      setAffiliateForm({
                        name: "",
                        email: "",
                        commission_rate: "10",
                        is_active: true,
                      });
                      setAffiliateDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add partner
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {affiliatesLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading partners...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden md:table-cell">Email</TableHead>
                        <TableHead className="hidden md:table-cell">Rate</TableHead>
                        <TableHead className="hidden md:table-cell">Referrals</TableHead>
                        <TableHead className="hidden md:table-cell">Earnings</TableHead>
                        <TableHead className="hidden md:table-cell">Pending</TableHead>
                        <TableHead className="hidden md:table-cell">Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {affiliates.map((affiliate) => (
                        <TableRow key={affiliate.affiliate_id}>
                          <TableCell className="font-mono text-xs">{affiliate.code}</TableCell>
                          <TableCell className="font-medium text-foreground">{affiliate.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{affiliate.email}</TableCell>
                          <TableCell className="hidden md:table-cell">{affiliate.commission_rate}%</TableCell>
                          <TableCell className="hidden md:table-cell">{affiliate.total_referrals}</TableCell>
                          <TableCell className="hidden md:table-cell">{formatInr(affiliate.total_earnings)}</TableCell>
                          <TableCell className="hidden md:table-cell">{formatInr(affiliate.pending_payouts)}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <Badge variant={affiliate.is_active ? "secondary" : "outline"}>
                              {affiliate.is_active ? "Active" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingAffiliate(affiliate);
                                  setAffiliateForm({
                                    name: affiliate.name,
                                    email: affiliate.email,
                                    commission_rate: String(affiliate.commission_rate),
                                    is_active: affiliate.is_active,
                                  });
                                  setAffiliateDialogOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (!window.confirm(`Delete affiliate ${affiliate.name}?`)) return;
                                  deleteAffiliateMutation.mutate(affiliate.affiliate_id);
                                }}
                                disabled={deleteAffiliateMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={!!editSub} onOpenChange={(open) => !open && setEditSub(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-display">
                Manage subscription{editSub?.libraries?.name ? `: ${editSub.libraries.name}` : ""}
              </DialogTitle>
            </DialogHeader>

            {editSub ? (
              <div className="space-y-5 pt-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Select
                      value={normalizePlanCode(editSub.plan_name || planRows[0]?.code || "starter")}
                      onValueChange={(value) => applyPlan(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {planRows.length ? (
                          planRows.map((plan) => (
                            <SelectItem key={plan.id} value={plan.code}>
                              {plan.name} ({plan.code}) - {formatInr(plan.price)}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="starter">Starter</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Payment status</Label>
                    <Select
                      value={(editSub.payment_status || "trial").toLowerCase()}
                      onValueChange={(value) => setEditSub({ ...editSub, payment_status: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Access status</Label>
                    <Select value={editSub.status} onValueChange={(value) => setEditSub({ ...editSub, status: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Library enabled</Label>
                    <div className="flex h-10 items-center justify-between rounded-md border px-3">
                      <span className="text-sm text-foreground">
                        {editSub.libraries?.enabled === false ? "Disabled" : "Enabled"}
                      </span>
                      <Switch
                        checked={editSub.libraries?.enabled ?? true}
                        onCheckedChange={(enabled) =>
                          setEditSub({
                            ...editSub,
                            libraries: editSub.libraries ? { ...editSub.libraries, enabled } : editSub.libraries,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Plan start date</Label>
                    <Input
                      type="date"
                      value={toDateInput(editSub.plan_start_date)}
                      onChange={(event) =>
                        setEditSub({
                          ...editSub,
                          plan_start_date: event.target.value ? new Date(`${event.target.value}T00:00:00.000Z`).toISOString() : null,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Plan expiry date</Label>
                    <Input
                      type="date"
                      value={toDateInput(editSub.plan_expiry_date)}
                      onChange={(event) =>
                        setEditSub({
                          ...editSub,
                          plan_expiry_date: event.target.value ? setEndOfDayIso(event.target.value) : null,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 rounded-xl border border-border bg-secondary/20 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Plan price</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{formatInr(editSub.plan_price ?? editSub.price)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Seat limit</p>
                    <p className="mt-1 text-base font-semibold text-foreground">{formatSeatLimit(editSub.seats_limit || null)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Next action</p>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {editSub.status === "active" ? "Renew or extend" : "Activate access"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Button onClick={handleActivatePlan} disabled={updateMutation.isPending}>
                    Activate plan
                  </Button>

                  <div className="flex gap-2 sm:col-span-2">
                    <Input
                      type="number"
                      min="1"
                      value={extendDays}
                      onChange={(event) => setExtendDays(event.target.value)}
                    />
                    <Button variant="outline" onClick={handleExtendPlan} disabled={updateMutation.isPending}>
                      Extend plan
                    </Button>
                  </div>
                </div>

                <Button className="w-full" onClick={handleSaveChanges} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog
          open={planDialogOpen}
          onOpenChange={(open) => {
            setPlanDialogOpen(open);
            if (!open) {
              setEditingPlan(null);
              setPlanForm({
                code: "",
                name: "",
                description: "",
                price: "",
                seats_limit: "",
                features: "",
                sort_order: "100",
                is_active: true,
              });
            }
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-display">{editingPlan ? "Edit plan" : "Create plan"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Plan code</Label>
                  <Input
                    value={planForm.code}
                    onChange={(event) => setPlanForm({ ...planForm, code: event.target.value })}
                    placeholder="starter"
                    disabled={!!editingPlan}
                  />
                  <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores, hyphens.</p>
                </div>

                <div className="space-y-2">
                  <Label>Plan name</Label>
                  <Input value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Description</Label>
                  <Input
                    value={planForm.description}
                    onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })}
                    placeholder="Optional"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Price (INR)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={planForm.price}
                    onChange={(event) => setPlanForm({ ...planForm, price: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Seat limit</Label>
                  <Input
                    type="number"
                    min="1"
                    value={planForm.seats_limit}
                    onChange={(event) => setPlanForm({ ...planForm, seats_limit: event.target.value })}
                    placeholder="Blank = unlimited"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    value={planForm.sort_order}
                    onChange={(event) => setPlanForm({ ...planForm, sort_order: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Active</Label>
                  <div className="flex h-10 items-center justify-between rounded-md border px-3">
                    <span className="text-sm text-foreground">{planForm.is_active ? "Active" : "Disabled"}</span>
                    <Switch checked={planForm.is_active} onCheckedChange={(is_active) => setPlanForm({ ...planForm, is_active })} />
                  </div>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Features (one per line)</Label>
                  <Textarea
                    value={planForm.features}
                    onChange={(event) => setPlanForm({ ...planForm, features: event.target.value })}
                    placeholder={`Up to 50 seats\nSeat management\nNotifications`}
                  />
                </div>
              </div>

              <Button className="w-full" onClick={() => savePlanMutation.mutate()} disabled={savePlanMutation.isPending}>
                {savePlanMutation.isPending ? "Saving..." : editingPlan ? "Update plan" : "Create plan"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={couponDialogOpen}
          onOpenChange={(open) => {
            setCouponDialogOpen(open);
            if (!open) {
              setEditingCoupon(null);
              setCouponForm({
                code: "",
                discount_type: "percentage",
                discount_value: "",
                expires_on: "",
                max_uses: "",
                is_active: true,
              });
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display">{editingCoupon ? "Edit coupon" : "Create coupon"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Code</Label>
                  <Input value={couponForm.code} onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value })} />
                </div>

                <div className="space-y-2">
                  <Label>Discount type</Label>
                  <Select
                    value={couponForm.discount_type}
                    onValueChange={(value) => setCouponForm({ ...couponForm, discount_type: value as "percentage" | "flat" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="flat">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{couponForm.discount_type === "percentage" ? "Discount (%)" : "Discount (INR)"}</Label>
                  <Input
                    type="number"
                    min="1"
                    value={couponForm.discount_value}
                    onChange={(event) => setCouponForm({ ...couponForm, discount_value: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Expires on</Label>
                  <Input
                    type="date"
                    value={couponForm.expires_on}
                    onChange={(event) => setCouponForm({ ...couponForm, expires_on: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Max uses</Label>
                  <Input
                    type="number"
                    min="1"
                    value={couponForm.max_uses}
                    onChange={(event) => setCouponForm({ ...couponForm, max_uses: event.target.value })}
                    placeholder="Blank = unlimited"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Active</Label>
                  <div className="flex h-10 items-center justify-between rounded-md border px-3">
                    <span className="text-sm text-foreground">{couponForm.is_active ? "Active" : "Disabled"}</span>
                    <Switch checked={couponForm.is_active} onCheckedChange={(is_active) => setCouponForm({ ...couponForm, is_active })} />
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={() => saveCouponMutation.mutate()} disabled={saveCouponMutation.isPending}>
                {saveCouponMutation.isPending ? "Saving..." : editingCoupon ? "Update coupon" : "Create coupon"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={affiliateDialogOpen}
          onOpenChange={(open) => {
            setAffiliateDialogOpen(open);
            if (!open) {
              setEditingAffiliate(null);
              setAffiliateForm({
                name: "",
                email: "",
                commission_rate: "10",
                is_active: true,
              });
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display">{editingAffiliate ? "Edit partner" : "Add partner"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              {editingAffiliate ? (
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Partner ID</p>
                  <p className="mt-1 font-mono text-sm text-foreground">{editingAffiliate.code}</p>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={affiliateForm.name} onChange={(event) => setAffiliateForm({ ...affiliateForm, name: event.target.value })} />
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={affiliateForm.email}
                    onChange={(event) => setAffiliateForm({ ...affiliateForm, email: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Commission rate (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={affiliateForm.commission_rate}
                    onChange={(event) => setAffiliateForm({ ...affiliateForm, commission_rate: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Active</Label>
                  <div className="flex h-10 items-center justify-between rounded-md border px-3">
                    <span className="text-sm text-foreground">{affiliateForm.is_active ? "Active" : "Disabled"}</span>
                    <Switch checked={affiliateForm.is_active} onCheckedChange={(is_active) => setAffiliateForm({ ...affiliateForm, is_active })} />
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={() => saveAffiliateMutation.mutate()} disabled={saveAffiliateMutation.isPending}>
                {saveAffiliateMutation.isPending ? "Saving..." : editingAffiliate ? "Update partner" : "Add partner"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminSubscriptions;
