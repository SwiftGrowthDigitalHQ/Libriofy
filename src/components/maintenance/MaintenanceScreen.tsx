import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type MaintenanceScreenProps = {
  className?: string;
  state: "loading" | "maintenance";
};

const loadingCopy = {
  eyebrow: "Libriofy Smart Entry",
  title: "Checking system status",
  lines: ["Verifying secure access", "Please wait a moment"],
  footer: "Preparing the secure screen",
};

const maintenanceCopy = {
  eyebrow: "Libriofy Smart Entry",
  title: "System Update in Progress",
  lines: ["We're updating the system", "Please wait a moment"],
  footer: "Back shortly",
};

const Dot = ({ delay }: { delay: number }) => (
  <motion.span
    className="h-3 w-3 rounded-full bg-cyan-200/90"
    animate={{
      opacity: [0.35, 1, 0.35],
      y: [0, -6, 0],
      scale: [1, 1.12, 1],
    }}
    transition={{
      delay,
      duration: 1.3,
      ease: "easeInOut",
      repeat: Number.POSITIVE_INFINITY,
    }}
  />
);

const MaintenanceScreen = ({ className, state }: MaintenanceScreenProps) => {
  const copy = state === "maintenance" ? maintenanceCopy : loadingCopy;

  return (
    <div
      className={cn(
        "relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(8,145,178,0.18),transparent_35%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_30%),linear-gradient(160deg,#020617_0%,#07111f_45%,#02040a_100%)] px-6 py-10 text-slate-100",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy={state === "loading"}
    >
      <motion.div
        className="absolute inset-0 opacity-60"
        animate={{ opacity: [0.55, 0.82, 0.55], scale: [1, 1.025, 1] }}
        transition={{ duration: 5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <div className="absolute left-[10%] top-[14%] h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute right-[8%] top-[18%] h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute bottom-[10%] left-[35%] h-64 w-64 rounded-full bg-sky-300/8 blur-3xl" />
      </motion.div>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center text-center">
        <motion.div
          className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-cyan-200/20 bg-white/5 shadow-[0_0_60px_rgba(56,189,248,0.16)] backdrop-blur-xl"
          animate={{
            boxShadow: [
              "0 0 28px rgba(56, 189, 248, 0.12)",
              "0 0 54px rgba(16, 185, 129, 0.22)",
              "0 0 28px rgba(56, 189, 248, 0.12)",
            ],
            scale: [1, 1.03, 1],
          }}
          transition={{ duration: 3.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        >
          <div className="relative h-14 w-14">
            <span className="absolute inset-0 rounded-full border border-cyan-200/20" />
            <motion.span
              className="absolute inset-2 rounded-full border border-emerald-200/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 14, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
            />
            <motion.span
              className="absolute inset-4 rounded-full bg-gradient-to-br from-cyan-300/80 via-emerald-300/70 to-sky-200/70 blur-[1px]"
              animate={{ opacity: [0.55, 1, 0.55], scale: [0.92, 1, 0.92] }}
              transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
          </div>
        </motion.div>

        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.48em] text-cyan-100/70">
          {copy.eyebrow}
        </p>

        <h1 className="font-display text-4xl font-semibold tracking-tight text-white md:text-6xl">
          {copy.title}
        </h1>

        <div className="mt-5 space-y-2 text-lg text-slate-200/90 md:text-2xl">
          {copy.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        {state === "maintenance" ? (
          <p className="mt-5 text-sm font-medium uppercase tracking-[0.42em] text-emerald-100/65">
            {copy.footer}
          </p>
        ) : (
          <p className="mt-5 text-sm font-medium uppercase tracking-[0.3em] text-cyan-100/55">
            {copy.footer}
          </p>
        )}

        <div className="mt-10 flex items-center gap-3">
          <Dot delay={0} />
          <Dot delay={0.18} />
          <Dot delay={0.36} />
        </div>

        <div className="mt-8 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-sky-300"
            animate={{ x: ["-30%", "230%"] }}
            transition={{ duration: 2.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        </div>
      </div>
    </div>
  );
};

export default MaintenanceScreen;

