export type SubscriptionPlanName = "starter" | "growth" | "pro";

export type SubscriptionPlan = {
  name: SubscriptionPlanName;
  label: string;
  price: number;
  seatsLimit: number | null;
  lockersLimit: number | null;
  description: string;
  features: string[];
};

export type SubscriptionPlanCatalogRecord = {
  code: string;
  name: string | null;
  price: number | null;
  seats_limit: number | null;
  lockers_limit: number | null;
};

export type LibrarySubscriptionRecord = {
  id: string;
  library_id: string;
  plan_name: string | null;
  plan_price: number | null;
  plan_start_date: string | null;
  plan_expiry_date: string | null;
  payment_status: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  price: number;
  seats_limit: number;
  lockers_limit?: number | null;
  features: string[];
  status: string;
  started_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  libraries?: {
    enabled: boolean;
    name: string | null;
  } | null;
  current_plan?: SubscriptionPlanCatalogRecord | null;
};

export type SubscriptionAccessState = {
  reason:
    | "active_trial"
    | "active_plan"
    | "trial_expired"
    | "subscription_expired"
    | "account_disabled"
    | "inactive";
  isTrialActive: boolean;
  isPlanActive: boolean;
  isAllowed: boolean;
  requiresBilling: boolean;
  message: string | null;
  trialEndDate: string | null;
  planExpiryDate: string | null;
};

export const SUBSCRIPTION_TRIAL_DAYS = 7;
export const SUBSCRIPTION_BILLING_DAYS = 30;

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    name: "starter",
    label: "Starter",
    price: 2999,
    seatsLimit: 50,
    lockersLimit: 30,
    description: "For libraries getting started with paid operations.",
    features: ["Up to 50 seats", "Up to 30 lockers", "Seat management", "Notifications"],
  },
  {
    name: "growth",
    label: "Growth",
    price: 4999,
    seatsLimit: 150,
    lockersLimit: 80,
    description: "For growing libraries that need higher seat capacity.",
    features: ["Up to 150 seats", "Up to 80 lockers", "Seat management", "Advanced analytics", "Notifications", "Export"],
  },
  {
    name: "pro",
    label: "Pro",
    price: 9999,
    seatsLimit: 500,
    lockersLimit: 200,
    description: "For large operations that need full flexibility.",
    features: ["Up to 500 seats", "Up to 200 lockers", "All features", "Custom domain", "Priority support"],
  },
];

const PLAN_MAP = new Map(SUBSCRIPTION_PLANS.map((plan) => [plan.name, plan]));

export const TRIAL_EXPIRED_MESSAGE = "Your trial has expired. Please activate a plan to continue using Libriofy.";
export const SUBSCRIPTION_EXPIRED_MESSAGE = "Your subscription has expired. Please renew your plan to continue.";
export const ACCOUNT_DISABLED_MESSAGE = "Your library account is disabled. Please contact support to continue.";

const normalizeStatus = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getSubscriptionPlan = (value: string | null | undefined): SubscriptionPlan | null => {
  if (!value) return null;
  return PLAN_MAP.get(normalizeStatus(value) as SubscriptionPlanName) ?? null;
};

