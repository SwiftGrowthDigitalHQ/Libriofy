import { BarChart3 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ScannerStatItem } from "./types";

type StatsPanelProps = {
  items: ScannerStatItem[];
};

const toneClasses = {
  danger: "border-rose-300/14 bg-rose-400/10",
  info: "border-cyan-300/14 bg-cyan-400/10",
  neutral: "border-white/10 bg-white/[0.04]",
  success: "border-emerald-300/14 bg-emerald-400/10",
  warning: "border-amber-300/14 bg-amber-400/10",
} as const;

const StatsPanel = ({ items }: StatsPanelProps) => (
  <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,36,0.9),rgba(6,10,23,0.92))] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.38)] backdrop-blur-2xl sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/42">Today Stats</p>
        <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">Operational pulse</h3>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-cyan-100">
        <BarChart3 className="h-5 w-5" />
      </div>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-[22px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
            toneClasses[item.tone ?? "neutral"],
          )}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">{item.label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{item.value}</p>
          <p className="mt-2 text-sm leading-6 text-white/56">{item.helper}</p>
        </div>
      ))}
    </div>
  </section>
);

export default StatsPanel;
