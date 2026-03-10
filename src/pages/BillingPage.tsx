import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, CreditCard, Loader2, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import {
  evaluateSubscriptionAccess,
  formatInr,
  formatSeatLimit,
  getSubscriptionPlan,
  SUBSCRIPTION_BILLING_DAYS,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlanName,
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
  order: { id: string; amount: number; currency: string };
  keyId: string;
};

const BillingPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { libraryId } = useCurrentLibraryId();
  const { data: roles = [] } = useUserRole();
  const { data: subscription, isLoading } = useLibrarySubscription();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanName>("growth");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const razorpayWindow = window as Window & { Razorpay?: RazorpayConstructor };

  const access = evaluateSubscriptionAccess(subscription);
  const isOwner = roles.some((role) => role.role === "library_owner");
  const currentPlan = useMemo(() => getSubscriptionPlan(subscription?.plan_name), [subscription?.plan_name]);

  useEffect(() => {
    if (currentPlan?.name) {
      setSelectedPlan(currentPlan.name);
      return;
    }
    if (subscription?.plan_name) {
      const resolvedPlan = getSubscriptionPlan(subscription.plan_name);
      if (resolvedPlan) {
        setSelectedPlan(resolvedPlan.name);
      }
    }
  }, [currentPlan?.name, subscription?.plan_name]);

  const selectedPlanConfig = useMemo(
    () => SUBSCRIPTION_PLANS.find((plan) => plan.name === selectedPlan) ?? SUBSCRIPTION_PLANS[1],
    [selectedPlan],
  );

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

    setCheckoutLoading(true);

    try {
      const { data: orderRes, error: orderError } = await supabase.functions.invoke<CheckoutOrderResponse>("create-razorpay-order", {
        body: {
          libraryId,
          planName: selectedPlanConfig.name,
          months: 1,
        },
      });

      if (orderError) throw orderError;
      if (!orderRes?.order) throw new Error("Order creation failed.");

      await ensureRazorpayScript();
      if (!razorpayWindow.Razorpay) throw new Error("Razorpay SDK unavailable.");

      const razorpay = new razorpayWindow.Razorpay({
        key: orderRes.keyId,
        amount: orderRes.order.amount,
        currency: orderRes.order.currency,
        name: "Libriofy",
        description: `${selectedPlanConfig.label} plan activation`,
        order_id: orderRes.order.id,
        handler: async (response: RazorpaySuccessResponse) => {
          const { error: verifyError } = await supabase.functions.invoke("verify-razorpay-payment", {
            body: {
              libraryId,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });

          if (verifyError) {
            toast({
              title: "Payment verification failed",
              description: verifyError.message,
              variant: "destructive",
            });
            return;
          }

          await queryClient.invalidateQueries({ queryKey: ["library-subscription", libraryId] });
          toast({
            title: "Plan activated",
            description: `${selectedPlanConfig.label} is now active for the next ${SUBSCRIPTION_BILLING_DAYS} days.`,
          });
          navigate("/dashboard", { replace: true });
        },
        prefill: {},
        theme: { color: "#0f766e" },
      });

      razorpay.open();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start checkout.";
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
                <span className="font-medium text-foreground">{currentPlan?.label ?? "Not activated"}</span>
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
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="font-display">Choose a plan</CardTitle>
              <CardDescription>All plans are billed every 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-3">
                {SUBSCRIPTION_PLANS.map((plan) => {
                  const isSelected = selectedPlan === plan.name;
                  const isCurrent = currentPlan?.name === plan.name && access.isPlanActive;

                  return (
                    <button
                      key={plan.name}
                      type="button"
                      className={`rounded-xl border p-5 text-left transition-colors ${
                        isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
                      }`}
                      onClick={() => setSelectedPlan(plan.name)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold font-display text-foreground">{plan.label}</p>
                          <p className="text-sm text-muted-foreground">{plan.description}</p>
                        </div>
                        {isCurrent ? <Badge>Current</Badge> : null}
                      </div>
                      <div className="mt-4">
                        <p className="text-3xl font-bold text-foreground">{formatInr(plan.price)}</p>
                        <p className="text-sm text-muted-foreground">per 30 days</p>
                      </div>
                      <p className="mt-3 text-sm font-medium text-foreground">{formatSeatLimit(plan.seatsLimit)}</p>
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
                })}
              </div>

              <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {selectedPlanConfig.label} plan
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatInr(selectedPlanConfig.price)} for the next {SUBSCRIPTION_BILLING_DAYS} days
                  </p>
                </div>
                <Button
                  onClick={handleActivatePlan}
                  disabled={checkoutLoading || !libraryId || !isOwner || access.reason === "account_disabled"}
                >
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Opening checkout...
                    </>
                  ) : isOwner ? (
                    access.isPlanActive ? "Renew or switch plan" : "Activate plan"
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
