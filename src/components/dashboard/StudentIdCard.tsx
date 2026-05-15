/**
 * Libriofy Student ID Card — Flip Card with Front/Back
 * 
 * Front: Student identity (no QR)
 * Back: Large scannable QR code
 * Click to flip with 3D animation.
 */
import { forwardRef, memo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
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

const getInitials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";

const getStatusConfig = (status: string) => {
  switch (status.toLowerCase()) {
    case "active":
      return { label: "Active", color: "#34d399", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.25)", ring: "rgba(16,185,129,0.5)" };
    case "expired":
      return { label: "Expired", color: "#f87171", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)", ring: "rgba(239,68,68,0.4)" };
    case "waiting":
      return { label: "Waiting", color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.2)", ring: "rgba(251,191,36,0.4)" };
    default:
      return { label: "Inactive", color: "#94a3b8", bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.2)", ring: "rgba(148,163,184,0.3)" };
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
      className,
    },
    ref,
  ) => {
    const [flipped, setFlipped] = useState(false);
    const cfg = getStatusConfig(status);
    const active = status.toLowerCase() === "active";

    return (
      <div
        ref={ref}
        className={cn("cursor-pointer select-none", className)}
        style={{ perspective: "1200px", width: "100%", maxWidth: "540px" }}
        onClick={() => setFlipped(f => !f)}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingBottom: "63%", /* CR80 ratio */
            transition: "transform 0.6s cubic-bezier(0.4, 0.0, 0.2, 1)",
            transformStyle: "preserve-3d",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* ═══ FRONT SIDE ═══ */}
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: "16px", overflow: "hidden",
              backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
              background: "linear-gradient(135deg, #0c3547 0%, #0a2d42 20%, #0f2a3d 45%, #122a3a 70%, #0d2235 100%)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(20,184,166,0.12), 0 0 80px rgba(13,148,136,0.08)",
              fontFamily: "'Inter', system-ui, sans-serif", color: "#fff",
              display: "flex", flexDirection: "column",
            }}
          >
            {/* Ambient glow — strong teal from left */}
            <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 0% 50%, rgba(20,184,166,${active ? 0.25 : 0.08}), transparent 60%)`, pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 100% 0%, rgba(6,95,130,0.15), transparent 50%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 100%, rgba(8,60,90,0.12), transparent 40%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 0, left: "5%", right: "5%", height: "1px", background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.5), transparent)" }} />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #14b8a6, #0d9488)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 800 }}>L</div>
                <div>
                  <div style={{ fontSize: "6px", fontWeight: 700, letterSpacing: "0.18em", color: "rgba(255,255,255,0.35)" }}>LIBRIOFY</div>
                  <div style={{ fontSize: "9px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{libraryName}</div>
                </div>
              </div>
              <div style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "7px", fontWeight: 700, letterSpacing: "0.06em", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                ● {cfg.label}
              </div>
            </div>

            {/* Content */}
            <div style={{ display: "flex", alignItems: "center", padding: "14px 20px 0", gap: "16px", flex: 1 }}>
              {/* Photo */}
              <div style={{
                width: "68px", height: "68px", borderRadius: "50%", flexShrink: 0,
                border: `2.5px solid ${cfg.ring}`,
                boxShadow: `0 0 18px ${cfg.ring}, 0 0 40px ${cfg.ring}30`,
                overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(135deg, #1a4a5e, #0f3348)",
              }}>
                {photoUrl ? (
                  <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "24px", fontWeight: 700, color: `${cfg.color}80` }}>{getInitials(studentName)}</span>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#fff", letterSpacing: "-0.01em", marginBottom: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {studentName}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                  {[
                    { label: "SEAT", value: seatNumber || "—" },
                    { label: "PLAN", value: plan || "—" },
                    { label: "TIME SLOT", value: timeSlot || "—" },
                    { label: "VALID TILL", value: expiryLabel || "—", highlight: true },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: "6px", fontWeight: 600, letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: "1px" }}>{item.label}</div>
                      <div style={{ fontSize: "10px", fontWeight: 600, color: item.highlight ? cfg.color : "rgba(255,255,255,0.8)" }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "0 20px 12px", marginTop: "auto" }}>
              <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.3), rgba(20,184,166,0.2), rgba(34,211,238,0.3), transparent)", marginBottom: "8px" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7px", color: "rgba(255,255,255,0.2)" }}>
                <span>Tap to flip → QR</span>
                <span>Powered by Libriofy</span>
              </div>
            </div>
          </div>

          {/* ═══ BACK SIDE ═══ */}
          <div
            style={{
              position: "absolute", inset: 0, borderRadius: "16px", overflow: "hidden",
              backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              background: "linear-gradient(180deg, #0a2e42 0%, #0c2838 50%, #092535 100%)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(20,184,166,0.1)",
              fontFamily: "'Inter', system-ui, sans-serif", color: "#fff",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}
          >
            {/* Header */}
            <div style={{ position: "absolute", top: "10px", textAlign: "center" }}>
              <div style={{ fontSize: "6px", fontWeight: 700, letterSpacing: "0.2em", color: "rgba(34,211,238,0.5)" }}>LIBRIOFY SMART ENTRY</div>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", color: "rgba(255,255,255,0.85)", marginTop: "2px" }}>SCAN FOR ATTENDANCE</div>
            </div>

            {/* QR Code — LARGE */}
            <div style={{ padding: "12px", borderRadius: "10px", background: "#ffffff", boxShadow: "0 6px 20px rgba(0,0,0,0.4)" }}>
              <QRCodeSVG value={qrValue} size={180} level="H" bgColor="#ffffff" fgColor="#000000" />
            </div>

            {/* Scan hint */}
            <div style={{ marginTop: "6px", fontSize: "7px", color: "rgba(255,255,255,0.3)" }}>📱 6–10 inches · Good lighting</div>

            {/* Footer */}
            <div style={{ position: "absolute", bottom: "8px", left: "16px", right: "16px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: "9px", fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{studentName}</div>
                <div style={{ fontSize: "6px", color: "rgba(255,255,255,0.3)", marginTop: "1px" }}>{libraryName}</div>
              </div>
              <div style={{ fontSize: "6px", color: "rgba(255,255,255,0.2)" }}>Tap to flip back</div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

StudentIdCard.displayName = "StudentIdCard";

export default memo(StudentIdCard);
