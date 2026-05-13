import { motion } from "framer-motion";
import type { ScannerLiveState, ScannerUiTone } from "@/components/scanner/types";
import { cn } from "@/lib/utils";

type ScannerFrameProps = {
  cameraLive: boolean;
  liveState: ScannerLiveState;
  onVideoRef: (el: HTMLVideoElement | null) => void;
  statusLabel: string;
  tone: ScannerUiTone;
};

const toneRing: Record<ScannerUiTone, string> = {
  danger: "border-rose-400/40 shadow-[0_0_40px_rgba(251,113,133,0.2)]",
  info: "border-cyan-400/40 shadow-[0_0_40px_rgba(34,211,238,0.2)]",
  neutral: "border-slate-400/30 shadow-[0_0_30px_rgba(148,163,184,0.1)]",
  success: "border-emerald-400/40 shadow-[0_0_40px_rgba(16,185,129,0.2)]",
  warning: "border-amber-400/40 shadow-[0_0_40px_rgba(245,158,11,0.2)]",
};

const toneCorner: Record<ScannerUiTone, string> = {
  danger: "border-rose-400",
  info: "border-cyan-300",
  neutral: "border-slate-400",
  success: "border-emerald-300",
  warning: "border-amber-300",
};

const toneLine: Record<ScannerUiTone, string> = {
  danger: "via-rose-400/80",
  info: "via-cyan-300/80",
  neutral: "via-slate-300/60",
  success: "via-emerald-300/80",
  warning: "via-amber-300/80",
};

const ScannerFrame = ({ cameraLive, liveState, onVideoRef, statusLabel, tone }: ScannerFrameProps) => (
  <div className="relative mx-auto w-full max-w-[min(80vw,440px)] sm:max-w-[min(70vw,480px)] lg:max-w-[440px] xl:max-w-[480px]">
    {/* Outer glow ring */}
    <div className={cn("absolute -inset-3 rounded-[32px] border opacity-60 transition-all duration-700", toneRing[tone])} />

    {/* Scanner container */}
    <div className="relative aspect-square w-full overflow-hidden rounded-[24px] border border-white/10 bg-[#020a14]">
      {/* Grid overlay */}
      <div className="absolute inset-0 z-[1] opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.3)_1px,transparent_1px)] [background-size:32px_32px]" />

      {/* Camera feed */}
      <video
        ref={onVideoRef}
        autoPlay
        className={cn(
          "absolute inset-0 z-[2] h-full w-full object-cover transition-opacity duration-500",
          cameraLive ? "opacity-80" : "opacity-0",
        )}
        muted
        playsInline
      />

      {/* Vignette */}
      <div className="absolute inset-0 z-[3] bg-[radial-gradient(circle,transparent_50%,rgba(0,0,0,0.6)_100%)]" />

      {/* Focus frame */}
      <div className="absolute inset-0 z-[4] flex items-center justify-center">
        <div className="relative h-[62%] w-[62%]">
          {/* Corners */}
          <div className={cn("absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-[3px] border-t-[3px] sm:h-10 sm:w-10", toneCorner[tone])} />
          <div className={cn("absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-[3px] border-t-[3px] sm:h-10 sm:w-10", toneCorner[tone])} />
          <div className={cn("absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-[3px] border-l-[3px] sm:h-10 sm:w-10", toneCorner[tone])} />
          <div className={cn("absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-[3px] border-r-[3px] sm:h-10 sm:w-10", toneCorner[tone])} />

          {/* Scan line */}
          {cameraLive ? (
            <motion.div
              className={cn("absolute inset-x-3 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent", toneLine[tone])}
              animate={{ top: ["12%", "86%", "12%"] }}
              transition={{ duration: liveState === "scanning" ? 1.6 : 2.4, ease: "linear", repeat: Infinity }}
            />
          ) : null}
        </div>
      </div>

      {/* Idle overlay */}
      {!cameraLive ? (
        <div className="absolute inset-0 z-[5] grid place-items-center bg-black/40 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <motion.div
              className="h-12 w-12 rounded-full border border-cyan-400/30 bg-cyan-500/10 grid place-items-center"
              animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <div className="h-3 w-3 rounded-full bg-cyan-300" />
            </motion.div>
            <p className="text-sm font-medium text-white/70">{statusLabel}</p>
          </div>
        </div>
      ) : null}
    </div>
  </div>
);

export default ScannerFrame;
