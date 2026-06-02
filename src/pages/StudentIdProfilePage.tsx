import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, XCircle } from "lucide-react";
import { format } from "date-fns";

import StudentIdCard from "@/components/dashboard/StudentIdCard";
import { buildStudentQrValue, parseStudentQrPayload } from "@/lib/deviceKiosk";
import { getEffectiveStudentStatus } from "@/lib/studentMembership";
import { shouldUseSignedStudentQrToken } from "@/lib/studentQr";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { fetchSignedStudentQrTokensSafe } from "@/api/studentQr";
import { cn } from "@/lib/utils";

type StudentIdProfilePayload = {
  success: boolean;
  error?: string | null;
  data?: {
    id: string | null;
    expiry_date: string | null;
    library_logo_url: string | null;
    library_id: string | null;
    library_name: string | null;
    library_primary_color: string | null;
    plan: string | null;
    photo_thumbnail_path: string | null;
    photo_version: number | null;
    qr_code: string | null;
    seat_number: string | null;
    slot_label: string | null;
    status: string | null;
    student_name: string | null;
    photo_url: string | null;
  } | null;
};

const formatStatusLabel = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Inactive";

const STUDENT_QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const STUDENT_ID_DEBUG_ENABLED =
  import.meta.env.DEV || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cardDebug"));

const logStudentIdDebug = (stage: string, details: Record<string, unknown>) => {
  if (!STUDENT_ID_DEBUG_ENABLED) {
    return;
  }

  console.info("[student-id-verification]", {
    stage,
    ...details,
  });
};

