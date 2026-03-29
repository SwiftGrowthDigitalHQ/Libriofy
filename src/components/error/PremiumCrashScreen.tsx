import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Home, Loader2, RefreshCcw, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { classifyAppError } from "@/lib/errorHandling";

type PremiumCrashScreenProps = {
  error: unknown;
  onGoDashboard: () => void;
  onReportIssue: () => void;
  onRetry: () => Promise<void> | void;
};

const floatingParticles = Array.from({ length: 10 }, (_, index) => ({
  delay: index * 0.18,
  duration: 5 + index * 0.4,
  left: 8 + index * 8,
  size: index % 2 === 0 ? 12 : 18,
  top: 10 + (index % 5) * 16,
}));

const PremiumCrashScreen = ({
  error,
  onGoDashboard,
  onReportIssue,
  onRetry,
}: PremiumCrashScreenProps) => {
  const [isRetrying, setIsRetrying] = useState(false);
  const errorState = classifyAppError(error);
  const timestamp = useMemo(() => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), []);

  const handleRetry = async () => {
    setIsRetrying(true);

    try {
      await onRetry();
    } finally {
      setTimeout(() => setIsRetrying(false), 1200);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_30%),linear-gradient(135deg,#020617_0%,#0f172a_45%,#111827_100%)] px-4 py-12 text-white">
      <div className="absolute inset-0 overflow-hidden">
        {floatingParticles.map((particle, index) => (
          <motion.span
            key={`particle-${index}`}
            className="absolute rounded-full bg-white/10 shadow-[0_0_24px_rgba(56,189,248,0.25)]"
            style={{
              height: particle.size,
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              width: particle.size,
            }}
            animate={{
              opacity: [0.18, 0.42, 0.18],
              y: [0, -18, 0],
            }}
            transition={{
              delay: particle.delay,
              duration: particle.duration,
              repeat: Infinity,
              repeatType: "mirror",
            }}
          />
        ))}

        <motion.div
          className="absolute left-1/2 top-[18%] h-72 w-72 -translate-x-1/2 rounded-full bg-sky-500/15 blur-3xl"
          animate={{ opacity: [0.35, 0.6, 0.35], scale: [1, 1.08, 1] }}
          transition={{ duration: 7, repeat: Infinity }}
        />
        <motion.div
          className="absolute bottom-[8%] right-[12%] h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl"
          animate={{ opacity: [0.2, 0.45, 0.2], scale: [1.04, 0.96, 1.04] }}
          transition={{ duration: 8, repeat: Infinity }}
        />
      </div>

      <motion.div
        className="relative w-full max-w-4xl"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
      >
        <div className="relative overflow-hidden rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-[0_24px_90px_rgba(2,6,23,0.55)] backdrop-blur-2xl sm:p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />

          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-sky-100 backdrop-blur-sm">
                  {errorState.statusLabel}
                </Badge>
                <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-white/80">
                  Last checkpoint protected
                </Badge>
              </div>

              <div className="space-y-4">
                <motion.div
                  className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 shadow-[0_0_40px_rgba(56,189,248,0.18)]"
                  animate={{ rotate: [0, -3, 3, 0] }}
                  transition={{ duration: 3.5, repeat: Infinity }}
                >
                  <AlertTriangle className="h-6 w-6 text-sky-100" />
                </motion.div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                    Something broke… but we’re fixing it ⚡
                  </h1>
                  <p className="mt-3 text-base text-slate-200 sm:text-lg">
                    Don’t worry — your data is safe.
                  </p>
                </div>
                <p className="max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                  {errorState.recoveryMessage}
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/15 p-4 shadow-inner shadow-slate-950/20">
                <div className="flex items-start gap-3">
                  <div className="mt-1 rounded-full bg-emerald-400/15 p-2 text-emerald-200">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Recovery status</p>
                    <p className="mt-1 text-sm text-slate-300">{errorState.publicMessage}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-400">Updated at {timestamp}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    className="h-12 min-w-[160px] bg-sky-500 text-white shadow-[0_0_25px_rgba(56,189,248,0.35)] transition-all hover:bg-sky-400 hover:shadow-[0_0_35px_rgba(56,189,248,0.45)]"
                    onClick={handleRetry}
                    disabled={isRetrying}
                  >
                    {isRetrying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="mr-2 h-4 w-4" />
                    )}
                    {isRetrying ? "Retrying..." : "Retry"}
                  </Button>
                </motion.div>

                <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="outline"
                    className="h-12 min-w-[180px] border-white/15 bg-white/5 text-white hover:border-sky-200/40 hover:bg-white/10"
                    onClick={onGoDashboard}
                  >
                    <Home className="mr-2 h-4 w-4" />
                    Go to Dashboard
                  </Button>
                </motion.div>

                <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="ghost"
                    className="h-12 min-w-[160px] text-slate-100 hover:bg-white/10 hover:text-white"
                    onClick={onReportIssue}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Report Issue
                  </Button>
                </motion.div>
              </div>
            </div>

            <div className="relative flex min-h-[320px] items-center justify-center">
              <motion.div
                className="absolute h-60 w-60 rounded-full border border-sky-300/10 bg-sky-300/5 blur-2xl"
                animate={{ scale: [0.94, 1.08, 0.94], opacity: [0.35, 0.6, 0.35] }}
                transition={{ duration: 6, repeat: Infinity }}
              />

              <motion.div
                className="relative flex h-72 w-72 items-center justify-center rounded-[30px] border border-white/10 bg-white/8 backdrop-blur-xl"
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <motion.div
                  className="absolute inset-6 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.3))]"
                  animate={{ opacity: [0.75, 1, 0.75] }}
                  transition={{ duration: 3.2, repeat: Infinity }}
                />

                <div className="relative z-10 flex flex-col items-center gap-5">
                  <motion.div
                    className="flex gap-3"
                    animate={{ x: [0, -6, 6, 0] }}
                    transition={{ duration: 2.8, repeat: Infinity }}
                  >
                    <span className="h-24 w-6 rounded-full bg-sky-300/70 shadow-[0_0_20px_rgba(125,211,252,0.5)]" />
                    <span className="h-20 w-6 rounded-full bg-fuchsia-300/70 shadow-[0_0_20px_rgba(240,171,252,0.4)]" />
                    <span className="h-28 w-6 rounded-full bg-emerald-300/70 shadow-[0_0_20px_rgba(110,231,183,0.45)]" />
                  </motion.div>

                  <motion.div
                    className="grid grid-cols-3 gap-3"
                    initial={{ opacity: 0.7 }}
                    animate={{ opacity: [0.55, 1, 0.55] }}
                    transition={{ duration: 2.4, repeat: Infinity }}
                  >
                    {Array.from({ length: 6 }).map((_, index) => (
                      <motion.span
                        key={`cell-${index}`}
                        className="h-6 w-6 rounded-lg bg-white/12"
                        animate={{ y: index % 2 === 0 ? [0, -4, 0] : [0, 4, 0] }}
                        transition={{ duration: 2.8 + index * 0.15, repeat: Infinity }}
                      />
                    ))}
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PremiumCrashScreen;
