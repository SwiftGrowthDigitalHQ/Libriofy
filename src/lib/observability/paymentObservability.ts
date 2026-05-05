import { extractErrorMessage } from "../errorHandling.js";
import { sendAdminAlert } from "./alertService.js";
import { logEvent } from "./eventLogger.js";

export type PaymentObservabilityContext = {
  amount?: number | null;
  currency?: string | null;
  libraryId: string;
  months?: number;
  orderId?: string | null;
  paymentId?: string | null;
  planCode?: string | null;
  planName?: string | null;
  source: "billing_page" | "subscription_gate";
};

type PaymentFailureStage = "checkout" | "create_order" | "verification" | "webhook_fallback";

const buildPaymentUser = (libraryId: string) => `library:${libraryId}`;

const buildPaymentMetadata = (context: PaymentObservabilityContext) => ({
  amount: context.amount ?? null,
  currency: context.currency ?? null,
  libraryId: context.libraryId,
  months: context.months ?? 1,
  orderId: context.orderId ?? null,
  paymentId: context.paymentId ?? null,
  planCode: context.planCode ?? null,
  planName: context.planName ?? null,
  source: context.source,
});

export const logPaymentStart = async (context: PaymentObservabilityContext) => {
  await logEvent({
    type: "PAYMENT_INITIATED",
    status: "START",
    user: buildPaymentUser(context.libraryId),
    entityId: context.libraryId,
    metadata: {
      ...buildPaymentMetadata(context),
      severity: "INFO",
    },
    message: "Payment checkout started.",
  });
};

export const logPaymentInitiated = async (context: PaymentObservabilityContext) => {
  await logEvent({
    type: "PAYMENT_INITIATED",
    status: "SUCCESS",
    user: buildPaymentUser(context.libraryId),
    entityId: context.orderId ?? context.libraryId,
    metadata: {
      ...buildPaymentMetadata(context),
      severity: "INFO",
    },
    message: "Payment order created successfully.",
  });
};

export const logPaymentSuccess = async (context: PaymentObservabilityContext, message = "Payment verified successfully.") => {
  await logEvent({
    type: "PAYMENT_SUCCESS",
    status: "SUCCESS",
    user: buildPaymentUser(context.libraryId),
    entityId: context.paymentId ?? context.orderId ?? context.libraryId,
    metadata: {
      ...buildPaymentMetadata(context),
      severity: "INFO",
    },
    message,
  });
};

export const reportPaymentFailure = async (
  context: PaymentObservabilityContext,
  error: unknown,
  stage: PaymentFailureStage,
) => {
  const errorMessage = extractErrorMessage(error) || "Payment flow failed unexpectedly.";
  const metadata = {
    ...buildPaymentMetadata(context),
    errorMessage,
    severity: "CRITICAL",
    stage,
  };

  await Promise.allSettled([
    logEvent({
      type: "PAYMENT_FAILED",
      status: "FAILED",
      user: buildPaymentUser(context.libraryId),
      entityId: context.paymentId ?? context.orderId ?? context.libraryId,
      metadata,
      message: errorMessage,
    }),
    sendAdminAlert({
      type: "PAYMENT_FAILED",
      severity: "CRITICAL",
      user: buildPaymentUser(context.libraryId),
      message: errorMessage,
      metadata,
    }),
  ]);
};
