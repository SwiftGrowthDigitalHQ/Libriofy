export const PAYMENT_SCREENSHOT_BUCKET = "payment-screenshots";

const successfulStatuses = new Set(["approved", "completed", "captured", "paid", "success"]);
const pendingStatuses = new Set(["pending", "created"]);

const formatUpiAmount = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

export const buildUpiPaymentLink = ({
  upiId,
  libraryName,
  amount,
}: {
  upiId: string;
  libraryName: string;
  amount: number;
}) => {
  const params = new URLSearchParams({
    pa: upiId,
    pn: libraryName,
    am: formatUpiAmount(amount),
    cu: "INR",
  });

  return `upi://pay?${params.toString()}`;
};

export const isSuccessfulPaymentStatus = (status: string | null | undefined) =>
  successfulStatuses.has((status || "").toLowerCase());

export const isPendingPaymentStatus = (status: string | null | undefined) =>
  pendingStatuses.has((status || "").toLowerCase());
