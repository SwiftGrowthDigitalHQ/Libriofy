import { CheckCircle2, CircleX, Clock } from "lucide-react";
import type { ScannerUiTone } from "@/components/scanner/types";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  tone: ScannerUiTone;
  value: string;
};

const toneStyles: Record<string, { border: string; icon: string; text: string }> = {
  danger: { border: "border-rose-500/20", icon: "text-rose-400", text: "text-rose-300" },
  info: { border: "border-cyan-500/20", icon: "text-cyan-400", text: "text-cyan-300" },
  success: { border: "border-emerald-500/20", icon: "text-emerald-400", text: "text-emerald-300" },
};

const MetricCard = ({ label, tone, value }: MetricCardProps) => {
  const style = toneStyles[tone] ?? toneStyles.info;
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? CircleX : Clock;

  return (
    <div className={cn("rounded-2xl border bg-white/[0.02] px-4 py-3 backdrop-blur-sm", style.border)}>
      <div className="flex items-center justify-between">
        <Icon className={cn("h-4 w-4", style.icon)} />
        <span className={cn("font-display text-2xl font-bold tracking-tight", style.text)}>{value}</span>
      </div>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
};

export default MetricCard;
