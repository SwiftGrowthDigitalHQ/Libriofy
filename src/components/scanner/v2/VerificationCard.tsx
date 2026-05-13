import { BadgeCheck, CircleX, WifiOff } from "lucide-react";
import type { ScannerUiTone } from "@/components/scanner/types";
import { cn } from "@/lib/utils";

type VerificationCardProps = {
  avatarLabel: string;
  name: string;
  plan: string;
  seat: string;
  statusLabel: string;
  subtitle: string;
  tone: ScannerUiTone;
};

const toneAvatar: Record<string, string> = {
  danger: "border-rose-400 bg-rose-500/10 text-rose-200",
  info: "border-cyan-400 bg-cyan-500/10 text-cyan-200",
  success: "border-emerald-400 bg-emerald-500/10 text-emerald-200",
};

const toneStatus: Record<string, string> = {
  danger: "text-rose-300",
  info: "text-cyan-300",
  success: "text-emerald-300",
};

const VerificationCard = ({ avatarLabel, name, plan, seat, statusLabel, subtitle, tone }: VerificationCardProps) => {
  const StatusIcon = tone === "danger" ? CircleX : tone === "info" ? WifiOff : BadgeCheck;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 text-lg font-bold", toneAvatar[tone] ?? toneAvatar.success)}>
          {avatarLabel}
        </div>

        <div className="min-w-0 flex-1">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("h-3.5 w-3.5", toneStatus[tone] ?? toneStatus.success)} />
            <span className={cn("text-[11px] font-bold uppercase tracking-wider", toneStatus[tone] ?? toneStatus.success)}>
              {statusLabel}
            </span>
          </div>

          {/* Name */}
          <h3 className="mt-1 truncate text-lg font-semibold text-white">{name}</h3>
          <p className="mt-0.5 truncate text-xs text-white/40">{subtitle}</p>
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[0.03] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Seat</p>
          <p className="mt-0.5 text-sm font-semibold text-white">{seat}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30">Plan</p>
          <p className="mt-0.5 text-sm font-semibold text-white">{plan}</p>
        </div>
      </div>
    </div>
  );
};

export default VerificationCard;
