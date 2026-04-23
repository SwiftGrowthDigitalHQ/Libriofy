import type { RefCallback } from "react";

import { AnimatePresence, motion } from "framer-motion";
import { Flashlight, FlashlightOff } from "lucide-react";

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

const badgeToneClasses = {
  danger: "border-rose-300/20 bg-rose-400/10 text-rose-50",
  info: "border-cyan-300/20 bg-cyan-400/10 text-cyan-50",
  neutral: "border-white/12 bg-white/[0.04] text-white/80",
  success: "border-emerald-300/20 bg-emerald-400/10 text-emerald-50",
  warning: "border-amber-300/20 bg-amber-400/10 text-amber-50",
} as const;

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
  <main className="relative min-h-screen overflow-hidden bg-[#020817] text-white">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(21,94,117,0.28),transparent_35%),radial-gradient(circle_at_bottom,rgba(15,23,42,0.42),transparent_42%)]" />
    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.88),rgba(2,6,23,0.96))]" />

    <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-0 sm:px-5 lg:px-8">
      <div className="px-4 pb-4 pt-6 sm:px-1 sm:pb-6 sm:pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-100/62">{title}</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-[2.35rem]">{instructionText}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/66 sm:text-[15px]">{message}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <div
              key={`${badge.label}-${badge.value}`}
              className={cn(
                "rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[0.02em] backdrop-blur-xl",
                badgeToneClasses[badge.tone ?? "neutral"],
              )}
            >
              <span className="text-white/52">{badge.label}</span> <span className="text-white/94">{badge.value}</span>
            </div>
          ))}

          {torchSupported ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-white/82 backdrop-blur-xl">
              {torchEnabled ? <Flashlight className="h-3.5 w-3.5 text-amber-200" /> : <FlashlightOff className="h-3.5 w-3.5 text-white/60" />}
              {torchEnabled ? "Torch enabled" : "Torch ready"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden border-y border-white/10 bg-slate-950 sm:mb-8 sm:rounded-[34px] sm:border sm:shadow-[0_28px_120px_rgba(2,8,23,0.45)]">
        <div className="relative min-h-[calc(100svh-10rem)] overflow-hidden sm:min-h-[44rem]">
          <video
            ref={videoRef}
            autoPlay
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
              cameraLive ? "opacity-100" : "opacity-25 saturate-50",
            )}
            muted
            playsInline
          />

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_38%),linear-gradient(180deg,rgba(2,6,23,0.14),rgba(2,6,23,0.42)_58%,rgba(2,6,23,0.78))]" />

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
                  "absolute bottom-5 left-1/2 z-20 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-[26px] border p-4 shadow-[0_24px_80px_rgba(2,8,23,0.44)] backdrop-blur-2xl sm:bottom-6 sm:p-5",
                  resultToneClasses[result.tone],
                )}
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/54">Scan Result</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white sm:text-[1.65rem]">{result.name}</h2>
                  </div>
                  <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/88">
                    {result.timeLabel}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <div className="rounded-[18px] border border-white/10 bg-black/18 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/46">Name</p>
                    <p className="mt-2 text-sm font-semibold text-white">{result.name}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/18 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/46">Seat</p>
                    <p className="mt-2 text-sm font-semibold text-white">{result.seat || "--"}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/10 bg-black/18 px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/46">Status</p>
                    <p className="mt-2 text-sm font-semibold text-white">{result.statusLabel}</p>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  </main>
);

export default ScannerCamera;
