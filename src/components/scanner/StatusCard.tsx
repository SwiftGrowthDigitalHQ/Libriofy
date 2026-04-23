import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { ScannerDetailBadge, ScannerLiveState, ScannerUiTone } from "./types";

type StatusCardProps = {
  badges: ScannerDetailBadge[];
  headline: string;
  message: string;
  state: ScannerLiveState;
};

const toneMap: Record<ScannerLiveState, { pill: string; pulse: string; ring: string; text: string }> = {
  detected: {
    pill: "border-emerald-300/18 bg-emerald-400/12 text-emerald-50",
    pulse: "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.85)]",
    ring: "from-emerald-400/18 via-transparent to-transparent",
    text: "text-emerald-50",
  },
  failed: {
    pill: "border-rose-300/18 bg-rose-400/12 text-rose-50",
    pulse: "bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.85)]",
    ring: "from-rose-400/18 via-transparent to-transparent",
    text: "text-rose-100",
  },
  matched: {
    pill: "border-emerald-300/18 bg-emerald-400/12 text-emerald-50",
    pulse: "bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.85)]",
    ring: "from-emerald-400/18 via-transparent to-transparent",
    text: "text-emerald-100",
  },
  offline: {
    pill: "border-amber-300/18 bg-amber-400/12 text-amber-50",
    pulse: "bg-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.85)]",
    ring: "from-amber-300/18 via-transparent to-transparent",
    text: "text-amber-50",
  },
  ready: {
    pill: "border-cyan-300/18 bg-cyan-400/12 text-cyan-50",
    pulse: "bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.85)]",
    ring: "from-cyan-400/18 via-transparent to-transparent",
    text: "text-cyan-50",
  },
  scanning: {
    pill: "border-violet-300/18 bg-violet-400/12 text-violet-50",
    pulse: "bg-violet-300 shadow-[0_0_16px_rgba(167,139,250,0.85)]",
    ring: "from-violet-400/18 via-transparent to-transparent",
    text: "text-violet-50",
  },
};

const badgeToneMap: Record<ScannerUiTone, string> = {
  danger: "border-rose-300/16 bg-rose-400/10 text-rose-50",
  info: "border-cyan-300/16 bg-cyan-400/10 text-cyan-50",
  neutral: "border-white/10 bg-white/[0.04] text-white/78",
  success: "border-emerald-300/16 bg-emerald-400/10 text-emerald-50",
  warning: "border-amber-300/16 bg-amber-400/10 text-amber-50",
};

const StatusCard = ({ badges, headline, message, state }: StatusCardProps) => {
  const classes = toneMap[state];

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,36,0.9),rgba(6,10,23,0.92))] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.38)] backdrop-blur-2xl sm:p-6">
      <div className={cn("absolute inset-0 bg-gradient-to-br", classes.ring)} />
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/42">Live Status</p>
            <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5">
              <motion.span
                className={cn("h-3 w-3 rounded-full", classes.pulse)}
                animate={{ opacity: [0.45, 1, 0.45], scale: [1, 1.22, 1] }}
                transition={{ duration: 1.6, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY }}
              />
              <span className={cn("text-xs font-semibold uppercase tracking-[0.28em]", classes.text)}>{headline}</span>
            </div>
          </div>
          <div className={cn("rounded-full border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.28em]", classes.pill)}>
            {headline}
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-white/72 sm:text-[15px]">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <div
              key={`${badge.label}-${badge.value}`}
              className={cn(
                "rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.02em]",
                badgeToneMap[badge.tone ?? "neutral"],
              )}
            >
              <span className="text-white/45">{badge.label}</span> <span className="text-white/90">{badge.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatusCard;