export const formatInr = (amount: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

export const formatSeatLimit = (seatsLimit: number | null | undefined) => {
  if (!seatsLimit || seatsLimit <= 0) return "Unlimited seats";
  return `Up to ${seatsLimit} seats`;
};

export const formatLockerLimit = (lockersLimit: number | null | undefined) => {
  if (!lockersLimit || lockersLimit <= 0) return "Unlimited lockers";
  return `Up to ${lockersLimit} lockers`;
};

export const getPlanLockerLimit = (value: string | null | undefined) => {
  const normalized = normalizeStatus(value);
  if (normalized === "premium") return 200;
  return PLAN_MAP.get(normalized as SubscriptionPlanName)?.lockersLimit ?? null;
};

export const resolveSubscriptionLockerLimit = (
  subscription: LibrarySubscriptionRecord | null | undefined,
) =>
  subscription?.current_plan?.lockers_limit ??
  getPlanLockerLimit(subscription?.current_plan?.code ?? subscription?.plan_name) ??
  subscription?.lockers_limit ??
  null;

export const resolveSubscriptionSeatLimit = (
  subscription: LibrarySubscriptionRecord | null | undefined,
) =>
  subscription?.current_plan?.seats_limit ??
  getSubscriptionPlan(subscription?.current_plan?.code ?? subscription?.plan_name)?.seatsLimit ??
  subscription?.seats_limit ??
  null;

export const resolveSubscriptionPlanLabel = (
  subscription: LibrarySubscriptionRecord | null | undefined,
) => subscription?.current_plan?.name ?? getSubscriptionPlan(subscription?.plan_name)?.label ?? subscription?.plan_name ?? null;

export const evaluateSubscriptionAccess = (
  subscription: LibrarySubscriptionRecord | null | undefined,
): SubscriptionAccessState => {
  if (!subscription) {
    return {
      reason: "inactive",
      isTrialActive: false,
      isPlanActive: false,
      isAllowed: false,
      requiresBilling: true,
      message: SUBSCRIPTION_EXPIRED_MESSAGE,
      trialEndDate: null,
      planExpiryDate: null,
    };
  }

  const status = normalizeStatus(subscription.status);
  const paymentStatus = normalizeStatus(subscription.payment_status);
  const trialEndDate = parseDate(subscription.trial_end_date ?? subscription.expires_at);
  const planExpiryDate = parseDate(subscription.plan_expiry_date ?? subscription.expires_at);
  const now = new Date();
  const libraryEnabled = subscription.libraries?.enabled ?? true;

  if (!libraryEnabled || status === "blocked") {
    return {
      reason: "account_disabled",
      isTrialActive: false,
      isPlanActive: false,
      isAllowed: false,
      requiresBilling: false,
      message: ACCOUNT_DISABLED_MESSAGE,
      trialEndDate: trialEndDate?.toISOString() ?? null,
      planExpiryDate: planExpiryDate?.toISOString() ?? null,
    };
  }

  const isTrialActive = status === "trial" && !!trialEndDate && now <= trialEndDate;
  const isPlanActive =
    status === "active" &&
    !!planExpiryDate &&
    now <= planExpiryDate &&
    !["pending", "expired", "overdue", "failed"].includes(paymentStatus);

  if (isTrialActive) {
    return {
      reason: "active_trial",
      isTrialActive: true,
      isPlanActive: false,
      isAllowed: true,
      requiresBilling: false,
      message: null,
      trialEndDate: trialEndDate?.toISOString() ?? null,
      planExpiryDate: planExpiryDate?.toISOString() ?? null,
    };
  }

  if (isPlanActive) {
    return {
      reason: "active_plan",
      isTrialActive: false,
      isPlanActive: true,
      isAllowed: true,
      requiresBilling: false,
      message: null,
      trialEndDate: trialEndDate?.toISOString() ?? null,
      planExpiryDate: planExpiryDate?.toISOString() ?? null,
    };
  }

  const trialExpired = !!trialEndDate && now > trialEndDate && !planExpiryDate;
  if (trialExpired || status === "trial") {
    return {
      reason: "trial_expired",
      isTrialActive: false,
      isPlanActive: false,
      isAllowed: false,
      requiresBilling: true,
      message: TRIAL_EXPIRED_MESSAGE,
      trialEndDate: trialEndDate?.toISOString() ?? null,
      planExpiryDate: planExpiryDate?.toISOString() ?? null,
    };
  }

  return {
    reason: "subscription_expired",
    isTrialActive: false,
    isPlanActive: false,
    isAllowed: false,
    requiresBilling: true,
    message: SUBSCRIPTION_EXPIRED_MESSAGE,
    trialEndDate: trialEndDate?.toISOString() ?? null,
    planExpiryDate: planExpiryDate?.toISOString() ?? null,
  };
};

export const isSubscriptionActive = (subscription: LibrarySubscriptionRecord | null | undefined): boolean =>
  evaluateSubscriptionAccess(subscription).isAllowed;
