export type SubscriptionPlanName = "starter" | "growth" | "pro";

export type SubscriptionPlan = {
  name: SubscriptionPlanName;
  price: number;
  seatsLimit: number | null;
  lockersLimit: number | null;
  features: string[];
};

export const SUBSCRIPTION_TRIAL_DAYS = 7;
export const SUBSCRIPTION_BILLING_DAYS = 30;

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanName, SubscriptionPlan> = {
  starter: {
    name: "starter",
    price: 2999,
    seatsLimit: 50,
    lockersLimit: 30,
    features: ["seat_management", "basic_analytics", "notifications"],
  },
  growth: {
    name: "growth",
    price: 4999,
    seatsLimit: 150,
    lockersLimit: 80,
    features: ["seat_management", "advanced_analytics", "notifications", "export"],
  },
  pro: {
    name: "pro",
    price: 9999,
    seatsLimit: 500,
    lockersLimit: 200,
    features: ["seat_management", "advanced_analytics", "notifications", "export", "custom_domain", "priority_support"],
  },
};

export const getSubscriptionPlan = (value: string | null | undefined): SubscriptionPlan | null => {
  if (!value) return null;
  const normalized = value.toLowerCase() as SubscriptionPlanName;
  return SUBSCRIPTION_PLANS[normalized] ?? null;
};
