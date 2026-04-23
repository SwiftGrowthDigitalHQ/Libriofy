import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { LastScanCardData } from "./types";

type ScanResultCardProps = {
  result: LastScanCardData | null;
};

const iconMap = {
  danger: TriangleAlert,
  info: ShieldCheck,
  neutral: ShieldCheck,
  success: CheckCircle2,
  warning: ShieldAlert,
} as const;

const toneMap = {
  danger: {
    icon: "border-rose-300/18 bg-rose-400/12 text-rose-100",
    ring: "from-rose-400/16 to-transparent",
    value: "text-rose-100",
  },
  info: {
    icon: "border-cyan-300/18 bg-cyan-400/12 text-cyan-100",
    ring: "from-cyan-400/16 to-transparent",
    value: "text-cyan-100",
  },
  neutral: {
    icon: "border-white/10 bg-white/[0.05] text-white/88",
    ring: "from-white/10 to-transparent",
    value: "text-white",
  },
  success: {
    icon: "border-emerald-300/18 bg-emerald-400/12 text-emerald-100",
    ring: "from-emerald-400/16 to-transparent",
    value: "text-emerald-100",
  },
  warning: {
    icon: "border-amber-300/18 bg-amber-400/12 text-amber-100",
    ring: "from-amber-300/16 to-transparent",
    value: "text-amber-100",
  },
} as const;

const ScanResultCard = ({ result }: ScanResultCardProps) => (
  <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,36,0.9),rgba(6,10,23,0.92))] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.38)] backdrop-blur-2xl sm:p-6">
    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/42">Last Scan Result</p>

    <AnimatePresence mode="wait">
      {result ? (
        <motion.div
          key={result.id}
          className="relative mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-5"
          initial={{ opacity: 0, x: 24, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -24, scale: 0.98 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          <div className={cn("absolute inset-0 bg-gradient-to-br", toneMap[result.tone].ring)} />
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">{result.statusLabel}</p>
                <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-0.04em] text-white">{result.name}</h3>
              </div>
              <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", toneMap[result.tone].icon)}>
                {(() => {
                  const Icon = iconMap[result.tone];
                  return <Icon className="h-5 w-5" />;
                })()}
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-white/70">{result.subtitle}</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-[18px] border border-white/10 bg-slate-950/45 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">Confidence</p>
                <p className={cn("mt-2 text-xl font-semibold", toneMap[result.tone].value)}>{result.confidence}%</p>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-slate-950/45 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">Entry Time</p>
                <p className="mt-2 text-xl font-semibold text-white">{result.timeLabel}</p>
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="scan-result-empty"
          className="mt-4 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center"
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <p className="text-sm font-medium text-white/72">No scan captured yet.</p>
          <p className="mt-2 text-sm text-white/42">The first successful or failed verification will appear here instantly.</p>
        </motion.div>
      )}
    </AnimatePresence>
  </section>
);

export default ScanResultCard;
