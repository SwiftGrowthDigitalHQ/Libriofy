import type { RefCallback } from "react";

import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import ScanFrameOverlay from "./ScanFrameOverlay";
import type { LastScanCardData, ScannerDetailBadge, ScannerLiveState } from "./types";

type ScannerCameraProps = {
  badges: ScannerDetailBadge[];
  cameraLive: boolean;
  detectionState: ScannerLiveState;
  feedbackLabel: string;
  instructionText: string;
  message: string;
  result: LastScanCardData | null;
  title: string;
  torchEnabled: boolean;
  torchSupported: boolean;
  videoRef: RefCallback<HTMLVideoElement>;
};

const resultToneClasses = {
  danger: "border-rose-300/24 bg-[linear-gradient(180deg,rgba(127,29,29,0.76),rgba(69,10,10,0.9))]",
  info: "border-cyan-300/24 bg-[linear-gradient(180deg,rgba(8,47,73,0.78),rgba(8,20,34,0.92))]",
  neutral: "border-white/12 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(2,6,23,0.94))]",
  success: "border-emerald-300/24 bg-[linear-gradient(180deg,rgba(6,78,59,0.78),rgba(2,44,34,0.94))]",
  warning: "border-amber-300/24 bg-[linear-gradient(180deg,rgba(120,53,15,0.8),rgba(69,26,3,0.94))]",
} as const;

const ScannerCamera = ({
  badges,
  cameraLive,
  detectionState,
  feedbackLabel,
  instructionText,
  message,
  result,
  title,
  torchEnabled,
  torchSupported,
  videoRef,
}: ScannerCameraProps) => (
  <main className="relative min-h-screen overflow-hidden bg-black text-white">
    <video
      ref={videoRef}
      autoPlay
      className={cn(
        "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
        cameraLive ? "opacity-100" : "opacity-35 saturate-50",
      )}
      muted
      playsInline
    />

    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,18,0.22),rgba(4,6,18,0.18)_28%,rgba(4,6,18,0.36)_68%,rgba(4,6,18,0.5))]" />

    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-5 sm:px-6">
      <div className="rounded-full bg-black/34 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/72 backdrop-blur-md">
        {feedbackLabel}
      </div>
      {torchSupported ? (
        <div className="rounded-full bg-black/34 px-3 py-1.5 text-[11px] font-semibold text-white/72 backdrop-blur-md">
          {torchEnabled ? "Torch On" : "Torch Ready"}
        </div>
      ) : null}
    </div>

    <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-6 sm:px-6">
      <div className="mx-auto max-w-sm rounded-full bg-black/34 px-4 py-2 text-center text-sm font-medium text-white/78 backdrop-blur-md">
        {instructionText}
      </div>
    </div>

    <ScanFrameOverlay
      cameraLive={cameraLive}
      detectionState={detectionState}
      feedbackLabel={feedbackLabel}
      instructionText={instructionText}
    />

    <AnimatePresence>
      {result ? (
        <motion.div
          key={result.id}
          className={cn(
            "absolute bottom-20 left-1/2 z-20 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[24px] border p-4 shadow-[0_24px_60px_rgba(2,8,23,0.32)] backdrop-blur-2xl sm:bottom-24",
            resultToneClasses[result.tone],
          )}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/58">{title}</p>
              <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">{result.name}</h2>
              <p className="mt-1 text-sm text-white/78">{result.statusLabel}</p>
            </div>
            <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/84">
              {result.timeLabel}
            </div>
          </div>

          <p className="mt-3 text-sm text-white/74">{result.subtitle}</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  </main>
);

export default ScannerCamera;
