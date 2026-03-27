import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  LayoutGrid,
  MessageCircle,
  Phone,
  Target,
  TrendingDown,
  UserRoundX,
  Users,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type MetricTone = "success" | "warning" | "danger" | "info" | "neutral";

type MoneyPriorityItem = {
  id: string;
  name: string;
  amountAtRisk: number;
  reason: string;
  phone: string | null;
  seatNumber: string | null;
  source: "payment" | "risk" | "absence";
  urgency: "critical" | "warning" | "watch";
  whatsappMessage: string;
};

type SmartSuggestion = {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  onClick: () => void;
  tone: MetricTone;
};

type DailyActionStep = {
  id: string;
  step: string;
  status: string;
  detail: string;
  tone: MetricTone;
  actionLabel: string;
  onClick: () => void;
};

type SeatMonetizationBlock = {
  seatLabel: string;
  value: number;
  tone: "empty" | "risk" | "paid";
};

type RevenueControlDashboardProps = {
  currentDateLabel: string;
  recoveryWindowLabel: string;
  totalRevenueAtRisk: number;
  pendingPaymentsAmount: number;
  riskRevenueAtRisk: number;
  highRiskStudentsCount: number;
  totalRiskStudents: number;
  emptySeats: number;
  emptySeatRevenueLoss: number;
  revenueMTD: number;
  revenueChangeText: string;
  occupancyRate: number;
  occupiedSeats: number;
  totalSeats: number;
  churnRate: number;
  revenuePerSeat: number;
  pendingTasksCount: number;
  recoveredToday: number;
  paymentsReceivedToday: number;
  studentsConvertedToday: number;
  smartSuggestions: SmartSuggestion[];
  moneyPriorityItems: MoneyPriorityItem[];
  visibleMoneyPriorityItems: MoneyPriorityItem[];
  moneyPriorityCount: number;
  showAllUrgentRisk: boolean;
  onToggleShowAllUrgentRisk: () => void;
  onRecoverNow: () => void;
  onCallHighRiskStudents: () => void;
  onQuickWhatsApp: () => void;
  onCallItem: (item: MoneyPriorityItem) => void;
  onWhatsAppItem: (item: MoneyPriorityItem) => void;
  onMarkPaid: (item: MoneyPriorityItem) => void;
  onRemoveSeat: (item: MoneyPriorityItem) => void;
  dailyActionFlow: DailyActionStep[];
  seatMonetizationBlocks: SeatMonetizationBlock[];
  moneyPriorityRef: RefObject<HTMLDivElement | null>;
  seatViewRef: RefObject<HTMLDivElement | null>;
};

type ContactTracker = {
  called: boolean;
  responded: boolean;
  channel: "call" | "whatsapp" | "auto" | null;
};

type AutoRecoveryState = {
  status: "idle" | "running" | "complete";
  targeted: number;
  expectedContacts: number;
  expectedCalls: number;
  expectedResponses: number;
  expectedRecovery: number;
  contacted: number;
  callsTriggered: number;
  responsesReceived: number;
  amountRecovered: number;
};

const formatInr = (amount: number) => `\u20b9${Math.round(amount).toLocaleString("en-IN")}`;

const toneBadgeClassName: Record<MetricTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

const suggestionCardClassName: Record<MetricTone, string> = {
  success: "border-emerald-200/80 bg-emerald-50/70",
  warning: "border-amber-200/80 bg-amber-50/70",
  danger: "border-rose-200/80 bg-rose-50/70",
  info: "border-sky-200/80 bg-sky-50/70",
  neutral: "border-slate-200/80 bg-slate-50/70",
};

const priorityShellClassName: Record<MoneyPriorityItem["urgency"], string> = {
  critical:
    "border-rose-200/80 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(255,255,255,0.98))] shadow-rose-100/70",
  warning:
    "border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))] shadow-amber-100/70",
  watch:
    "border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] shadow-slate-200/70",
};

const priorityAmountClassName: Record<MoneyPriorityItem["urgency"], string> = {
  critical: "text-rose-700",
  warning: "text-amber-700",
  watch: "text-slate-700",
};

