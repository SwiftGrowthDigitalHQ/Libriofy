import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, QrCode, ShieldCheck, Sparkles, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { normalizeLibraryAccessKey } from "@/lib/libraryAccessKey";
import { cn } from "@/lib/utils";
import {
  consumeDeviceSetupNotice,
  hasStoredLibraryBinding,
  writeStoredLibraryBinding,
} from "@/lib/deviceKiosk";

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";

type DeviceSetupRpcResult = {
  valid?: boolean;
  bound?: boolean;
  deviceId?: string;
  libraryAccessKey?: string;
  library?:
    | {
        id?: string;
        name?: string | null;
        library_name?: string | null;
        logo_url?: string | null;
        primary_color?: string | null;
      }
    | null;
  message?: string;
  code?: string;
  lockedUntil?: string | null;
};

const formatLockedUntilMessage = (lockedUntil: string | null | undefined) => {
  if (!lockedUntil) {
    return "Too many invalid attempts. Device locked.";
  }

  const parsed = new Date(lockedUntil);
  if (Number.isNaN(parsed.getTime())) {
    return "Too many invalid attempts. Device locked.";
  }

  return `Too many invalid attempts. Try again after ${parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}.`;
};

const SetupDevicePage = () => {
  const navigate = useNavigate();
  const [libraryId, setLibraryId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectedMessage, setConnectedMessage] = useState<string | null>(null);
  const [setupNotice, setSetupNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setSetupNotice(consumeDeviceSetupNotice());
  }, []);

  const [hasBinding, setHasBinding] = useState(false);

  useEffect(() => {
    if (hasBinding) {
      navigate("/scan", { replace: true });
    }
  }, [hasBinding, navigate]);

  useEffect(() => {
    setHasBinding(hasStoredLibraryBinding());
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedLibraryAccessKey = normalizeLibraryAccessKey(libraryId);
    if (!normalizedLibraryAccessKey) {
      setErrorMessage("Enter a valid Library Access Key.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.rpc("validate_and_bind_scanner_device", {
        p_library_access_key: normalizedLibraryAccessKey,
        p_device_id: DEVICE_ID,
      });

      if (error) {
        throw error;
      }

      const payload = (data ?? null) as DeviceSetupRpcResult | null;
      const valid = payload?.valid === true;

      if (!valid) {
        const message =
          payload?.code === "DEVICE_SETUP_LOCKED"
            ? formatLockedUntilMessage(payload.lockedUntil)
            : typeof payload?.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Unable to validate this Library Access Key.";
        throw new Error(message);
      }

      const libraryRecord = payload?.library && typeof payload.library === "object" && !Array.isArray(payload.library)
        ? payload.library
        : null;
      const resolvedLibraryId = typeof libraryRecord?.id === "string" && libraryRecord.id.trim() ? libraryRecord.id.trim() : "";
      const resolvedAccessKey =
        typeof payload?.libraryAccessKey === "string" && payload.libraryAccessKey.trim()
          ? payload.libraryAccessKey.trim()
          : normalizedLibraryAccessKey;

      if (!resolvedLibraryId) {
        throw new Error("Library setup response was incomplete.");
      }

      writeStoredLibraryBinding({
        libraryId: resolvedLibraryId,
        libraryAccessKey: resolvedAccessKey,
      });

      const libraryName = typeof libraryRecord?.library_name === "string" ? libraryRecord.library_name : null;

      setConnectedMessage(libraryName ? `Connected to ${libraryName}` : "Device connected.");
      navigate("/scan", { replace: true });
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.trim() ? error.message : "Unable to connect device.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#030712] px-6 py-10 text-white"
      style={{ fontFamily: "'Sora', system-ui, sans-serif" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_30%),linear-gradient(180deg,#020617_0%,#08111f_48%,#030712_100%)]" />
      <div className="absolute left-[-10%] top-[12%] h-72 w-72 rounded-full bg-cyan-400/12 blur-[120px]" />
      <div className="absolute right-[-8%] bottom-[10%] h-80 w-80 rounded-full bg-emerald-400/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_20%,rgba(255,255,255,0.02)_100%)] opacity-50" />

      <motion.div
        className="relative z-10 w-full max-w-2xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <Card className="overflow-hidden border border-white/10 bg-white/[0.05] shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <CardContent className="relative p-6 sm:p-8 lg:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_24%)]" />
            <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/90">
                  <Wrench className="h-4 w-4" />
                  Kiosk Setup
                </div>

                <div className="space-y-4">
                  <h1 className="text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl">Setup Your Device</h1>
                  <p className="max-w-xl text-base leading-7 text-slate-300/82 sm:text-lg">
                    Enter the Library Access Key once, connect the kiosk, and the scanner will stay locked to that library
                    until you reset it.
                  </p>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                  {setupNotice ? (
                    <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
                      {setupNotice}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-200/90" htmlFor="library-access-key">
                      Enter Library Access Key
                    </label>
                    <Input
                      ref={inputRef}
                      id="library-access-key"
                      value={libraryId}
                      onChange={(event) => setLibraryId(normalizeLibraryAccessKey(event.target.value))}
                      placeholder="LIB-8X29KQ"
                      disabled={isSubmitting}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="h-14 rounded-2xl border-white/12 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/35 focus-visible:ring-cyan-300/40"
                    />
                  </div>

                  {errorMessage ? (
                    <div className="rounded-2xl border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-50">
                      {errorMessage}
                    </div>
                  ) : null}

                  {connectedMessage ? (
                    <div className="rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
                      {connectedMessage}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className={cn(
                      "h-14 w-full rounded-2xl text-base font-semibold tracking-[-0.02em] shadow-[0_18px_50px_rgba(34,211,238,0.18)]",
                      "bg-[linear-gradient(135deg,#06b6d4,#10b981)] text-slate-950 hover:opacity-95",
                    )}
                  >
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <QrCode className="h-5 w-5" />}
                    {isSubmitting ? "Connecting..." : "Connect Device"}
                  </Button>
                </form>

                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  <span>Device ID {DEVICE_ID}</span>
                </div>
              </div>

              <div className="relative flex justify-center">
                <div className="pointer-events-none absolute inset-0 rounded-[2.25rem] bg-[radial-gradient(circle_at_50%_35%,rgba(34,211,238,0.18),transparent_44%),radial-gradient(circle_at_50%_70%,rgba(16,185,129,0.18),transparent_38%)] blur-2xl" />
                <motion.div
                  className="relative flex h-[19rem] w-full max-w-sm items-center justify-center rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(4,12,28,0.84),rgba(5,12,24,0.95))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)]"
                  animate={{ scale: [1, 1.02, 1], boxShadow: ["0 30px 90px rgba(0,0,0,0.35)", "0 30px 110px rgba(34,211,238,0.16)", "0 30px 90px rgba(0,0,0,0.35)"] }}
                  transition={{ duration: 3.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                >
                  <div className="absolute inset-0 rounded-[2rem] bg-[linear-gradient(145deg,rgba(255,255,255,0.08),transparent_30%,rgba(255,255,255,0.02)_100%)]" />
                  <div className="relative flex flex-col items-center gap-4 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-cyan-300/18 bg-cyan-300/10 shadow-[0_0_45px_rgba(34,211,238,0.18)]">
                      <Sparkles className="h-9 w-9 text-cyan-100" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-100/70">Dedicated Scanner</p>
                      <p className="max-w-[16rem] text-base leading-7 text-slate-300/82">
                        Once connected, the kiosk skips setup and goes straight into scanning mode.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-white/65">
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      Fast lock-in
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
};

export default SetupDevicePage;
