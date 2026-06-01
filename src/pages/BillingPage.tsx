import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, CreditCard, Loader2, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  getEdgeFunctionAuthHeaders,
  isFunctionUnavailableError,
  readFunctionErrorMessage,
  waitForActiveLibrarySubscription,
} from "@/lib/billingEdgeFunctions";
import {
  logPaymentInitiated,
  logPaymentStart,
  logPaymentSuccess,
  type PaymentObservabilityContext,
  reportPaymentFailure,
} from "@/lib/observability/paymentObservability.client";
import {
  evaluateSubscriptionAccess,
  formatInr,
  formatLockerLimit,
  formatSeatLimit,
  resolveSubscriptionLockerLimit,
  resolveSubscriptionPlanLabel,
  resolveSubscriptionSeatLimit,
  SUBSCRIPTION_BILLING_DAYS,
} from "@/lib/subscription";
import { useLibrarySubscription } from "@/hooks/useLibrarySubscription";

type RazorpaySuccessResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => Promise<void> | void;
  prefill: Record<string, string>;
  theme: { color: string };
};

type RazorpayInstance = { open: () => void };
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

type CheckoutOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

type SubscriptionPlanDto = {
  code: string;
  name: string;
  description: string | null;
  price: number;
  seats_limit: number | null;
  lockers_limit: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
};

type SubscriptionQuoteResponse = {
  checkout: {
    message: string | null;
    provider: "razorpay" | "stripe";
    ready: boolean;
  };
  success: true;
  plan: {
    code: string;
    name: string;
    description: string | null;
    price: number;
    seats_limit: number | null;
    lockers_limit: number | null;
    features: unknown;
    is_active: boolean;
  };
  pricing: {
    months: number;
    unit_price: number;
    subtotal_amount: number;
    discount_amount: number;
    total_amount: number;
    discount_kind: "coupon" | "referral" | null;
    coupon_code: string | null;
  };
};

type LibraryCapacitySnapshot = Pick<
  Database["public"]["Tables"]["libraries"]["Row"],
  "id" | "max_lockers" | "max_seats" | "name" | "total_lockers" | "total_seats"
>;

const normalizePlanCode = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
const normalizeCouponCode = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const toFeaturesList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((feature) => String(feature));
};

const exceedsPlanLimit = (currentUsage: number, planLimit: number | null | undefined) =>
  typeof planLimit === "number" && planLimit > 0 && currentUsage > planLimit;

const BillingPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { libraryId } = useCurrentLibraryId();
  const { data: roles = [] } = useUserRole();
  const { data: subscription, isLoading } = useLibrarySubscription();
  const [selectedPlan, setSelectedPlan] = useState<string>("growth");
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const razorpayWindow = window as Window & { Razorpay?: RazorpayConstructor };

  const access = evaluateSubscriptionAccess(subscription);
  const isOwner = roles.some((role) => role.role === "library_owner");
  const currentPlanCode = useMemo(() => normalizePlanCode(subscription?.plan_name), [subscription?.plan_name]);

  const { data: librarySnapshot } = useQuery({
    queryKey: ["billing-library-capacity", libraryId],
    queryFn: async (): Promise<LibraryCapacitySnapshot | null> => {
      if (!libraryId) return null;
      const { data, error } = await supabase
        .from("libraries")
        .select("id, name, total_seats, total_lockers, max_seats, max_lockers")
        .eq("id", libraryId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!libraryId,
    staleTime: 30_000,
    gcTime: 2 * 60_000,
  });

  const { data: subscriptionPlans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: async (): Promise<SubscriptionPlanDto[]> => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("code, name, description, price, seats_limit, lockers_limit, features, is_active, sort_order")
        .order("sort_order", { ascending: true })
        .order("price", { ascending: true })
        .returns<Database["public"]["Tables"]["subscription_plans"]["Row"][]>();
      if (error) throw error;

      return (data ?? []).map((row) => ({
        code: normalizePlanCode(String(row.code ?? "")),
        name: String(row.name ?? ""),
        description: row.description == null ? null : String(row.description),
        price: Number(row.price ?? 0),
        seats_limit: row.seats_limit == null ? null : Number(row.seats_limit),
        lockers_limit: row.lockers_limit == null ? null : Number(row.lockers_limit),
        features: toFeaturesList(row.features),
        is_active: Boolean(row.is_active ?? true),
        sort_order: Number(row.sort_order ?? 100),
      }));
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const availablePlans = useMemo(() => subscriptionPlans.filter((plan) => plan.is_active), [subscriptionPlans]);
  const activeSeatLimit = useMemo(
    () => resolveSubscriptionSeatLimit(subscription) ?? librarySnapshot?.max_seats ?? null,
    [librarySnapshot?.max_seats, subscription],
  );
  const activeLockerLimit = useMemo(
    () => resolveSubscriptionLockerLimit(subscription) ?? librarySnapshot?.max_lockers ?? null,
    [librarySnapshot?.max_lockers, subscription],
  );
  const currentPlanDisplay = useMemo(() => {
    if (!subscription?.plan_name) return "Not activated";
    return (
      resolveSubscriptionPlanLabel(subscription) ??
      subscriptionPlans.find((plan) => plan.code === currentPlanCode)?.name ??
      subscription.plan_name
    );
  }, [currentPlanCode, subscription, subscription?.plan_name, subscriptionPlans]);

  useEffect(() => {
    if (!availablePlans.length) return;
    setSelectedPlan((prev) => {
      const prevCode = normalizePlanCode(prev);
      if (prevCode && availablePlans.some((plan) => plan.code === prevCode)) return prevCode;
      if (currentPlanCode && availablePlans.some((plan) => plan.code === currentPlanCode)) return currentPlanCode;
      return availablePlans[0].code;
    });
  }, [availablePlans, currentPlanCode]);

  const selectedPlanConfig = useMemo(
    () => availablePlans.find((plan) => plan.code === normalizePlanCode(selectedPlan)) ?? availablePlans[0] ?? null,
    [availablePlans, selectedPlan],
  );

  const selectedPlanCapacityWarning = useMemo(() => {
    if (!selectedPlanConfig || !librarySnapshot) return null;

    const warnings: string[] = [];
    if (exceedsPlanLimit(librarySnapshot.total_seats, selectedPlanConfig.seats_limit)) {
      warnings.push(`${librarySnapshot.total_seats} configured seats exceed the ${selectedPlanConfig.seats_limit} seat limit`);
    }
    if (exceedsPlanLimit(librarySnapshot.total_lockers, selectedPlanConfig.lockers_limit)) {
      warnings.push(`${librarySnapshot.total_lockers} configured lockers exceed the ${selectedPlanConfig.lockers_limit} locker limit`);
    }

    if (warnings.length === 0) return null;
    return `${warnings.join(" and ")}. Reduce capacity in Settings before switching to ${selectedPlanConfig.name}.`;
  }, [librarySnapshot, selectedPlanConfig]);

  const selectedPlanBlocked = !!selectedPlanCapacityWarning;

  const appliedCouponNormalized = useMemo(() => (appliedCoupon ? normalizeCouponCode(appliedCoupon) : ""), [appliedCoupon]);

  const {
    data: quote,
    error: quoteError,
    isFetching: quoteFetching,
    refetch: refetchQuote,
  } = useQuery({
    queryKey: ["subscription-quote", libraryId, normalizePlanCode(selectedPlan), appliedCouponNormalized],
    queryFn: async (): Promise<SubscriptionQuoteResponse | null> => {
      if (!libraryId || !selectedPlanConfig) return null;
      const headers = await getEdgeFunctionAuthHeaders();
      const { data, error } = await supabase.functions.invoke<SubscriptionQuoteResponse>("subscription-quote", {
        headers,
        body: {
          libraryId,
          planName: selectedPlanConfig.code,
          months: 1,
          couponCode: appliedCouponNormalized || undefined,
        },
      });

      if (error) throw new Error(await readFunctionErrorMessage(error, "subscription-quote"));
      if (!data?.success) return null;
      return data;
    },
    enabled: !!libraryId && !!selectedPlanConfig && !selectedPlanBlocked,
    staleTime: 30_000,
    gcTime: 2 * 60_000,
    retry: 1,
  });

  const quoteErrorMessage = quoteError instanceof Error ? quoteError.message : null;
  const checkoutUnavailableMessage = quote?.checkout.ready === false
    ? quote.checkout.message ?? "Checkout is temporarily unavailable while billing setup is being completed."
    : null;

  const applyCouponMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!libraryId || !selectedPlanConfig) throw new Error("Library not loaded yet.");

      const normalized = normalizeCouponCode(code);
      const headers = await getEdgeFunctionAuthHeaders();
      const { data, error } = await supabase.functions.invoke<SubscriptionQuoteResponse>("subscription-quote", {
        headers,
        body: {
          libraryId,
          planName: selectedPlanConfig.code,
          months: 1,
          couponCode: normalized,
        },
      });

      if (error) throw new Error(await readFunctionErrorMessage(error, "subscription-quote"));
      if (!data?.success) throw new Error("Unable to apply coupon.");
      return normalized;
    },
    onSuccess: (normalized) => {
      setAppliedCoupon(normalized);
      toast({ title: "Coupon applied", description: normalized });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to apply coupon", description: error.message, variant: "destructive" });
    },
  });

  const ensureRazorpayScript = async () => {
    if (razorpayWindow.Razorpay) return true;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Razorpay SDK."));
      document.body.appendChild(script);
    });
    return !!razorpayWindow.Razorpay;
  };

  const handleActivatePlan = async () => {
    if (!libraryId || !selectedPlanConfig || !isOwner) return;
    if (checkoutUnavailableMessage) {
      toast({
        title: "Checkout unavailable",
        description: checkoutUnavailableMessage,
        variant: "destructive",
      });
      return;
    }

    setCheckoutLoading(true);
    let paymentContext: PaymentObservabilityContext = {
      libraryId,
      months: 1,
      planCode: selectedPlanConfig.code,
      planName: selectedPlanConfig.name,
      source: "billing_page" as const,
    };

    try {
      await logPaymentStart(paymentContext);

      const headers = await getEdgeFunctionAuthHeaders();
      const { data: orderRes, error: orderError } = await supabase.functions.invoke<CheckoutOrderResponse>("create-payment", {
        headers,
        body: {
          libraryId,
          plan: selectedPlanConfig.code,
          months: 1,
          couponCode: appliedCouponNormalized || undefined,
        },
      });

      if (orderError) {
        throw new Error(await readFunctionErrorMessage(orderError, "create-payment"));
      }

      if (!orderRes?.orderId || typeof orderRes.amount !== "number" || !orderRes.currency) {
        console.error("create-payment: unexpected response", orderRes);
        throw new Error("Order creation failed.");
      }

      paymentContext = {
        ...paymentContext,
        amount: orderRes.amount,
        currency: orderRes.currency,
        orderId: orderRes.orderId,
      };

      await logPaymentInitiated(paymentContext);

      await ensureRazorpayScript();
      if (!razorpayWindow.Razorpay) throw new Error("Razorpay SDK unavailable.");

      const envKeyId = String(import.meta.env.VITE_RAZORPAY_KEY_ID ?? "").trim();
      const checkoutKeyId = orderRes.keyId || envKeyId;
      if (!checkoutKeyId) throw new Error("Missing Razorpay key id.");

      const razorpay = new razorpayWindow.Razorpay({
        key: checkoutKeyId,
        amount: orderRes.amount,
        currency: orderRes.currency,
        name: "Libriofy",
        description: `${selectedPlanConfig.name} plan activation`,
        order_id: orderRes.orderId,
        handler: async (response: RazorpaySuccessResponse) => {
          const verifyHeaders = await getEdgeFunctionAuthHeaders();
          const { error: verifyError } = await supabase.functions.invoke("verify-razorpay-payment", {
            headers: verifyHeaders,
            body: {
              libraryId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });

          if (verifyError) {
            const verifyMessage = await readFunctionErrorMessage(verifyError, "verify-razorpay-payment");
            const activatedSubscription = await waitForActiveLibrarySubscription(libraryId);

            if (activatedSubscription) {
              await logPaymentSuccess(
                {
                  ...paymentContext,
                  orderId: response.razorpay_order_id,
                  paymentId: response.razorpay_payment_id,
                },
                "Payment captured and plan activation completed via webhook fallback.",
              );
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["library-subscription", libraryId] }),
                queryClient.invalidateQueries({ queryKey: ["billing-library-capacity", libraryId] }),
                queryClient.invalidateQueries({ queryKey: ["settings-library", libraryId] }),
              ]);
              toast({
                title: "Plan activated",
                description: `${selectedPlanConfig.name} is active. Payment confirmation completed through the webhook.`,
              });
              navigate("/dashboard", { replace: true });
              return;
            }

            await reportPaymentFailure(
              {
                ...paymentContext,
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
              },
              new Error(verifyMessage),
              "verification",
            );

            toast({
              title: isFunctionUnavailableError(verifyError) ? "Payment received, activation pending" : "Payment verification failed",
              description: isFunctionUnavailableError(verifyError)
                ? `${verifyMessage} If Razorpay already captured the payment, the webhook can still activate your plan within a minute.`
                : verifyMessage,
              variant: isFunctionUnavailableError(verifyError) ? "default" : "destructive",
            });
            return;
          }

          await logPaymentSuccess(
            {
              ...paymentContext,
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
            },
            "Payment verified and plan activated.",
          );

          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["library-subscription", libraryId] }),
            queryClient.invalidateQueries({ queryKey: ["billing-library-capacity", libraryId] }),
            queryClient.invalidateQueries({ queryKey: ["settings-library", libraryId] }),
          ]);
          toast({
            title: "Plan activated",
            description: `${selectedPlanConfig.name} is now active for the next ${SUBSCRIPTION_BILLING_DAYS} days.`,
          });
          navigate("/dashboard", { replace: true });
        },
        prefill: {},
        theme: { color: "#0f766e" },
      });

      razorpay.open();
    } catch (error) {
      await reportPaymentFailure(paymentContext, error, "create_order");
      const message = error instanceof Error && error.message.trim() ? error.message : "Unable to start checkout.";
      console.error("[billing-page] checkout failed", {
        error: message,
        libraryId,
        paymentContext,
        selectedPlan: selectedPlanConfig.code,
      });
      toast({
        title: "Checkout failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const renderStatusMessage = () => {
    if (access.message) {
      return (
        <Alert variant={access.reason === "account_disabled" ? "destructive" : "default"}>
          <Lock className="h-4 w-4" />
          <AlertTitle>Billing access required</AlertTitle>
          <AlertDescription>{access.message}</AlertDescription>
        </Alert>
      );
    }

    if (access.reason === "active_trial" && access.trialEndDate) {
      return (
        <Alert>
          <CreditCard className="h-4 w-4" />
          <AlertTitle>Trial active</AlertTitle>
          <AlertDescription>
            Your free trial ends on {format(new Date(access.trialEndDate), "dd MMM yyyy")}. Choose a plan before then to avoid dashboard lock.
          </AlertDescription>
        </Alert>
      );
    }

    if (access.reason === "active_plan" && access.planExpiryDate) {
      return (
        <Alert>
          <CreditCard className="h-4 w-4" />
          <AlertTitle>Subscription active</AlertTitle>
          <AlertDescription>
            Your current plan is active until {format(new Date(access.planExpiryDate), "dd MMM yyyy")}.
          </AlertDescription>
        </Alert>
      );
    }

    return null;
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading billing details...
        </div>
      </DashboardLayout>
    );
  }

  const planIsSelected = selectedPlanConfig && normalizePlanCode(selectedPlan) === selectedPlanConfig.code;
  const quotePricing = quote?.pricing ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold font-display text-foreground">Billing</h2>
          <p className="text-sm text-muted-foreground">
            Activate or renew a library plan to keep dashboard access active.
          </p>
        </div>

        {renderStatusMessage()}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-display">Current access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={access.isAllowed ? "default" : "outline"}>
                  {access.isAllowed ? "Unlocked" : "Billing only"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium text-foreground">{currentPlanDisplay}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Payment</span>
                <span className="font-medium capitalize text-foreground">{subscription?.payment_status ?? "trial"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Trial ends</span>
                <span className="font-medium text-foreground">
                  {access.trialEndDate ? format(new Date(access.trialEndDate), "dd MMM yyyy") : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Plan expiry</span>
                <span className="font-medium text-foreground">
                  {access.planExpiryDate ? format(new Date(access.planExpiryDate), "dd MMM yyyy") : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Seats configured</span>
                <span className="font-medium text-foreground">
                  {librarySnapshot
                    ? `${librarySnapshot.total_seats} / ${activeSeatLimit == null ? "Unlimited" : activeSeatLimit}`
                    : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Lockers configured</span>
                <span className="font-medium text-foreground">
                  {librarySnapshot
                    ? `${librarySnapshot.total_lockers} / ${activeLockerLimit == null ? "Unlimited" : activeLockerLimit}`
                    : "-"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="font-display">Choose a plan</CardTitle>
              <CardDescription>All plans are billed every 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-3">
                {plansLoading ? (
                  <div className="lg:col-span-3 flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading plans...
                  </div>
                ) : availablePlans.length ? (
                  availablePlans.map((plan) => {
                    const isSelected = normalizePlanCode(selectedPlan) === plan.code;
                    const isCurrent = currentPlanCode === plan.code && access.isPlanActive;

                    return (
                      <button
                        key={plan.code}
                        type="button"
                        className={`rounded-xl border p-5 text-left transition-colors ${
                          isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
                        }`}
                        onClick={() => setSelectedPlan(plan.code)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold font-display text-foreground">{plan.name}</p>
                            {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}
                          </div>
                          {isCurrent ? <Badge>Current</Badge> : null}
                        </div>
                        <div className="mt-4">
                          <p className="text-3xl font-bold text-foreground">{formatInr(plan.price)}</p>
                          <p className="text-sm text-muted-foreground">per 30 days</p>
                        </div>
                        <div className="mt-3 space-y-1 text-sm font-medium text-foreground">
                          <p>{formatSeatLimit(plan.seats_limit)}</p>
                          <p>{formatLockerLimit(plan.lockers_limit)}</p>
                        </div>
                        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-primary" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </button>
                    );
                  })
                ) : (
                  <div className="lg:col-span-3 rounded-xl border border-dashed border-border bg-secondary/30 p-6 text-sm text-muted-foreground">
                    No active plans available yet. Ask a super admin to enable a plan in the Subscriptions panel.
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{selectedPlanConfig?.name ?? "Plan"}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedPlanBlocked ? (
                      "Reduce configured capacity in Settings before switching to this plan."
                    ) : quoteErrorMessage ? (
                      quoteErrorMessage
                    ) : quoteFetching || plansLoading ? (
                      "Calculating total..."
                    ) : quotePricing ? (
                      <>
                        {formatInr(quotePricing.total_amount)} for the next {SUBSCRIPTION_BILLING_DAYS} days
                        {quotePricing.discount_amount > 0 ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (saved {formatInr(quotePricing.discount_amount)}
                            {quotePricing.discount_kind === "coupon" && quotePricing.coupon_code ? ` with ${quotePricing.coupon_code}` : ""})
                          </span>
                        ) : null}
                      </>
                    ) : (
                      `${formatInr(selectedPlanConfig?.price ?? 0)} for the next ${SUBSCRIPTION_BILLING_DAYS} days`
                    )}
                  </p>
                  {selectedPlanConfig ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatSeatLimit(selectedPlanConfig.seats_limit)} and {formatLockerLimit(selectedPlanConfig.lockers_limit)}
                    </p>
                  ) : null}

                  {selectedPlanCapacityWarning ? (
                    <p className="mt-3 text-sm text-amber-700">{selectedPlanCapacityWarning}</p>
                  ) : null}

                  {quoteErrorMessage ? (
                    <Alert variant="destructive" className="mt-3">
                      <AlertTitle>Subscription quote failed</AlertTitle>
                      <AlertDescription className="space-y-3">
                        <span className="block">{quoteErrorMessage}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void refetchQuote();
                          }}
                        >
                          Retry quote
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {checkoutUnavailableMessage ? (
                    <Alert className="mt-3">
                      <AlertTitle>Checkout unavailable</AlertTitle>
                      <AlertDescription className="space-y-3">
                        <span className="block">{checkoutUnavailableMessage}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void refetchQuote();
                          }}
                        >
                          Refresh billing status
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="coupon" className="text-xs text-muted-foreground">
                        Coupon
                      </Label>
                      <Input
                        id="coupon"
                        value={couponInput}
                        placeholder="Enter coupon code"
                        onChange={(e) => setCouponInput(e.target.value)}
                        disabled={!libraryId || !selectedPlanConfig || selectedPlanBlocked}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => applyCouponMutation.mutate(couponInput)}
                        disabled={!couponInput.trim() || applyCouponMutation.isPending || !libraryId || !selectedPlanConfig || selectedPlanBlocked}
                      >
                        {applyCouponMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Applying...
                          </>
                        ) : (
                          "Apply"
                        )}
                      </Button>
                      {appliedCouponNormalized ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setAppliedCoupon(null);
                            setCouponInput("");
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleActivatePlan}
                  disabled={
                    checkoutLoading ||
                    !libraryId ||
                    !isOwner ||
                    access.reason === "account_disabled" ||
                    plansLoading ||
                    !selectedPlanConfig ||
                    !planIsSelected ||
                    !!checkoutUnavailableMessage ||
                    !!quoteErrorMessage ||
                    selectedPlanBlocked
                  }
                >
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Opening checkout...
                    </>
                  ) : isOwner ? (
                    selectedPlanBlocked
                      ? "Reduce capacity first"
                      : checkoutUnavailableMessage
                        ? "Checkout unavailable"
                        : access.isPlanActive
                          ? "Renew or switch plan"
                          : "Activate plan"
                  ) : (
                    "Only the library owner can pay"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default BillingPage;
