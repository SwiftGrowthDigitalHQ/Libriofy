import { ReactNode, useState } from "react";
import { useLibrarySubscription, isSubscriptionActive } from "@/hooks/useLibrarySubscription";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  invokeBillingEdgeFunction,
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
import { getSupportWhatsAppUrl } from "@/lib/supportContact";

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

const SubscriptionGate = ({ children }: { children: ReactNode }) => {
  const { data: sub, isLoading } = useLibrarySubscription();
  const { libraryId } = useCurrentLibraryId();
  const { toast } = useToast();
  const [renewLoading, setRenewLoading] = useState(false);
  const razorpayWindow = window as Window & { Razorpay?: RazorpayConstructor };

  const ensureRazorpayScript = async () => {
    if (razorpayWindow.Razorpay) return true;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
      document.body.appendChild(script);
    });
    return !!razorpayWindow.Razorpay;
  };

  const handleRenew = async () => {
    if (!libraryId) return;
    setRenewLoading(true);
    let paymentContext: PaymentObservabilityContext = {
      libraryId,
      months: 1,
      source: "subscription_gate" as const,
    };
    try {
      await logPaymentStart(paymentContext);

      const headers = await getEdgeFunctionAuthHeaders();
      const { data: orderRes, error: orderError } = await supabase.functions.invoke<CheckoutOrderResponse>("create-payment", {
        headers,
        body: {
          libraryId,
          months: 1,
        },
      });
      if (orderError) {
        throw new Error(await readFunctionErrorMessage(orderError, "create-payment"));
      }

      if (!orderRes?.orderId || typeof orderRes.amount !== "number" || !orderRes.currency) {
        console.error("create-payment: unexpected response", orderRes);
        throw new Error("Order creation failed");
      }

      paymentContext = {
        ...paymentContext,
        amount: orderRes.amount,
        currency: orderRes.currency,
        orderId: orderRes.orderId,
      };

      await logPaymentInitiated(paymentContext);

      await ensureRazorpayScript();
      if (!razorpayWindow.Razorpay) throw new Error("Razorpay SDK unavailable");

      const envKeyId = String(import.meta.env.VITE_RAZORPAY_KEY_ID ?? "").trim();
      const checkoutKeyId = orderRes.keyId || envKeyId;
      if (!checkoutKeyId) throw new Error("Missing Razorpay key id.");

      const razorpay = new razorpayWindow.Razorpay({
        key: checkoutKeyId,
        amount: orderRes.amount,
        currency: orderRes.currency,
        name: "Libriofy",
        description: "Subscription Renewal",
        order_id: orderRes.orderId,
        handler: async (response: RazorpaySuccessResponse) => {
          const verifyHeaders = await getEdgeFunctionAuthHeaders();
          const { error: verifyError } = await invokeBillingEdgeFunction("verify-razorpay-payment", {
            libraryId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }, verifyHeaders);
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
                "Payment captured and subscription reactivated via webhook fallback.",
              );
              toast({ title: "Subscription renewed", description: "Your account has been reactivated." });
              window.location.reload();
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
                ? `${verifyMessage} If Razorpay already captured the payment, the webhook can still reactivate your account within a minute.`
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
            "Payment verified and subscription renewed.",
          );
          toast({ title: "Subscription renewed", description: "Your account has been reactivated." });
          window.location.reload();
        },
        prefill: {},
        theme: {
          color: "#14b8a6",
        },
      });

      razorpay.open();
    } catch (err: unknown) {
      await reportPaymentFailure(paymentContext, err, "create_order");
      const message = err instanceof Error && err.message.trim()
        ? err.message
        : "Renewal could not be started. Try again in a moment.";
      console.error("[subscription-gate] renewal failed", {
        error: message,
        libraryId,
        paymentContext,
      });
      toast({ title: "Renewal failed", description: message, variant: "destructive" });
    } finally {
      setRenewLoading(false);
    }
  };

  if (isLoading) return null;

  if (sub?.status === "blocked") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-2">Account Suspended</h1>
          <p className="text-muted-foreground mb-6">
            Your library account has been suspended. Please contact support to resolve this issue.
          </p>
          <a href={getSupportWhatsAppUrl()} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Contact Support</Button>
          </a>
        </div>
      </div>
    );
  }

  if (sub && !isSubscriptionActive(sub)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-warning" />
          </div>
          <h1 className="text-2xl font-bold font-display text-foreground mb-2">Subscription Expired</h1>
          <p className="text-muted-foreground mb-6">
            Your subscription has expired. Please renew to continue using the platform.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={handleRenew} disabled={renewLoading || !libraryId}>
              {renewLoading ? "Opening Checkout..." : "Renew Now"}
            </Button>
            <a href={getSupportWhatsAppUrl()} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">Need Help?</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SubscriptionGate;
