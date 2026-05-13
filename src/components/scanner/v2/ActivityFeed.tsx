import { motion } from "framer-motion";
import { CheckCircle2, CircleX, Clock } from "lucide-react";
import type { ScannerUiTone } from "@/components/scanner/types";
import { cn } from "@/lib/utils";

type ActivityItem = {
  detail: string;
  id: string;
  seat?: string | null;
  timestampLabel: string;
  title: string;
  tone: ScannerUiTone;
};

type ActivityFeedProps = {
  items: ActivityItem[];
};

const toneIcon: Record<string, string> = {
  danger: "text-rose-400",
  info: "text-cyan-400",
  success: "text-emerald-400",
};

const toneDot: Record<string, string> = {
  danger: "bg-rose-400",
  info: "bg-cyan-400",
  success: "bg-emerald-400",
};

const ActivityFeed = ({ items }: ActivityFeedProps) => {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 py-8">
        <p className="text-sm text-white/30">Scan activity will appear here in real time</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const Icon = item.tone === "danger" ? CircleX : item.tone === "info" ? Clock : CheckCircle2;
        return (
          <motion.div
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
            initial={index === 0 ? { opacity: 0, y: -8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className={cn("h-2 w-2 shrink-0 rounded-full", toneDot[item.tone] ?? toneDot.info)} />
            <Icon className={cn("h-4 w-4 shrink-0", toneIcon[item.tone] ?? toneIcon.info)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white/80">{item.title}</p>
                <span className="shrink-0 text-[11px] text-white/30">{item.timestampLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">{item.detail}</span>
                {item.seat ? <span className="text-[10px] uppercase tracking-wider text-white/25">Seat {item.seat}</span> : null}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default ActivityFeed;
