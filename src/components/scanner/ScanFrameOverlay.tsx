import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { ScannerLiveState } from "./types";

type ScanFrameOverlayProps = {
  cameraLive: boolean;
  detectionState: ScannerLiveState;
  feedbackLabel: string;
  instructionText: string;
};

const frameToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,0.25),0_0_48px_rgba(16,185,129,0.26)]",
  failed: "border-rose-300 shadow-[0_0_0_1px_rgba(253,164,175,0.22),0_0_40px_rgba(244,63,94,0.2)]",
  matched: "border-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,0.25),0_0_56px_rgba(16,185,129,0.28)]",
  offline: "border-amber-200 shadow-[0_0_0_1px_rgba(253,230,138,0.22),0_0_40px_rgba(245,158,11,0.18)]",
  ready: "border-white/75 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_0_38px_rgba(15,23,42,0.35)]",
  scanning: "border-emerald-300 shadow-[0_0_0_1px_rgba(110,231,183,0.25),0_0_52px_rgba(16,185,129,0.24)]",
};

const cornerToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-emerald-300",
  failed: "border-rose-300",
  matched: "border-emerald-300",
  offline: "border-amber-200",
  ready: "border-cyan-200/90",
  scanning: "border-emerald-300",
};

const labelToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-emerald-300/30 bg-emerald-400/14 text-emerald-50",
  failed: "border-rose-300/30 bg-rose-400/14 text-rose-50",
  matched: "border-emerald-300/30 bg-emerald-400/14 text-emerald-50",
  offline: "border-amber-300/30 bg-amber-400/14 text-amber-50",
  ready: "border-white/15 bg-slate-950/70 text-white/88",
  scanning: "border-emerald-300/30 bg-emerald-400/14 text-emerald-50",
};

const scanLineToneClasses: Record<ScannerLiveState, string> = {
  detected: "via-emerald-200 shadow-[0_0_22px_rgba(110,231,183,0.7)]",
  failed: "via-rose-200 shadow-[0_0_18px_rgba(253,164,175,0.6)]",
  matched: "via-emerald-200 shadow-[0_0_22px_rgba(110,231,183,0.7)]",
  offline: "via-amber-100 shadow-[0_0_18px_rgba(253,230,138,0.55)]",
  ready: "via-cyan-100 shadow-[0_0_18px_rgba(165,243,252,0.55)]",
  scanning: "via-emerald-200 shadow-[0_0_22px_rgba(110,231,183,0.65)]",
};

const ScanFrameOverlay = ({
  cameraLive,
  detectionState,
  feedbackLabel,
  instructionText,
}: ScanFrameOverlayProps) => (
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.2),rgba(2,6,23,0.48)_45%,rgba(2,6,23,0.72))]" />

    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 pb-8 pt-4 sm:gap-5 sm:px-8 sm:pb-10 sm:pt-6">
      <div
        className={cn(
          "rounded-full border px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.28em] backdrop-blur-xl sm:px-5",
          labelToneClasses[detectionState],
        )}
      >
        {feedbackLabel}
      </div>

      <div className="relative h-[clamp(13.75rem,54vw,18.75rem)] w-[clamp(13.75rem,54vw,18.75rem)] sm:h-[clamp(15.625rem,30vw,18.75rem)] sm:w-[clamp(15.625rem,30vw,18.75rem)]">
        <div className="absolute inset-0 rounded-[30px] shadow-[0_0_0_9999px_rgba(2,6,23,0.78)]" />

        <motion.div
          className={cn("absolute inset-0 rounded-[30px] border-2 bg-white/[0.015]", frameToneClasses[detectionState])}
          animate={{
            opacity: cameraLive ? 1 : 0.65,
            scale:
              detectionState === "detected" || detectionState === "matched"
                ? [1, 1.018, 1]
                : detectionState === "ready"
                  ? [1, 1.008, 1]
                  : [1, 1.012, 1],
          }}
          transition={{
            duration: detectionState === "detected" ? 0.7 : 1.8,
            ease: "easeInOut",
            repeat: cameraLive ? Number.POSITIVE_INFINITY : 0,
          }}
        />

        <div className="absolute inset-[10px] rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_68%)]" />

        {cameraLive ? (
          <motion.div
            className={cn(
              "absolute inset-x-4 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent",
              scanLineToneClasses[detectionState],
            )}
            animate={{ y: [18, 206, 18] }}
            transition={{ duration: detectionState === "ready" ? 2.3 : 1.5, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          />
        ) : null}

        <div className={cn("absolute left-0 top-0 h-12 w-12 rounded-tl-[30px] border-l-[4px] border-t-[4px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute right-0 top-0 h-12 w-12 rounded-tr-[30px] border-r-[4px] border-t-[4px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute bottom-0 left-0 h-12 w-12 rounded-bl-[30px] border-b-[4px] border-l-[4px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute bottom-0 right-0 h-12 w-12 rounded-br-[30px] border-b-[4px] border-r-[4px]", cornerToneClasses[detectionState])} />
      </div>

      <div className="rounded-full border border-white/12 bg-slate-950/76 px-4 py-2 text-center text-sm font-medium text-white/88 backdrop-blur-xl sm:px-5">
        {instructionText}
      </div>
    </div>
  </div>
);

export default ScanFrameOverlay;
