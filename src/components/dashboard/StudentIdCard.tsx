import { forwardRef, memo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StudentIdCardProps = {
  studentName: string;
  libraryName: string;
  qrValue: string;
  seatNumber?: string | null;
  plan?: string | null;
  timeSlot?: string | null;
  expiryLabel?: string | null;
  status: "active" | "expired" | "inactive" | "waiting" | string;
  photoUrl?: string | null;
  libraryLogoUrl?: string | null;
  brandColor?: string | null;
  showVerifiedBadge?: boolean;
  showWatermark?: boolean;
  showLanyard?: boolean;
  variant?: "digital" | "print";
  className?: string;
};

const defaultBrand = "#0ea5e9";
const resolveQrErrorLevel = (value: string) => {
  const normalized = value.trim();

  if (normalized.length > 280) {
    return "L" as const;
  }

  if (normalized.length > 140) {
    return "M" as const;
  }

  return "H" as const;
};

const formatStatusLabel = (value: string) =>
  value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Inactive";

const getStatusStyles = (status: string) => {
  switch (status.toLowerCase()) {
    case "active":
      return {
        label: "Active",
        badgeClassName: "border-emerald-300/20 bg-emerald-400/15 text-emerald-300 shadow-[0_0_24px_rgba(34,197,94,0.24)]",
        photoGlowClassName: "bg-emerald-400/25",
        photoRingClassName: "border-emerald-400/80 shadow-[0_0_20px_rgba(34,197,94,0.55),0_0_40px_rgba(34,197,94,0.22)]",
        qrGlowClassName: "bg-emerald-400/18",
      };
    case "waiting":
      return {
        label: "Waiting",
        badgeClassName: "border-amber-300/20 bg-amber-400/15 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.2)]",
        photoGlowClassName: "bg-amber-300/24",
        photoRingClassName: "border-amber-300/80 shadow-[0_0_20px_rgba(251,191,36,0.42),0_0_40px_rgba(251,191,36,0.16)]",
        qrGlowClassName: "bg-amber-300/18",
      };
    case "inactive":
      return {
        label: "Inactive",
        badgeClassName: "border-slate-300/20 bg-slate-200/10 text-slate-200 shadow-[0_0_24px_rgba(148,163,184,0.16)]",
        photoGlowClassName: "bg-slate-200/18",
        photoRingClassName: "border-slate-200/70 shadow-[0_0_20px_rgba(148,163,184,0.3),0_0_40px_rgba(148,163,184,0.14)]",
        qrGlowClassName: "bg-slate-200/14",
      };
    case "expired":
      return {
        label: "Expired",
        badgeClassName: "border-rose-300/20 bg-rose-400/15 text-rose-200 shadow-[0_0_24px_rgba(251,113,133,0.22)]",
        photoGlowClassName: "bg-rose-300/22",
        photoRingClassName: "border-rose-300/80 shadow-[0_0_20px_rgba(251,113,133,0.4),0_0_40px_rgba(251,113,133,0.16)]",
        qrGlowClassName: "bg-rose-300/18",
      };
    default:
      return {
        label: formatStatusLabel(status),
        badgeClassName: "border-slate-300/20 bg-slate-200/10 text-slate-200 shadow-[0_0_24px_rgba(148,163,184,0.16)]",
        photoGlowClassName: "bg-slate-200/18",
        photoRingClassName: "border-slate-200/70 shadow-[0_0_20px_rgba(148,163,184,0.3),0_0_40px_rgba(148,163,184,0.14)]",
        qrGlowClassName: "bg-slate-200/14",
      };
  }
};

const StudentIdCard = forwardRef<HTMLDivElement, StudentIdCardProps>(
  (
    {
      studentName,
      libraryName,
      qrValue,
      seatNumber,
      plan,
      timeSlot,
      expiryLabel,
      status,
      photoUrl,
      libraryLogoUrl,
      brandColor,
      showVerifiedBadge,
      showWatermark,
      showLanyard,
      variant = "digital",
      className,
    },
    ref,
  ) => {
    const statusStyles = getStatusStyles(status);
    const initials =
      studentName
        ?.split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "ST";
    const libraryInitials =
      libraryName
        ?.split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "LB";
    const accent = brandColor || defaultBrand;
    const qrErrorLevel = resolveQrErrorLevel(qrValue);
    const qrSize = qrErrorLevel === "H" ? 60 : qrErrorLevel === "M" ? 72 : 78;

    return (
      <div
        ref={ref}
        data-student-id-card
        className={cn(
          "relative isolate w-full max-w-[380px] overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.05] text-white backdrop-blur-[16px]",
          variant === "digital"
            ? "shadow-[0_30px_80px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-20px_50px_rgba(2,8,23,0.16)]"
            : "shadow-[0_18px_44px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-14px_36px_rgba(2,8,23,0.12)]",
          "aspect-[85.6/54] p-4",
          className,
        )}
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(34,197,94,0.16), transparent 40%), radial-gradient(circle at 84% 14%, rgba(14,165,233,0.2), transparent 34%), linear-gradient(135deg, #0f172a 0%, #1e293b 58%, #0ea5e9 140%)",
          fontFamily: "var(--font-body)",
        }}
      >
        {showLanyard ? (
          <div className="pointer-events-none absolute -top-8 left-1/2 h-14 w-14 -translate-x-1/2 rounded-full border border-white/15 bg-white/[0.08] shadow-[0_12px_32px_rgba(15,23,42,0.38)] backdrop-blur-md">
            <div className="absolute inset-2 rounded-full border border-white/20 bg-white/[0.06]" />
            <div className="absolute left-1/2 top-[52px] h-7 w-px -translate-x-1/2 bg-gradient-to-b from-white/60 to-transparent" />
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-white/[0.04] backdrop-blur-[16px]" />
        <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[linear-gradient(120deg,rgba(255,255,255,0.15),rgba(255,255,255,0.06)_24%,transparent_45%)]" />
        <div className="pointer-events-none absolute inset-[1px] rounded-[23px] border border-white/10" />
        <div className="pointer-events-none absolute -right-14 top-3 h-32 w-32 rounded-full blur-[72px]" style={{ backgroundColor: accent, opacity: 0.18 }} />
        <div className={cn("pointer-events-none absolute left-5 top-[84px] h-20 w-20 rounded-full blur-[44px]", statusStyles.photoGlowClassName)} />
        <div className="pointer-events-none absolute inset-x-10 top-0 h-20 rounded-full bg-white/10 blur-3xl opacity-35" />

        {showWatermark && libraryLogoUrl ? (
          <img
            src={libraryLogoUrl}
            alt=""
            className="pointer-events-none absolute right-[-14%] top-[18%] w-[178px] opacity-[0.06] mix-blend-screen"
          />
        ) : null}

        <div className="relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)] gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border border-white/15 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_28px_rgba(2,8,23,0.2)] backdrop-blur-md">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 via-transparent to-transparent" />
                {libraryLogoUrl ? (
                  <img src={libraryLogoUrl} alt={libraryName} className="relative h-7 w-7 rounded-xl object-cover" />
                ) : (
                  <span className="relative text-xs font-semibold tracking-[0.22em] text-white/90">{libraryInitials}</span>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/60">Library</p>
                <p className="truncate text-[15px] font-semibold text-white">{libraryName}</p>
              </div>
            </div>

            <Badge
              className={cn(
                "h-auto shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[1px] backdrop-blur-md",
                statusStyles.badgeClassName,
              )}
            >
              {statusStyles.label}
            </Badge>
          </div>

          <div className="grid min-h-0 grid-cols-[64px_minmax(0,1fr)_90px] gap-3">
            <div className="relative flex items-start justify-center pt-1">
              <div className={cn("absolute inset-1 rounded-full blur-2xl", statusStyles.photoGlowClassName)} />
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={studentName}
                  className={cn("relative h-[64px] w-[64px] rounded-full border-2 object-cover", statusStyles.photoRingClassName)}
                />
              ) : (
                <div
                  className={cn(
                    "relative flex h-[64px] w-[64px] items-center justify-center rounded-full border-2 bg-slate-950/35 text-[18px] font-bold text-white/95 backdrop-blur-md",
                    statusStyles.photoRingClassName,
                  )}
                >
                  {initials}
                </div>
              )}
            </div>

            <div className="min-w-0 py-0.5">
              <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/58">Student Name</p>
              <p className="mt-1.5 truncate text-[18px] font-bold leading-[1.08] tracking-[0.2px] text-white">
                {studentName}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/68">Seat</p>
                  <p className="mt-0.5 truncate text-[13px] font-semibold leading-tight text-white">{seatNumber || "--"}</p>
                </div>

                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/68">Plan</p>
                  <p className="mt-0.5 truncate text-[13px] font-semibold leading-tight text-white">{plan || "--"}</p>
                </div>

                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/68">Time Slot</p>
                  <p
                    className="mt-0.5 overflow-hidden text-[12px] font-semibold leading-[1.15] text-white"
                    style={{
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                    }}
                    title={timeSlot || "--"}
                  >
                    {timeSlot || "--"}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[1px] text-white/68">Valid Till</p>
                  <p className="mt-0.5 text-[12px] font-semibold leading-[1.15] text-white">{expiryLabel || "--"}</p>
                </div>
              </div>
            </div>

            <div className="flex items-end justify-end">
              <div className="relative">
                <div className={cn("pointer-events-none absolute inset-[-8px] rounded-[16px] blur-lg", statusStyles.qrGlowClassName)} />
                <div
                  className={cn(
                    "qr-container relative overflow-hidden rounded-[12px] border border-white/25 bg-white/[0.16] p-1.5 shadow-[0_16px_32px_rgba(2,8,23,0.22)]",
                    variant === "digital" ? "backdrop-blur-xl backdrop-brightness-150" : "bg-white/[0.18]",
                  )}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-[12px] bg-[linear-gradient(145deg,rgba(255,255,255,0.18),rgba(255,255,255,0.06))]" />
                  <div className="pointer-events-none absolute inset-[5px] rounded-[8px] bg-white/92" />
                  <div className="pointer-events-none absolute inset-[1px] rounded-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-10px_20px_rgba(2,8,23,0.08)]" />
                  <div
                    className="qr-img relative flex items-center justify-center"
                    style={{ width: qrSize, height: qrSize }}
                  >
                    <QRCodeSVG
                      value={qrValue}
                      size={qrSize}
                      level={qrErrorLevel}
                      includeMargin={false}
                      bgColor="transparent"
                      fgColor="#000000"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-4 bottom-2 h-px rounded-full opacity-45"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${accent} 50%, transparent 100%)` }}
        />
      </div>
    );
  },
);

StudentIdCard.displayName = "StudentIdCard";

export default memo(StudentIdCard);