const StudentIdProfilePage = () => {
  const { qr } = useParams<{ qr: string }>();

  const routeQrQuery = useQuery({
    queryKey: ["student-id-route-qr", qr],
    queryFn: async () => {
      if (!qr) throw new Error("Invalid ID.");

      logStudentIdDebug("SCAN_RECEIVED", {
        rawLength: qr.length,
        rawPreview: qr.slice(0, 24),
      });

      const parsedRoute = await parseStudentQrPayload(qr, {
        allowLegacy: true,
        allowExpired: true,
        publicKeyPem: STUDENT_QR_PUBLIC_KEY,
        now: new Date(),
      });

      logStudentIdDebug("CARD_PARSED", {
        code: !parsedRoute?.valid && parsedRoute && "code" in parsedRoute ? parsedRoute.code : null,
        libraryId: parsedRoute && parsedRoute.valid && "libraryId" in parsedRoute ? parsedRoute.libraryId : null,
        message: !parsedRoute?.valid && parsedRoute && "message" in parsedRoute ? parsedRoute.message : null,
        source: parsedRoute?.source ?? "unknown",
        studentId: parsedRoute && parsedRoute.valid && "studentId" in parsedRoute ? parsedRoute.studentId : null,
        valid: Boolean(parsedRoute?.valid),
      });

      return parsedRoute;
    },
    enabled: !!qr,
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: [
      "student-id-profile",
      qr,
      routeQrQuery.data?.valid ? routeQrQuery.data.source : "unknown",
      routeQrQuery.data?.valid && routeQrQuery.data.source === "signed" ? routeQrQuery.data.studentId : null,
    ],
    queryFn: async () => {
      if (!qr) throw new Error("Invalid ID.");

      const parsedRoute = routeQrQuery.data;
      if (parsedRoute && !parsedRoute.valid) {
        throw new Error(parsedRoute.message || "Invalid ID.");
      }

      const rpcArgs =
        parsedRoute?.valid && parsedRoute.source === "signed"
          ? ({
              p_student_id: parsedRoute.studentId,
              p_library_id: parsedRoute.libraryId,
            } as never)
          : parsedRoute?.valid && parsedRoute.source === "legacy"
            ? ({
                p_qr_code: parsedRoute.qrCode,
              } as never)
          : ({ p_qr_code: qr } as never);

      logStudentIdDebug("VERIFY_REQUEST_SENT", {
        rpcArgKeys: Object.keys(rpcArgs as Record<string, unknown>),
        routeSource: parsedRoute?.valid ? parsedRoute.source : "unknown",
      });

      const { data, error } = await supabase.rpc("get_student_id_profile" as never, rpcArgs);

      logStudentIdDebug("VERIFY_REQUEST_RECEIVED", {
        hasError: Boolean(error),
        payloadHasData: Boolean(data),
      });

      if (error) throw error;
      const payload = data as StudentIdProfilePayload;
      if (!payload?.success || !payload.data) {
        logStudentIdDebug("VERIFICATION_RESULT", {
          outcome: "denied",
          payloadError: payload?.error ?? null,
        });
        throw new Error(payload?.error || "Invalid or expired student ID.");
      }

      logStudentIdDebug("VERIFICATION_RESULT", {
        outcome: "approved",
        studentId: payload.data.id,
        status: payload.data.status,
      });

      return payload.data;
    },
    enabled: !!qr && !routeQrQuery.isLoading,
    staleTime: 30_000,
  });

  const profile = profileQuery.data;
  const signedQrQuery = useQuery({
    queryKey: [
      "student-id-profile-qr",
      profile?.id,
      profile?.library_id,
      profile?.status,
      profile?.expiry_date,
      qr,
      routeQrQuery.data?.valid ? routeQrQuery.data.source : "unknown",
    ],
    queryFn: async () => {
      if (!profile?.id || !profile.library_id) {
        throw new Error("Student ID is unavailable.");
      }

      if (!shouldUseSignedStudentQrToken(profile)) {
        return buildStudentQrValue({
          qrCode: profile.qr_code ?? profile.id,
          libraryId: profile.library_id,
          origin: window.location.origin,
        });
      }

      const parsedRoute = routeQrQuery.data;
      if (parsedRoute?.valid && parsedRoute.source === "signed") {
        return buildStudentQrValue({
          signedToken: qr ?? "",
          libraryId: profile.library_id,
          origin: window.location.origin,
        });
      }

      const tokenMap = await fetchSignedStudentQrTokensSafe({
        libraryId: profile.library_id,
        studentIds: [profile.id],
      });

      return buildStudentQrValue({
        signedToken: tokenMap[profile.id] ?? null,
        qrCode: profile.qr_code ?? profile.id,
        libraryId: profile.library_id,
        origin: window.location.origin,
      });
    },
    enabled: !!profile?.id && !!profile?.library_id,
    staleTime: 30_000,
  });

  const photoUrl = useMemo(() => {
    if (!profile) return null;
    if (profile.photo_thumbnail_path) {
      const { data } = supabase.storage.from("student-photos").getPublicUrl(profile.photo_thumbnail_path);
      return profile.photo_version ? `${data.publicUrl}?v=${profile.photo_version}` : data.publicUrl;
    }
    if (profile.photo_url) {
      return profile.photo_version ? `${profile.photo_url}?v=${profile.photo_version}` : profile.photo_url;
    }
    return null;
  }, [profile]);

  const expiryLabel = useMemo(() => {
    if (!profile?.expiry_date) return "--";
    return format(new Date(profile.expiry_date), "dd MMM yyyy");
  }, [profile?.expiry_date]);

  const status = useMemo(() => {
    if (!profile) return "expired";
    return getEffectiveStudentStatus(profile);
  }, [profile]);
  const isActive = status === "active";
  const statusLabel = formatStatusLabel(status);
  const qrValue = signedQrQuery.data ?? null;

  let content = null;

  if (profileQuery.isLoading || routeQrQuery.isLoading || signedQrQuery.isLoading) {
    content = (
      <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6 py-10">
        <div className="w-full rounded-[32px] border border-white/10 bg-white/[0.05] p-8 text-center shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
            <Loader2 className="h-7 w-7 animate-spin text-sky-300" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
            Verifying digital identity
          </h1>
          <p className="mt-2 text-sm text-slate-300/80">Secure student profile details are loading now.</p>
        </div>
      </div>
    );
  } else if (profileQuery.isError || !profile) {
    content = (
      <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6 py-10">
        <div className="w-full rounded-[32px] border border-white/10 bg-white/[0.05] p-8 text-center shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-300/20 bg-rose-400/10">
            <XCircle className="h-7 w-7 text-rose-300" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
            Unable to verify student
          </h1>
          <p className="mt-2 text-sm text-slate-300/80">{getSafeErrorMessage(profileQuery.error)}</p>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.05] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              Smart Student ID Verification
            </div>

            <h1 className="mt-6 text-4xl font-bold leading-tight text-white sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
              Premium digital identity, instantly verified.
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300/85">
              This secure profile confirms {profile.student_name || "the student"} as a verified member of{" "}
              {profile.library_name || "the library"}, with live ID-backed access details and current validity status.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">Status</p>
                <p
                  className={cn("mt-2 text-xl font-semibold", isActive ? "text-emerald-300" : "text-rose-300")}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {statusLabel}
                </p>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">Seat</p>
                <p className="mt-2 text-xl font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>
                  {profile.seat_number || "--"}
                </p>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">Valid Till</p>
                <p className="mt-2 text-xl font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>
                  {expiryLabel}
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-[28px] border border-white/10 bg-slate-950/40 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">Identity Integrity</p>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300/80">
                The code on this card carries a secure signed pass, so scanners can verify the latest status, plan, seat, and access
                window against the live library record.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="relative">
              <div className="pointer-events-none absolute inset-0 scale-110 rounded-full bg-emerald-400/15 blur-[120px]" />
              <div className="pointer-events-none absolute inset-0 scale-125 rounded-full bg-sky-400/10 blur-[140px]" />

              <div className="relative rounded-[34px] border border-white/10 bg-white/[0.05] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[linear-gradient(140deg,rgba(255,255,255,0.16),transparent_34%)]" />

                <StudentIdCard
                  studentName={profile.student_name || "Student"}
                  libraryName={profile.library_name || "Library"}
                  libraryLogoUrl={profile.library_logo_url}
                  brandColor={profile.library_primary_color}
                  qrValue={
                    qrValue ??
                    buildStudentQrValue({
                      qrCode: qr ?? "",
                      libraryId: profile.library_id,
                      origin: window.location.origin,
                    })
                  }
                  seatNumber={profile.seat_number}
                  plan={profile.plan}
                  timeSlot={profile.slot_label}
                  expiryLabel={expiryLabel}
                  status={status}
                  photoUrl={photoUrl}
                  showVerifiedBadge
                  showWatermark
                  showLanyard
                  variant="digital"
                  className="max-w-[420px]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020617]">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#020617_0%,#0f172a_35%,#1e293b_70%,#0ea5e9_160%)]" />
      <div className="pointer-events-none absolute left-[8%] top-[10%] h-72 w-72 rounded-full bg-emerald-400/16 blur-[120px]" />
      <div className="pointer-events-none absolute right-[6%] top-[8%] h-[26rem] w-[26rem] rounded-full bg-sky-400/14 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-10%] left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[160px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_36%)]" />
      <div className="relative">{content}</div>
    </div>
  );
};

export default StudentIdProfilePage;
