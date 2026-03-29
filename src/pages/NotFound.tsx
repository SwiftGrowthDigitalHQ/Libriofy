import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const shelfRows = Array.from({ length: 4 }, (_, rowIndex) => rowIndex);

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.16),transparent_35%),linear-gradient(135deg,#f8fafc_0%,#e2e8f0_55%,#dbeafe_100%)] px-4 py-12 text-slate-950">
      <motion.div
        className="absolute left-[10%] top-[16%] h-44 w-44 rounded-full bg-emerald-300/30 blur-3xl"
        animate={{ scale: [1, 1.08, 1], opacity: [0.45, 0.7, 0.45] }}
        transition={{ duration: 8, repeat: Infinity }}
      />
      <motion.div
        className="absolute bottom-[10%] right-[12%] h-52 w-52 rounded-full bg-sky-300/25 blur-3xl"
        animate={{ scale: [1.06, 0.96, 1.06], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 9, repeat: Infinity }}
      />

      <motion.div
        className="relative w-full max-w-5xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div className="grid gap-8 overflow-hidden rounded-[34px] border border-white/60 bg-white/60 p-6 shadow-[0_32px_90px_rgba(15,23,42,0.14)] backdrop-blur-2xl lg:grid-cols-[1.05fr_0.95fr] lg:p-10">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="border border-slate-200 bg-white/80 text-slate-700">Premium 404</Badge>
              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">Navigation Safe</Badge>
            </div>

            <div className="space-y-4">
              <motion.div
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_0_30px_rgba(15,23,42,0.18)]"
                animate={{ rotate: [0, -4, 4, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
              >
                <BookOpen className="h-6 w-6" />
              </motion.div>

              <div>
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Lost in the library? 📚</h1>
                <p className="mt-3 text-lg text-slate-600">This page doesn’t exist.</p>
              </div>

              <p className="max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                The shelf you're looking for isn't here, but the rest of your workspace is still right where you left it.
                Head back to the dashboard or retrace your last step.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                <Button
                  className="h-12 min-w-[160px] bg-slate-950 text-white shadow-[0_0_25px_rgba(15,23,42,0.18)] hover:bg-slate-800"
                  onClick={() => navigate("/")}
                >
                  <Home className="mr-2 h-4 w-4" />
                  Go Home
                </Button>
              </motion.div>

              <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}>
                <Button
                  variant="outline"
                  className="h-12 min-w-[140px] border-slate-300 bg-white/70 text-slate-700 hover:bg-white"
                  onClick={() => navigate(-1)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
              </motion.div>
            </div>
          </div>

          <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(241,245,249,0.75))] p-6">
            <motion.div
              className="absolute inset-x-10 bottom-10 h-3 rounded-full bg-slate-300/50 blur-lg"
              animate={{ opacity: [0.3, 0.55, 0.3], scaleX: [0.94, 1.04, 0.94] }}
              transition={{ duration: 4.2, repeat: Infinity }}
            />

            <motion.div
              className="relative w-full max-w-sm"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="rounded-[26px] border border-slate-200 bg-white/85 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
                <div className="space-y-4">
                  {shelfRows.map((row) => (
                    <div key={`shelf-${row}`} className="relative rounded-2xl border border-slate-200 bg-slate-100/80 p-3">
                      <div className="absolute inset-x-3 bottom-2 h-1 rounded-full bg-slate-300/60" />
                      <div className="flex items-end gap-2">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <motion.span
                            key={`book-${row}-${index}`}
                            className="rounded-t-xl"
                            style={{
                              background:
                                index % 3 === 0
                                  ? "linear-gradient(180deg, rgba(14,165,233,0.8), rgba(37,99,235,0.7))"
                                  : index % 3 === 1
                                    ? "linear-gradient(180deg, rgba(16,185,129,0.78), rgba(5,150,105,0.72))"
                                    : "linear-gradient(180deg, rgba(244,114,182,0.72), rgba(168,85,247,0.68))",
                              height: `${44 + ((row + index) % 3) * 10}px`,
                              width: `${18 + (index % 2) * 4}px`,
                            }}
                            animate={{ y: index === 2 && row === 1 ? [0, -10, 0] : [0, -2, 0] }}
                            transition={{ duration: 3 + index * 0.25, repeat: Infinity }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default NotFound;
