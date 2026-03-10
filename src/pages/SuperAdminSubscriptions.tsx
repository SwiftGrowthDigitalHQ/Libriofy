import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Rocket, Search, Zap } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import {
  formatInr,
  formatSeatLimit,
  getSubscriptionPlan,
  SUBSCRIPTION_BILLING_DAYS,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlanName,
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

const planIcons = {
  starter: Zap,
  growth: Rocket,
  pro: Crown,
} as const;

const toDateInput = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
const setEndOfDayIso = (value: string) => new Date(`${value}T23:59:59.000Z`).toISOString();

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
  const [search, setSearch] = useState("");
  const [editSub, setEditSub] = useState<AdminSubscriptionRow | null>(null);
  const [extendDays, setExtendDays] = useState(String(SUBSCRIPTION_BILLING_DAYS));
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const applyPlan = (planName: SubscriptionPlanName) => {
    if (!editSub) return;
    const plan = getSubscriptionPlan(planName);
    if (!plan) return;

    setEditSub({
      ...editSub,
      plan_name: plan.name,
      plan_price: plan.price,
      price: plan.price,
      seats_limit: plan.seatsLimit ?? 0,
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
    const plan = getSubscriptionPlan(editSub.plan_name);
    if (!plan) return;

    const now = new Date();
    const expiry = addDays(now, SUBSCRIPTION_BILLING_DAYS);

    setEditSub({
      ...editSub,
      plan_name: plan.name,
      plan_price: plan.price,
      price: plan.price,
      seats_limit: plan.seatsLimit ?? 0,
      features: plan.features,
      payment_status: "paid",
      status: "active",
      plan_start_date: now.toISOString(),
      plan_expiry_date: expiry.toISOString(),
      libraries: editSub.libraries ? { ...editSub.libraries, enabled: true } : editSub.libraries,
    });

    saveSubscription(
      {
        plan_name: plan.name,
        plan_price: plan.price,
        price: plan.price,
        seats_limit: plan.seatsLimit ?? 0,
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
            View every library plan, payment state, and account access status.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const Icon = planIcons[plan.name];
            return (
              <Card key={plan.name} className={plan.name === "growth" ? "border-primary ring-1 ring-primary/30" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg font-display">{plan.label}</CardTitle>
                    {plan.name === "growth" ? <Badge className="ml-auto">Popular</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-3xl font-bold text-foreground">{formatInr(plan.price)}</p>
                    <p className="text-sm text-muted-foreground">per 30 days</p>
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatSeatLimit(plan.seatsLimit)}</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
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
                  {filtered.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{subscription.libraries?.name || "Unknown library"}</p>
                          <p className="text-xs text-muted-foreground">{subscription.libraries?.city || "No city"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="capitalize text-foreground">{subscription.plan_name || "Not set"}</p>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

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
                    <Select value={(editSub.plan_name || "starter").toLowerCase()} onValueChange={(value) => applyPlan(value as SubscriptionPlanName)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUBSCRIPTION_PLANS.map((plan) => (
                          <SelectItem key={plan.name} value={plan.name}>
                            {plan.label} - {formatInr(plan.price)}
                          </SelectItem>
                        ))}
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
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminSubscriptions;
