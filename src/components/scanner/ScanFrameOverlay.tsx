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
  detected: "border-fuchsia-300/44 shadow-[0_0_0_1px_rgba(232,121,249,0.2)]",
  failed: "border-rose-300/40 shadow-[0_0_0_1px_rgba(253,164,175,0.18)]",
  matched: "border-fuchsia-300/44 shadow-[0_0_0_1px_rgba(232,121,249,0.2)]",
  offline: "border-amber-200/38 shadow-[0_0_0_1px_rgba(253,230,138,0.18)]",
  ready: "border-white/18 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]",
  scanning: "border-fuchsia-300/44 shadow-[0_0_0_1px_rgba(232,121,249,0.2)]",
};

const cornerToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-fuchsia-500",
  failed: "border-rose-400",
  matched: "border-fuchsia-500",
  offline: "border-amber-300",
  ready: "border-fuchsia-500",
  scanning: "border-fuchsia-500",
};

const labelToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-fuchsia-400/30 bg-black/28 text-white/90",
  failed: "border-rose-300/30 bg-black/28 text-white/90",
  matched: "border-fuchsia-400/30 bg-black/28 text-white/90",
  offline: "border-amber-300/30 bg-black/28 text-white/90",
  ready: "border-white/12 bg-black/24 text-white/78",
  scanning: "border-fuchsia-400/30 bg-black/28 text-white/90",
};

const scanLineToneClasses: Record<ScannerLiveState, string> = {
  detected: "via-fuchsia-300 shadow-[0_0_18px_rgba(192,38,211,0.45)]",
  failed: "via-rose-200 shadow-[0_0_16px_rgba(253,164,175,0.45)]",
  matched: "via-fuchsia-300 shadow-[0_0_18px_rgba(192,38,211,0.45)]",
  offline: "via-amber-100 shadow-[0_0_16px_rgba(253,230,138,0.4)]",
  ready: "via-fuchsia-300 shadow-[0_0_18px_rgba(192,38,211,0.38)]",
  scanning: "via-fuchsia-300 shadow-[0_0_18px_rgba(192,38,211,0.45)]",
};

const ScanFrameOverlay = ({
  cameraLive,
  detectionState,
  feedbackLabel,
  instructionText,
}: ScanFrameOverlayProps) => (
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02),rgba(0,0,0,0.08)_34%,rgba(0,0,0,0.2)_72%,rgba(0,0,0,0.34))]" />

    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-4">
      <div
        className={cn(
          "rounded-full border px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.28em] backdrop-blur-xl",
          labelToneClasses[detectionState],
        )}
      >
        {feedbackLabel}
      </div>

      <div className="relative h-[min(70vw,24rem)] w-[min(70vw,24rem)] max-h-[24rem] max-w-[24rem] sm:h-[min(62vw,26rem)] sm:w-[min(62vw,26rem)]">
        <div className="absolute inset-0 rounded-[30px] bg-white/14 shadow-[0_0_0_9999px_rgba(0,0,0,0.24)] backdrop-blur-[1.5px]" />

        <motion.div
          className={cn("absolute inset-0 rounded-[30px] border bg-white/[0.06]", frameToneClasses[detectionState])}
          animate={{
            opacity: cameraLive ? 1 : 0.65,
            scale:
              detectionState === "detected" || detectionState === "matched"
                ? [1, 1.01, 1]
                : detectionState === "ready"
                  ? [1, 1.004, 1]
                  : [1, 1.008, 1],
          }}
          transition={{
            duration: detectionState === "detected" ? 0.55 : 1.6,
            ease: "easeInOut",
            repeat: cameraLive ? Number.POSITIVE_INFINITY : 0,
          }}
        />

        <div className="absolute inset-0 rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.03)_30%,rgba(255,255,255,0.02)_100%)]" />

        {cameraLive ? (
          <motion.div
            className={cn(
              "absolute inset-x-8 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent",
              scanLineToneClasses[detectionState],
            )}
            animate={{ y: ["18%", "78%", "18%"] }}
            transition={{ duration: detectionState === "ready" ? 2.5 : 1.55, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
          />
        ) : null}

        <div className={cn("absolute left-[6%] top-[6%] h-16 w-16 rounded-tl-[26px] border-l-[6px] border-t-[6px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute right-[6%] top-[6%] h-16 w-16 rounded-tr-[26px] border-r-[6px] border-t-[6px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute bottom-[6%] left-[6%] h-16 w-16 rounded-bl-[26px] border-b-[6px] border-l-[6px]", cornerToneClasses[detectionState])} />
        <div className={cn("absolute bottom-[6%] right-[6%] h-16 w-16 rounded-br-[26px] border-b-[6px] border-r-[6px]", cornerToneClasses[detectionState])} />
      </div>
    </div>
  </div>
);

export default ScanFrameOverlay;
