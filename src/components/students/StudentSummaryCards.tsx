import { AlertCircle, CircleDollarSign, IndianRupee, Wallet } from "lucide-react";

import type { StudentsSummary } from "@/api/students";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StudentSummaryCardsProps = {
  isLoading: boolean;
  isSummaryApproximate: boolean;
  summary: StudentsSummary;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);

const summaryCardConfig = [
  {
    accentClassName: "from-emerald-500/20 via-emerald-500/5 to-transparent",
    icon: IndianRupee,
    key: "totalRevenue",
    label: "Total Revenue",
    valueClassName: "text-emerald-700",
  },
  {
    accentClassName: "from-rose-500/20 via-rose-500/5 to-transparent",
    icon: Wallet,
    key: "pendingAmount",
    label: "Pending Amount",
    valueClassName: "text-rose-700",
  },
  {
    accentClassName: "from-sky-500/20 via-sky-500/5 to-transparent",
    icon: CircleDollarSign,
    key: "paidStudents",
    label: "Paid Students",
    valueClassName: "text-sky-700",
  },
  {
    accentClassName: "from-amber-500/20 via-amber-500/5 to-transparent",
    icon: AlertCircle,
    key: "unpaidStudents",
    label: "Unpaid Students",
    valueClassName: "text-amber-700",
  },
] as const;

const summaryValueMap = (summary: StudentsSummary) => ({
  paidStudents: summary.paidStudents.toLocaleString("en-IN"),
  pendingAmount: formatInr(summary.pendingAmount),
  totalRevenue: formatInr(summary.totalRevenue),
  unpaidStudents: summary.unpaidStudents.toLocaleString("en-IN"),
});

const StudentSummaryCards = ({ isLoading, isSummaryApproximate, summary }: StudentSummaryCardsProps) => {
  const valueMap = summaryValueMap(summary);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {summaryCardConfig.map((card) => {
        const Icon = card.icon;

        return (
          <Card key={card.key} className="relative overflow-hidden border-border/70 bg-card/95 shadow-sm">
            <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", card.accentClassName)} />
            <CardContent className="relative flex items-start justify-between gap-3 p-5">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</p>
                  <p className={cn("mt-2 text-3xl font-semibold tracking-tight", card.valueClassName)}>
                    {isLoading ? "--" : valueMap[card.key]}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {card.key === "pendingAmount"
                    ? `${summary.overdueStudents.toLocaleString("en-IN")} overdue students need attention.`
                    : card.key === "unpaidStudents"
                      ? "Includes unpaid and overdue accounts."
                      : isSummaryApproximate
                        ? "Computed from the visible page while the API summary is unavailable."
                        : "Pulled directly from the paginated API."}
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/60 bg-white/80 shadow-sm">
                <Icon className="h-5 w-5 text-slate-700" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default StudentSummaryCards;
