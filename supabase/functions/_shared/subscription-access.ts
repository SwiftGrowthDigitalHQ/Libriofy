export type SubscriptionPlanType = "starter" | "growth" | "pro";
export type AutomationFeature = "ai_call" | "whatsapp";

export type LibrarySubscriptionAccessRow = {
  ai_call_enabled?: boolean | null;
  plan_name?: string | null;
  plan_type?: string | null;
  whatsapp_enabled?: boolean | null;
};

const PLAN_RANK: Record<SubscriptionPlanType, number> = {
  starter: 0,
  growth: 1,
  pro: 2,
};

export const normalizeSubscriptionPlanType = (value: unknown): SubscriptionPlanType | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "starter" || normalized === "growth" || normalized === "pro") {
    return normalized;
  }

  return null;
};

export const resolveSubscriptionPlanType = (
  subscription: LibrarySubscriptionAccessRow | null | undefined,
): SubscriptionPlanType =>
  normalizeSubscriptionPlanType(subscription?.plan_type) ??
  normalizeSubscriptionPlanType(subscription?.plan_name) ??
  "starter";

export const getDefaultAutomationFlags = (planType: SubscriptionPlanType) => ({
  aiCallEnabled: planType === "pro",
  whatsappEnabled: planType === "growth" || planType === "pro",
});

export const resolveAutomationAccess = (
  subscription: LibrarySubscriptionAccessRow | null | undefined,
) => {
  const planType = resolveSubscriptionPlanType(subscription);
  const defaults = getDefaultAutomationFlags(planType);

  return {
    aiCallEnabled: subscription?.ai_call_enabled ?? defaults.aiCallEnabled,
    planType,
    whatsappEnabled: subscription?.whatsapp_enabled ?? defaults.whatsappEnabled,
  };
};

export const getRequiredPlanForFeature = (feature: AutomationFeature): SubscriptionPlanType =>
  feature === "ai_call" ? "pro" : "growth";

export const isPlanAtLeast = (
  currentPlanType: SubscriptionPlanType | null | undefined,
  minimumPlanType: SubscriptionPlanType,
): boolean => {
  const normalizedCurrentPlanType = normalizeSubscriptionPlanType(currentPlanType) ?? "starter";
  return PLAN_RANK[normalizedCurrentPlanType] >= PLAN_RANK[minimumPlanType];
};

export const hasAutomationAccess = (
  subscription: LibrarySubscriptionAccessRow | null | undefined,
  feature: AutomationFeature,
): boolean => {
  const access = resolveAutomationAccess(subscription);
  return feature === "ai_call" ? access.aiCallEnabled : access.whatsappEnabled;
};

export const getUpgradeMessageForFeature = (feature: AutomationFeature): string =>
  feature === "ai_call"
    ? "Upgrade to Pro to unlock AI Calling automation"
    : "Upgrade to Growth to unlock WhatsApp Payment Reminders automation";
