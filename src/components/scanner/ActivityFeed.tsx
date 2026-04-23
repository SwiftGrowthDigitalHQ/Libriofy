import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Clock3, Radio, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ActivityFeedItem } from "./types";

type ActivityFeedProps = {
  items: ActivityFeedItem[];
};

const toneClasses = {
  danger: "border-rose-300/16 bg-rose-400/10 text-rose-50",
  info: "border-cyan-300/16 bg-cyan-400/10 text-cyan-50",
  neutral: "border-white/10 bg-white/[0.04] text-white/80",
  success: "border-emerald-300/16 bg-emerald-400/10 text-emerald-50",
  warning: "border-amber-300/16 bg-amber-400/10 text-amber-50",
} as const;

const iconMap = {
  danger: AlertTriangle,
  info: Radio,
  neutral: Clock3,
  success: CheckCircle2,
  warning: ShieldAlert,
} as const;

const ActivityFeed = ({ items }: ActivityFeedProps) => (
  <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,36,0.9),rgba(6,10,23,0.92))] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.38)] backdrop-blur-2xl sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/42">Realtime Activity</p>
        <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em] text-white">System feed</h3>
      </div>
      <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-white/55">
        Auto-refreshing
      </div>
    </div>

    <div className="mt-5 max-h-[22rem] space-y-3 overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {items.length ? (
          items.map((item) => {
            const Icon = iconMap[item.tone];

            return (
              <motion.div
                key={item.id}
                className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border", toneClasses[item.tone])}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      {item.badge ? (
                        <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]", toneClasses[item.tone])}>
                          {item.badge}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-white/58">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-white/36">{item.timestampLabel}</span>
                </div>
              </motion.div>
            );
          })
        ) : (
          <motion.div
            key="activity-empty"
            className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-10 text-center"
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="text-sm font-medium text-white/72">Waiting for scanner activity.</p>
            <p className="mt-2 text-sm text-white/42">Camera startup, verification, sync, and failures will stream here.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </section>
);

export default ActivityFeed;
