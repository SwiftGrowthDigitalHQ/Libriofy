import { motion } from "framer-motion";
import { Shield, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import type { ScannerUiTone } from "@/components/scanner/types";
import { cn } from "@/lib/utils";

type StatusPulseProps = {
  label: string;
  message: string;
  online: boolean;
  tone: ScannerUiTone;
};

const toneConfig: Record<ScannerUiTone, { bg: string; icon: string; ring: string }> = {
  danger: { bg: "bg-rose-500/10", icon: "text-rose-300", ring: "border-rose-400/30" },
  info: { bg: "bg-cyan-500/10", icon: "text-cyan-300", ring: "border-cyan-400/30" },
  neutral: { bg: "bg-slate-500/10", icon: "text-slate-300", ring: "border-slate-400/30" },
  success: { bg: "bg-emerald-500/10", icon: "text-emerald-300", ring: "border-emerald-400/30" },
  warning: { bg: "bg-amber-500/10", icon: "text-amber-300", ring: "border-amber-400/30" },
};

const StatusPulse = ({ label, message, online, tone }: StatusPulseProps) => {
  const config = toneConfig[tone];
  const Icon = tone === "danger" ? ShieldAlert : Shield;

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        {/* Pulse rings */}
        {[0, 1].map((i) => (
          <motion.div
            key={i}
            className={cn("absolute inset-0 rounded-full border", config.ring)}
            animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ delay: i * 0.6, duration: 2.4, repeat: Infinity }}
          />
        ))}
        <div className={cn("relative grid h-12 w-12 place-items-center rounded-full border", config.ring, config.bg)}>
          <Icon className={cn("h-5 w-5", config.icon)} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn("text-sm font-semibold", config.icon)}>{label}</p>
          <div className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", config.bg)}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? "Live" : "Offline"}
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs text-white/50">{message}</p>
      </div>
    </div>
  );
};

export default StatusPulse;