const seatToneClassName: Record<SeatMonetizationBlock["tone"], string> = {
  empty: "border-rose-200 bg-rose-50 text-rose-700",
  risk: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const seatToneLabel: Record<SeatMonetizationBlock["tone"], string> = {
  empty: "Empty seat",
  risk: "At risk",
  paid: "Paid",
};

const sourceLabel: Record<MoneyPriorityItem["source"], string> = {
  payment: "Fee risk",
  risk: "Churn risk",
  absence: "Attendance gap",
};

const urgencyLabel: Record<MoneyPriorityItem["urgency"], string> = {
  critical: "Recover now",
  warning: "Act today",
  watch: "Watch closely",
};

const RevenueControlDashboard = ({
  currentDateLabel,
  recoveryWindowLabel,
  totalRevenueAtRisk,
  pendingPaymentsAmount,
  riskRevenueAtRisk,
  highRiskStudentsCount,
  totalRiskStudents,
  emptySeats,
  emptySeatRevenueLoss,
  revenueMTD,
  revenueChangeText,
  occupancyRate,
  occupiedSeats,
  totalSeats,
  churnRate,
  revenuePerSeat,
  pendingTasksCount,
  recoveredToday,
  paymentsReceivedToday,
  studentsConvertedToday,
  smartSuggestions,
  moneyPriorityItems,
  visibleMoneyPriorityItems,
  moneyPriorityCount,
  showAllUrgentRisk,
  onToggleShowAllUrgentRisk,
  onRecoverNow,
  onCallHighRiskStudents,
  onQuickWhatsApp,
  onCallItem,
  onWhatsAppItem,
  onMarkPaid,
  onRemoveSeat,
  dailyActionFlow,
  seatMonetizationBlocks,
  moneyPriorityRef,
  seatViewRef,
}: RevenueControlDashboardProps) => {
  const { toast } = useToast();
  const [selectedItem, setSelectedItem] = useState<MoneyPriorityItem | null>(null);
  const [fillSeatDialogOpen, setFillSeatDialogOpen] = useState(false);
  const [recoverPreviewPinned, setRecoverPreviewPinned] = useState(false);
  const [contactTracker, setContactTracker] = useState<Record<string, ContactTracker>>({});
  const [autoRecovery, setAutoRecovery] = useState<AutoRecoveryState>({
    status: "idle",
    targeted: 0,
    expectedContacts: 0,
    expectedCalls: 0,
    expectedResponses: 0,
    expectedRecovery: 0,
    contacted: 0,
    callsTriggered: 0,
    responsesReceived: 0,
    amountRecovered: 0,
  });

  const recoveryPlan = useMemo(() => {
    const plannedItems = moneyPriorityItems.slice(0, Math.min(moneyPriorityItems.length, 8));
    const targeted = Math.min(moneyPriorityItems.length, 17);
    const expectedCalls = Math.min(
      plannedItems.filter((item) => !!item.phone).length,
      Math.max(1, Math.ceil(targeted * 0.35)),
    );
    const expectedContacts = Math.min(targeted, Math.max(expectedCalls + 4, Math.ceil(targeted * 0.68)));
    const expectedResponses = Math.min(expectedContacts, Math.max(1, Math.ceil(expectedContacts * 0.45)));
    const baseRecovery = plannedItems.reduce((sum, item) => sum + item.amountAtRisk, 0);
    const expectedRecovery = Math.round(baseRecovery > 0 ? baseRecovery * 0.46 : totalRevenueAtRisk * 0.35);

    return {
      targeted,
      expectedCalls,
      expectedContacts,
      expectedResponses,
      expectedRecovery,
    };
  }, [moneyPriorityItems, totalRevenueAtRisk]);

  const activeStepIndex = dailyActionFlow.findIndex((step) => !/^done$/i.test(step.status));
  const currentStepIndex = activeStepIndex >= 0 ? activeStepIndex : dailyActionFlow.length - 1;
  const currentStep = dailyActionFlow[currentStepIndex] ?? null;

  useEffect(() => {
    if (autoRecovery.status !== "running") return;

    const interval = window.setInterval(() => {
      setAutoRecovery((current) => {
        const nextContacted =
          current.contacted < current.expectedContacts
            ? Math.min(current.contacted + Math.max(1, Math.ceil(current.targeted / 6)), current.expectedContacts)
            : current.contacted;
        const nextCalls =
          current.callsTriggered < current.expectedCalls ? Math.min(current.callsTriggered + 1, current.expectedCalls) : current.callsTriggered;
        const canReceiveResponses = nextContacted >= Math.max(2, Math.floor(current.expectedContacts / 2));
        const nextResponses =
          canReceiveResponses && current.responsesReceived < current.expectedResponses
            ? Math.min(current.responsesReceived + 1, current.expectedResponses)
            : current.responsesReceived;
        const nextRecovered =
          current.expectedResponses > 0
            ? Math.min(
                Math.round((nextResponses / current.expectedResponses) * current.expectedRecovery),
                current.expectedRecovery,
              )
            : 0;
        const isComplete =
          nextContacted >= current.expectedContacts &&
          nextCalls >= current.expectedCalls &&
          nextResponses >= current.expectedResponses &&
          nextRecovered >= current.expectedRecovery;

        return {
          ...current,
          status: isComplete ? "complete" : "running",
          contacted: nextContacted,
          callsTriggered: nextCalls,
          responsesReceived: nextResponses,
          amountRecovered: nextRecovered,
        };
      });
    }, 900);

    return () => window.clearInterval(interval);
  }, [autoRecovery.status]);

  const selectedItemStatus = selectedItem ? contactTracker[selectedItem.id] ?? { called: false, responded: false, channel: null } : null;

  const copyText = async (text: string, successTitle: string, successDescription: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: successTitle,
        description: successDescription,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission blocked the action.",
        variant: "destructive",
      });
    }
  };

  const markContact = (item: MoneyPriorityItem, channel: ContactTracker["channel"]) => {
    setContactTracker((current) => ({
      ...current,
      [item.id]: {
        called: true,
        responded: current[item.id]?.responded ?? false,
        channel,
      },
    }));
  };

  const handleStartRecovery = () => {
    if (recoveryPlan.targeted <= 0) {
      onRecoverNow();
      return;
    }

    setRecoverPreviewPinned(false);
    setAutoRecovery({
      status: "running",
      targeted: recoveryPlan.targeted,
      expectedContacts: recoveryPlan.expectedContacts,
      expectedCalls: recoveryPlan.expectedCalls,
      expectedResponses: recoveryPlan.expectedResponses,
      expectedRecovery: recoveryPlan.expectedRecovery,
      contacted: 0,
      callsTriggered: 0,
      responsesReceived: 0,
      amountRecovered: 0,
    });
    onRecoverNow();
  };

  const handleContactAction = (item: MoneyPriorityItem, channel: "call" | "whatsapp" | "auto") => {
    markContact(item, channel);

    if (channel === "call") {
      onCallItem(item);
      return;
    }

    if (channel === "whatsapp") {
      onWhatsAppItem(item);
      return;
    }

    toast({
      title: "Auto Call queued",
      description: `${item.name} is added to the auto-calling queue. Connect your calling API to trigger it live.`,
    });
  };

  const toggleResponded = (itemId: string, responded: boolean) => {
    setContactTracker((current) => ({
      ...current,
      [itemId]: {
        called: current[itemId]?.called ?? false,
        responded,
        channel: current[itemId]?.channel ?? null,
      },
    }));
  };

  const admissionLink = typeof window !== "undefined" ? `${window.location.origin}/signup` : "/signup";
  const seatFillWhatsAppMessage = `We have ${emptySeats} focused study seat${emptySeats === 1 ? "" : "s"} open right now. Monthly plans are available and admissions are active today. Reply if you want the joining link.`;
  const posterBrief = `Create a marketing poster for a premium study library. Highlight ${emptySeats} vacant seats, quiet environment, high-focus setup, and urgent admission CTA.`;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <Card className="relative overflow-hidden border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,247,237,0.98)_45%,rgba(255,241,242,0.96))] shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(244,63,94,0.1),transparent_30%)]" />
          <CardHeader className="relative pb-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <Badge variant="outline" className="w-fit border-slate-300/80 bg-white/85 text-slate-700">
                  Daily Revenue Recovery Engine
                </Badge>
                <div className="space-y-3">
                  <CardTitle className="font-display text-3xl tracking-tight text-slate-950 md:text-4xl">
                    Today&apos;s Money Target
                  </CardTitle>
                  <CardDescription className="max-w-2xl text-base leading-7 text-slate-600">
                    This is not a reporting dashboard. It is your money control center for stopping churn, recovering dues,
                    and turning every seat into revenue again.
                  </CardDescription>
                </div>
              </div>

              <div className="rounded-3xl border border-white/70 bg-white/80 p-5 shadow-lg shadow-amber-100/50 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-rose-600" />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live focus</p>
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-950">{currentDateLabel}</p>
                <div className="mt-5 space-y-3 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-6">
                    <span>Pending fees</span>
                    <span className="font-semibold text-slate-950">{formatInr(pendingPaymentsAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span>Attendance churn risk</span>
                    <span className="font-semibold text-slate-950">{formatInr(riskRevenueAtRisk)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-6">
                    <span>Tasks waiting</span>
                    <span className="font-semibold text-slate-950">{pendingTasksCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="relative grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-rose-200/80 bg-white/85 p-5 shadow-sm shadow-rose-100/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total revenue at risk</p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{formatInr(totalRevenueAtRisk)}</p>
                </div>
                <div className="rounded-2xl bg-rose-100 p-3 text-rose-700">
                  <Wallet className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">{formatInr(totalRevenueAtRisk)} needs recovery today.</p>
            </div>

            <div className="rounded-3xl border border-amber-200/80 bg-white/85 p-5 shadow-sm shadow-amber-100/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">High-risk students</p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{highRiskStudentsCount}</p>
                </div>
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                  <Users className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">{totalRiskStudents} students are already showing churn-risk behavior.</p>
            </div>

            <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-5 shadow-sm shadow-slate-200/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Empty seats + loss</p>
                  <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{emptySeats} seats</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <TrendingDown className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">{emptySeats} empty seats = {formatInr(emptySeatRevenueLoss)}/month loss.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95 shadow-[0_22px_48px_-36px_rgba(15,23,42,0.55)] xl:sticky xl:top-6">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="font-display text-xl text-slate-950">Smart Suggestions</CardTitle>
                <CardDescription>Every suggestion is tied to money recovery or risk reduction.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {smartSuggestions.map((suggestion) => (
              <div key={suggestion.id} className={cn("rounded-3xl border p-4 shadow-sm", suggestionCardClassName[suggestion.tone])}>
                <div className="space-y-2">
                  <Badge variant="outline" className={toneBadgeClassName[suggestion.tone]}>
                    {suggestion.tone === "danger"
                      ? "Urgent move"
                      : suggestion.tone === "warning"
                        ? "Priority move"
                        : suggestion.tone === "success"
                          ? "Healthy"
                          : "Insight"}
                  </Badge>
                  <p className="text-sm font-semibold leading-6 text-slate-950">{suggestion.title}</p>
                  <p className="text-sm leading-6 text-slate-600">{suggestion.detail}</p>
                </div>
                <Button
                  variant="ghost"
                  className="mt-4 h-10 rounded-2xl px-0 text-sm font-semibold text-slate-900 hover:bg-transparent"
                  onClick={suggestion.onClick}
                >
                  {suggestion.actionLabel}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="relative z-10">
        <Card className="border-slate-200/80 bg-white/90 shadow-[0_22px_50px_-38px_rgba(15,23,42,0.65)] backdrop-blur">
          <CardContent className="grid gap-4 p-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] xl:items-center">
            <div className="min-w-0 space-y-1 pr-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Primary actions</p>
              <p className="max-w-sm text-lg font-semibold leading-snug text-slate-950">
                What should the owner do right now to increase revenue?
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div
                className="group/recover relative"
                onMouseEnter={() => setRecoverPreviewPinned(true)}
                onMouseLeave={() => setRecoverPreviewPinned(false)}
              >
                <Button
                  size="lg"
                  className="h-14 w-full rounded-2xl bg-slate-950 text-base text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800"
                  onClick={handleStartRecovery}
                >
                  <Target className="h-4 w-4" />
                  Recover {formatInr(recoveryPlan.expectedRecovery)} Now (Auto Mode)
                </Button>

                <div
                  className={cn(
                    "pointer-events-none absolute left-0 top-[calc(100%+12px)] z-30 w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10 transition duration-200",
                    recoverPreviewPinned ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 group-hover/recover:translate-y-0 group-hover/recover:opacity-100",
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Auto mode preview</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>Will contact</span>
                      <span className="font-semibold text-slate-950">{recoveryPlan.targeted} students</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Expected recovery</span>
                      <span className="font-semibold text-slate-950">{formatInr(recoveryPlan.expectedRecovery)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Calls triggered</span>
                      <span className="font-semibold text-slate-950">{recoveryPlan.expectedCalls}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                variant="outline"
                className="h-14 rounded-2xl border-amber-200 bg-amber-50 text-base text-amber-900 hover:bg-amber-100"
                onClick={onCallHighRiskStudents}
              >
                <Phone className="h-4 w-4" />
                Call High-Risk Students
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="h-14 rounded-2xl border-emerald-200 bg-emerald-50 text-base text-emerald-900 hover:bg-emerald-100"
                onClick={onQuickWhatsApp}
              >
                <MessageCircle className="h-4 w-4" />
                Send WhatsApp Reminders
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <Card className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit border-rose-200 bg-rose-50 text-rose-700",
                    autoRecovery.status === "running" && "animate-pulse",
                  )}
                >
                  {autoRecovery.status === "running"
                    ? "Auto Recovery Running..."
                    : autoRecovery.status === "complete"
                      ? "Auto Recovery Completed"
                      : "Auto Recovery Mode"}
                </Badge>
                <div>
                  <CardTitle className="font-display text-2xl text-slate-950">Live recovery engine</CardTitle>
                  <CardDescription className="mt-2 max-w-2xl">
                    Monitor money recovery progress instead of guessing who was contacted and what came back.
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="w-fit border-rose-200 bg-rose-50 text-rose-700">
                {recoveryWindowLabel} to recover today
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Students contacted</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  {autoRecovery.status === "idle" ? 0 : autoRecovery.contacted}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Calls triggered</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  {autoRecovery.status === "idle" ? 0 : autoRecovery.callsTriggered}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Responses received</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                  {autoRecovery.status === "idle" ? 0 : autoRecovery.responsesReceived}
                </p>
              </div>
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Amount recovered</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-emerald-900">
                  {formatInr(autoRecovery.status === "idle" ? 0 : autoRecovery.amountRecovered)}
                </p>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recovery Funnel</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {autoRecovery.status === "idle"
                      ? `${recoveryPlan.targeted} targeted -> ${recoveryPlan.expectedContacts} contacted -> ${recoveryPlan.expectedResponses} responded -> ${formatInr(recoveryPlan.expectedRecovery)} recovered`
                      : `${autoRecovery.targeted} targeted -> ${autoRecovery.contacted} contacted -> ${autoRecovery.responsesReceived} responded -> ${formatInr(autoRecovery.amountRecovered)} recovered`}
                  </p>
                </div>
                <p className="text-sm text-slate-600">
                  {autoRecovery.status === "complete"
                    ? "Auto sequence finished. Review conversions and keep follow-ups warm."
                    : autoRecovery.status === "running"
                      ? "Recovery sequence is live."
                      : "Projected funnel if auto mode starts now."}
                </p>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {[
                  {
                    label: "Targeted",
                    value: autoRecovery.status === "idle" ? recoveryPlan.targeted : autoRecovery.targeted,
                    tone: "border-slate-200 bg-white text-slate-700",
                  },
                  {
                    label: "Contacted",
                    value: autoRecovery.status === "idle" ? recoveryPlan.expectedContacts : autoRecovery.contacted,
                    tone: "border-sky-200 bg-sky-50 text-sky-700",
                  },
                  {
                    label: "Responded",
                    value: autoRecovery.status === "idle" ? recoveryPlan.expectedResponses : autoRecovery.responsesReceived,
                    tone: "border-amber-200 bg-amber-50 text-amber-700",
                  },
                  {
                    label: "Recovered",
                    value: autoRecovery.status === "idle" ? formatInr(recoveryPlan.expectedRecovery) : formatInr(autoRecovery.amountRecovered),
                    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
                  },
                ].map((step) => (
                  <div key={step.label} className={cn("rounded-3xl border p-4", step.tone)}>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{step.label}</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight">{step.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="font-display text-xl text-slate-950">Today&apos;s Recovery</CardTitle>
                <CardDescription>Proof of results builds confidence and repeat action.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Recovered today</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-900">{formatInr(recoveredToday)}</p>
              <p className="mt-2 text-sm text-emerald-800">Money already protected today.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Payments received</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{paymentsReceivedToday}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Students converted</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{studentsConvertedToday}</p>
              </div>
            </div>
            <div className="rounded-3xl border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-sm font-semibold text-rose-900">Urgency signal</p>
              <p className="mt-2 text-sm leading-6 text-rose-800">{recoveryWindowLabel} left to recover today before momentum drops.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <Card ref={moneyPriorityRef} className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit border-rose-200 bg-rose-50 text-rose-700">
                  Money Priority List
                </Badge>
                <div>
                  <CardTitle className="font-display text-2xl text-slate-950">Who needs action to protect revenue right now</CardTitle>
                  <CardDescription className="mt-2 max-w-2xl">
                    Sorted by highest money risk first so the owner can recover value before handling lower-impact tasks.
                  </CardDescription>
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live queue</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{moneyPriorityCount}</p>
                <p className="text-sm text-slate-600">revenue actions pending</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleMoneyPriorityItems.length > 0 ? (
              <>
                {visibleMoneyPriorityItems.map((item) => {
                  const tracker = contactTracker[item.id] ?? { called: false, responded: false, channel: null };

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-3xl border p-5 shadow-sm transition-transform hover:-translate-y-0.5",
                        priorityShellClassName[item.urgency],
                        item.urgency === "critical" && "animate-pulse",
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                toneBadgeClassName[
                                  item.urgency === "critical" ? "danger" : item.urgency === "warning" ? "warning" : "neutral"
                                ]
                              }
                            >
                              {urgencyLabel[item.urgency]}
                            </Badge>
                            <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700">
                              {sourceLabel[item.source]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("border-slate-200 bg-white/70", tracker.called ? "text-sky-700" : "text-slate-500")}
                            >
                              {tracker.called ? `Called${tracker.channel ? ` via ${tracker.channel}` : ""}` : "Not called"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn("border-slate-200 bg-white/70", tracker.responded ? "text-emerald-700" : "text-slate-500")}
                            >
                              {tracker.responded ? "Responded" : "Not responded"}
                            </Badge>
                          </div>

                          <div className="space-y-2">
                            <p className={cn("text-3xl font-semibold tracking-tight", priorityAmountClassName[item.urgency])}>
                              {formatInr(item.amountAtRisk)}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-lg font-semibold text-slate-950">{item.name}</p>
                              {item.seatNumber ? (
                                <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700">
                                  Seat {item.seatNumber}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm leading-6 text-slate-600">Reason: {item.reason}</p>
                          </div>
                        </div>

                        <Button className="h-12 rounded-2xl bg-slate-950 px-6 text-white hover:bg-slate-800" onClick={() => setSelectedItem(item)}>
                          Contact Now
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {moneyPriorityCount > 6 ? (
                  <Button variant="outline" className="rounded-2xl border-slate-200" onClick={onToggleShowAllUrgentRisk}>
                    {showAllUrgentRisk ? "Show fewer money risks" : "Show full money priority list"}
                  </Button>
                ) : null}
              </>
            ) : (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
                <p className="text-lg font-semibold text-emerald-900">Money pressure is under control right now.</p>
                <p className="mt-2 text-sm leading-6 text-emerald-800">
                  No urgent recovery cards are open. Stay ahead by keeping attendance fresh and refilling empty seats.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Target className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="font-display text-xl text-slate-950">Daily Action Flow</CardTitle>
                  <CardDescription>Guide the owner through the next best revenue move.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentStep ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 animate-pulse">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Current Step</p>
                  <p className="mt-2 text-lg font-semibold text-rose-900">
                    Step {currentStepIndex + 1}: {currentStep.step}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-rose-800">{currentStep.detail}</p>
                </div>
              ) : null}

              {dailyActionFlow.map((item, index) => (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-3xl border p-4 transition-colors",
                    index === currentStepIndex
                      ? "border-rose-200 bg-rose-50/70 shadow-sm shadow-rose-100/80"
                      : "border-slate-200 bg-slate-50/80",
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold shadow-sm",
                        index === currentStepIndex ? "bg-rose-100 text-rose-700" : "bg-white text-slate-950",
                      )}
                    >
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-950">{item.step}</p>
                        <Badge variant="outline" className={toneBadgeClassName[item.tone]}>
                          {item.status}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-slate-600">{item.detail}</p>
                      <Button
                        variant={index === currentStepIndex ? "default" : "ghost"}
                        className={cn(
                          "h-9 rounded-2xl text-sm font-semibold",
                          index === currentStepIndex ? "bg-slate-950 text-white hover:bg-slate-800" : "px-0 text-slate-900 hover:bg-transparent",
                        )}
                        onClick={item.onClick}
                      >
                        {item.actionLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <LayoutGrid className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="font-display text-xl text-slate-950">Business Metrics</CardTitle>
                  <CardDescription>Decision-focused business numbers for pricing, fill-rate, and churn control.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Monthly revenue</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatInr(revenueMTD)}</p>
                <p className="mt-2 text-sm text-slate-600">{revenueChangeText}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Churn rate</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{churnRate}%</p>
                <p className="mt-2 text-sm text-slate-600">Reduce this by calling risky seats before they lapse.</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Occupancy rate</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{occupancyRate}%</p>
                <p className="mt-2 text-sm text-slate-600">
                  {occupiedSeats}/{totalSeats} seats are monetized right now.
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue per seat</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{formatInr(revenuePerSeat)}</p>
                <p className="mt-2 text-sm text-slate-600">Use this to price better and judge refill quality.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card ref={seatViewRef} className="border-slate-200/80 bg-white/95 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.45)]">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">
                Seat Monetization View
              </Badge>
              <div>
                <CardTitle className="font-display text-2xl text-slate-950">See every seat as a revenue unit</CardTitle>
                <CardDescription className="mt-2 max-w-2xl">
                  Red means direct loss, orange means money at risk, green means protected revenue.
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                  Empty seat
                </Badge>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  At risk
                </Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  Paid
                </Badge>
              </div>
              <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => setFillSeatDialogOpen(true)}>
                Fill Seats Now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Empty seats</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-900">{emptySeats}</p>
              <p className="mt-2 text-sm text-rose-800">{formatInr(emptySeatRevenueLoss)} monthly loss</p>
            </div>
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">At-risk seats</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-900">{totalRiskStudents}</p>
              <p className="mt-2 text-sm text-amber-800">{formatInr(riskRevenueAtRisk)} needs protection</p>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Paid seats</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight text-emerald-900">
                {occupiedSeats - Math.min(totalRiskStudents, occupiedSeats)}
              </p>
              <p className="mt-2 text-sm text-emerald-800">Revenue is protected on these seats.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {seatMonetizationBlocks.map((seat) => (
              <div
                key={seat.seatLabel}
                className={cn("rounded-3xl border p-4 shadow-sm", seatToneClassName[seat.tone], seat.tone !== "paid" && "animate-pulse")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{seat.seatLabel}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] opacity-80">{seatToneLabel[seat.tone]}</p>
                  </div>
                  <AlertTriangle className={cn("h-4 w-4", seat.tone === "paid" && "hidden")} />
                </div>
                <p className="mt-6 text-lg font-semibold tracking-tight">{formatInr(seat.value)}</p>
                <p className="mt-1 text-xs opacity-80">monthly value</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-xl rounded-[28px] border-slate-200 bg-white p-0">
          {selectedItem ? (
            <>
              <DialogHeader className="border-b border-slate-200 px-6 py-5">
                <DialogTitle className="font-display text-2xl text-slate-950">Contact {selectedItem.name}</DialogTitle>
                <DialogDescription className="mt-2">
                  Choose the fastest recovery action. Track whether the student was called and whether they responded.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 px-6 py-5">
                <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                      {formatInr(selectedItem.amountAtRisk)} at risk
                    </Badge>
                    {selectedItem.seatNumber ? (
                      <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700">
                        Seat {selectedItem.seatNumber}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700">
                      {selectedItemStatus?.called ? "Called" : "Not called"}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white/70 text-slate-700">
                      {selectedItemStatus?.responded ? "Responded" : "Not responded"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">Reason: {selectedItem.reason}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Button className="h-12 rounded-2xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => handleContactAction(selectedItem, "call")}>
                    <Phone className="h-4 w-4" />
                    Call
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                    onClick={() => handleContactAction(selectedItem, "whatsapp")}
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    onClick={() => handleContactAction(selectedItem, "auto")}
                  >
                    <Bot className="h-4 w-4" />
                    Auto Call
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    variant={selectedItemStatus?.responded ? "default" : "outline"}
                    className={cn(
                      "h-12 rounded-2xl",
                      selectedItemStatus?.responded ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
                    )}
                    onClick={() => toggleResponded(selectedItem.id, !selectedItemStatus?.responded)}
                  >
                    {selectedItemStatus?.responded ? "Marked Responded" : "Mark Responded"}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                    onClick={() => toggleResponded(selectedItem.id, false)}
                  >
                    Mark No Response
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    className="h-12 rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                    onClick={() => {
                      onMarkPaid(selectedItem);
                      setSelectedItem(null);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark as Paid
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-2xl border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100"
                    onClick={() => {
                      onRemoveSeat(selectedItem);
                      setSelectedItem(null);
                    }}
                  >
                    <UserRoundX className="h-4 w-4" />
                    Remove Seat
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={fillSeatDialogOpen} onOpenChange={setFillSeatDialogOpen}>
        <DialogContent className="max-w-xl rounded-[28px] border-slate-200 bg-white p-0">
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle className="font-display text-2xl text-slate-950">Fill Seats Now</DialogTitle>
            <DialogDescription className="mt-2">
              Turn empty seats into revenue with direct admission outreach and marketing-ready assets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-900">
                {emptySeats} empty seats are currently leaking {formatInr(emptySeatRevenueLoss)} every month.
              </p>
            </div>

            <div className="grid gap-3">
              <Button
                className="h-12 justify-between rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => copyText(admissionLink, "Admission link copied", "Share the join link with your leads immediately.")}
              >
                Share admission link
                <ArrowRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                className="h-12 justify-between rounded-2xl border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                onClick={() => {
                  window.open(`https://wa.me/?text=${encodeURIComponent(seatFillWhatsAppMessage)}`, "_blank", "noopener,noreferrer");
                  toast({
                    title: "WhatsApp message opened",
                    description: "Seat fill message is ready to send.",
                  });
                }}
              >
                Generate WhatsApp message
                <ArrowRight className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                className="h-12 justify-between rounded-2xl border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                onClick={() => copyText(posterBrief, "Marketing poster brief copied", "Use this brief to create a fast admissions poster.")}
              >
                Marketing poster option
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RevenueControlDashboard;
