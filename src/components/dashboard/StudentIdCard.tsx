/**
 * Libriofy Student ID Card
 *
 * Keeps the existing flip-card layout and CR80 ratio while adding
 * richer depth, readability, and premium visual polish.
 */
import { forwardRef, memo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { RotateCw, ScanLine, ShieldCheck } from "lucide-react";
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

const CARD_ANIMATIONS = `
  @keyframes libriofyHintPulse {
    0%, 100% { box-shadow: 0 0 0 rgba(34, 211, 238, 0.0), inset 0 1px 0 rgba(255,255,255,0.10); }
    50% { box-shadow: 0 0 14px rgba(34, 211, 238, 0.12), 0 0 22px rgba(20, 184, 166, 0.08), inset 0 1px 0 rgba(255,255,255,0.14); }
  }

  @keyframes libriofyHintTurn {
    0%, 100% { transform: rotate(0deg); }
    50% { transform: rotate(14deg); }
  }

  @keyframes libriofyHaloBreathe {
    0%, 100% { opacity: 0.28; transform: scale(0.985); }
    50% { opacity: 0.52; transform: scale(1.018); }
  }

  @keyframes libriofyEdgeSweep {
    0% { transform: translate3d(-38%, 0, 0); opacity: 0; }
    18% { opacity: 0.18; }
    50% { opacity: 0.28; }
    82% { opacity: 0.1; }
    100% { transform: translate3d(38%, 0, 0); opacity: 0; }
  }

  @keyframes libriofyScanPulse {
    0%, 100% { opacity: 0.16; transform: scale(0.98); }
    50% { opacity: 0.34; transform: scale(1.018); }
  }
`;

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const getStatusConfig = (status: string) => {
  switch (status.toLowerCase()) {
    case "active":
      return {
        label: "ACTIVE",
        color: "#d4fff8",
        bg: "rgba(9, 100, 95, 0.26)",
        border: "rgba(126, 243, 225, 0.3)",
        ring: "rgba(126, 243, 225, 0.28)",
        glow: "rgba(45, 212, 191, 0.22)",
        textGlow: "rgba(45, 212, 191, 0.24)",
      };
    case "expired":
      return {
        label: "EXPIRED",
        color: "#f2cbc5",
        bg: "rgba(118, 54, 54, 0.2)",
        border: "rgba(231, 173, 164, 0.22)",
        ring: "rgba(231, 173, 164, 0.18)",
        glow: "rgba(175, 92, 86, 0.12)",
        textGlow: "rgba(182, 100, 92, 0.14)",
      };
    case "waiting":
      return {
        label: "WAITING",
        color: "#fcd34d",
        bg: "rgba(146, 64, 14, 0.2)",
        border: "rgba(252, 211, 77, 0.28)",
        ring: "rgba(251, 191, 36, 0.32)",
        glow: "rgba(251, 191, 36, 0.18)",
        textGlow: "rgba(251, 191, 36, 0.24)",
      };
    default:
      return {
        label: "INACTIVE",
        color: "#cbd5e1",
        bg: "rgba(71, 85, 105, 0.22)",
        border: "rgba(148, 163, 184, 0.24)",
        ring: "rgba(148, 163, 184, 0.28)",
        glow: "rgba(148, 163, 184, 0.18)",
        textGlow: "rgba(148, 163, 184, 0.2)",
      };
  }
};

const WatermarkGraphic = ({
  style,
  opacity,
}: {
  style?: CSSProperties;
  opacity: number;
}) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 320 220"
    style={{
      position: "absolute",
      pointerEvents: "none",
      opacity,
      ...style,
    }}
  >
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M52 44c18-13 40-20 67-20 23 0 43 5 61 14 20-9 41-14 66-14 25 0 47 7 67 21"
        stroke="rgba(186, 230, 253, 0.18)"
        strokeWidth="1.2"
      />
      <path
        d="M78 74c15-10 33-15 54-15 18 0 33 4 48 11 14-7 30-11 49-11 22 0 40 5 54 15"
        stroke="rgba(125, 211, 252, 0.16)"
        strokeWidth="1.2"
      />
      <path
        d="M90 86v68c15-10 31-15 49-15 18 0 32 5 46 14V86c-14-9-29-13-46-13-18 0-34 4-49 13Z"
        stroke="rgba(167, 243, 208, 0.18)"
        strokeWidth="1.6"
      />
      <path
        d="M185 86v68c15-9 30-14 48-14 19 0 36 5 51 15V86c-15-9-32-13-51-13-17 0-33 4-48 13Z"
        stroke="rgba(125, 211, 252, 0.16)"
        strokeWidth="1.6"
      />
      <path d="M185 92c12-7 25-10 40-10" stroke="rgba(186, 230, 253, 0.15)" strokeWidth="1.1" />
      <path d="M97 92c12-7 25-10 40-10" stroke="rgba(186, 230, 253, 0.15)" strokeWidth="1.1" />
      <path d="M160 70v92" stroke="rgba(224, 242, 254, 0.16)" strokeWidth="1.1" />
      <path d="M119 110h26" stroke="rgba(103, 232, 249, 0.16)" strokeWidth="1" />
      <path d="M177 110h26" stroke="rgba(103, 232, 249, 0.16)" strokeWidth="1" />
      <path d="M118 126h18" stroke="rgba(125, 211, 252, 0.14)" strokeWidth="1" />
      <path d="M184 126h18" stroke="rgba(125, 211, 252, 0.14)" strokeWidth="1" />
      <circle cx="56" cy="118" r="14" stroke="rgba(125, 211, 252, 0.12)" strokeWidth="1" />
      <circle cx="265" cy="122" r="18" stroke="rgba(94, 234, 212, 0.12)" strokeWidth="1" />
      <path d="M42 118h34" stroke="rgba(125, 211, 252, 0.12)" strokeWidth="1" />
      <path d="M247 122h36" stroke="rgba(94, 234, 212, 0.12)" strokeWidth="1" />
      <path d="M56 104v28" stroke="rgba(125, 211, 252, 0.12)" strokeWidth="1" />
      <path d="M265 104v36" stroke="rgba(94, 234, 212, 0.12)" strokeWidth="1" />
    </g>
  </svg>
);

const LanyardSlot = () => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: "6px",
      transform: "translateX(-50%)",
      width: "68px",
      height: "12px",
      borderRadius: "999px",
      background: "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))",
      border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "0 6px 14px rgba(2, 10, 24, 0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
      zIndex: 3,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "28px",
        height: "4px",
        borderRadius: "999px",
        background: "rgba(2, 10, 24, 0.55)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    />
  </div>
);

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
      showVerifiedBadge = false,
      showWatermark = false,
      showLanyard = false,
      variant = "digital",
      className,
    },
    ref,
  ) => {
    const [flipped, setFlipped] = useState(false);
    const [hovered, setHovered] = useState(false);
    const cfg = getStatusConfig(status);
    const statusKey = status.toLowerCase();
    const active = statusKey === "active";
    const expired = statusKey === "expired";
    const isInteractive = variant === "digital";
    const cardRadius = "26px";
    const cardSurfaceBackground = expired
      ? "linear-gradient(138deg, #0c2335 0%, #0a2132 18%, #0a1e2d 42%, #081826 70%, #05111c 100%)"
      : "linear-gradient(138deg, #11395a 0%, #0d3451 18%, #102d4a 42%, #0c2440 70%, #081a32 100%)";
    const cardBackBackground = expired
      ? "linear-gradient(180deg, #0d2b41 0%, #0a2437 38%, #091d2f 68%, #061522 100%)"
      : "linear-gradient(180deg, #103a58 0%, #0d3049 38%, #0b2640 68%, #071d32 100%)";
    const cardShadow = expired
      ? "0 20px 48px rgba(2, 12, 26, 0.26), 0 10px 22px rgba(5, 15, 30, 0.16), 0 0 0 1px rgba(186, 230, 253, 0.07), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -16px 30px rgba(2, 10, 24, 0.28), inset 0 0 18px rgba(148, 163, 184, 0.03)"
      : "0 22px 54px rgba(2, 12, 26, 0.3), 0 10px 24px rgba(5, 15, 30, 0.18), 0 0 0 1px rgba(186, 230, 253, 0.11), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -16px 34px rgba(2, 10, 24, 0.3), inset 0 0 24px rgba(34, 211, 238, 0.03)";
    const cardHoverShadow = expired
      ? "0 26px 56px rgba(2, 12, 26, 0.3), 0 14px 28px rgba(5, 15, 30, 0.18), 0 0 0 1px rgba(186, 230, 253, 0.08), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -16px 30px rgba(2, 10, 24, 0.28), inset 0 0 18px rgba(148, 163, 184, 0.03)"
      : "0 28px 62px rgba(2, 12, 26, 0.34), 0 14px 30px rgba(5, 15, 30, 0.2), 0 0 0 1px rgba(186, 230, 253, 0.12), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -16px 34px rgba(2, 10, 24, 0.3), inset 0 0 24px rgba(34, 211, 238, 0.04)";
    const accentLeftGlow = active
      ? "rgba(45, 212, 191, 0.24)"
      : expired
        ? "rgba(155, 124, 118, 0.08)"
        : "rgba(125, 211, 252, 0.12)";
    const accentRightGlow = expired ? "rgba(125, 211, 252, 0.08)" : "rgba(56, 189, 248, 0.14)";
    const accentBottomGlow = expired ? "rgba(100, 116, 139, 0.08)" : "rgba(8, 145, 178, 0.12)";
    const surfaceShadow = hovered && isInteractive ? cardHoverShadow : cardShadow;
    const signatureTint = brandColor ?? (expired ? "#f0c3bd" : "#6cefe0");
    const shimmerOpacity = hovered && isInteractive ? 0.45 : 0;

    const details = [
      { label: "SEAT", value: seatNumber || "--" },
      { label: "PLAN", value: plan || "--" },
      { label: "TIME SLOT", value: timeSlot || "--" },
      { label: "VALID TILL", value: expiryLabel || "--", highlight: true },
    ];

    const toggleFlip = () => setFlipped((current) => !current);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleFlip();
      }
    };

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`Flip student ID card for ${studentName}`}
        aria-pressed={flipped}
        className={cn("select-none outline-none", isInteractive ? "cursor-pointer" : "cursor-pointer", className)}
        style={{ perspective: "1400px", width: "100%", maxWidth: "540px" }}
        onClick={toggleFlip}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <style>{CARD_ANIMATIONS}</style>

        <div
          style={{
            position: "relative",
            width: "100%",
            transform: hovered && isInteractive ? "translateY(-4px) scale(1.008)" : "translateY(0) scale(1)",
            filter: hovered && isInteractive ? "saturate(1.04)" : "saturate(1)",
            transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), filter 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              paddingBottom: "63%",
              transition: "transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: cardRadius,
                overflow: "hidden",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                background: cardSurfaceBackground,
                boxShadow: surfaceShadow,
                fontFamily: "'Inter', system-ui, sans-serif",
                color: "#ffffff",
                display: "flex",
                flexDirection: "column",
                transition: "box-shadow 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {showLanyard ? <LanyardSlot /> : null}

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(150deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 18%, transparent 42%)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: "-24%",
                  background:
                    "linear-gradient(118deg, transparent 44%, rgba(255,255,255,0.08) 48%, rgba(153, 246, 228, 0.16) 50%, rgba(255,255,255,0.08) 52%, transparent 56%)",
                  opacity: shimmerOpacity,
                  animation: hovered && isInteractive ? "libriofyEdgeSweep 3.8s linear infinite" : undefined,
                  mixBlendMode: "screen",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 14% 34%, ${accentLeftGlow} 0%, transparent 34%)`,
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 88% 14%, ${accentRightGlow} 0%, transparent 28%)`,
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 58% 100%, ${accentBottomGlow} 0%, transparent 30%)`,
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "6%",
                  right: "6%",
                  top: 0,
                  height: "1px",
                  background: "linear-gradient(90deg, transparent, rgba(186, 230, 253, 0.7), rgba(94, 234, 212, 0.55), transparent)",
                  opacity: expired ? 0.58 : 0.9,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: "24px",
                  top: "42px",
                  width: "52px",
                  height: "4px",
                  borderRadius: "999px",
                  background: `linear-gradient(90deg, rgba(255,255,255,0.05), ${signatureTint}, rgba(255,255,255,0.04))`,
                  boxShadow: `0 0 14px ${cfg.glow}`,
                  opacity: hovered && isInteractive ? 0.92 : 0.68,
                  transition: "opacity 0.4s ease, transform 0.4s ease",
                  transform: hovered && isInteractive ? "translateX(-2px)" : "translateX(0)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "16px",
                  top: "12px",
                  bottom: "20px",
                  width: "1px",
                  background: "linear-gradient(180deg, rgba(186, 230, 253, 0.32), transparent 36%, transparent 72%, rgba(94, 234, 212, 0.18))",
                }}
              />

              {showWatermark ? (
                <WatermarkGraphic
                  opacity={expired ? 0.68 : 0.92}
                  style={{
                    right: "-18px",
                    bottom: "-4px",
                    width: "56%",
                    height: "78%",
                  }}
                />
              ) : null}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                  <div
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "6px",
                      background: "linear-gradient(145deg, rgba(94, 234, 212, 0.98), rgba(13, 148, 136, 0.92))",
                      border: "1px solid rgba(255,255,255,0.22)",
                      boxShadow: "0 10px 18px rgba(8, 145, 178, 0.25), inset 0 1px 0 rgba(255,255,255,0.28)",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {libraryLogoUrl ? (
                      <img src={libraryLogoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: "10px", fontWeight: 800, color: "#042f2e" }}>L</span>
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "6px",
                        fontWeight: 700,
                        letterSpacing: "0.22em",
                        color: "rgba(224, 242, 254, 0.48)",
                        textTransform: "uppercase",
                      }}
                    >
                      LIBRIOFY
                    </div>
                    <div
                      style={{
                        fontSize: "9.2px",
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.82)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {libraryName}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    fontSize: "7.1px",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    background: cfg.bg,
                    color: cfg.color,
                    border: `1px solid ${cfg.border}`,
                    boxShadow: `0 0 0 1px rgba(255,255,255,0.03), 0 8px 16px rgba(2, 10, 24, 0.16), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 16px ${cfg.glow}`,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "999px",
                      background: cfg.color,
                      boxShadow: `0 0 8px ${cfg.textGlow}`,
                      flexShrink: 0,
                    }}
                  />
                  <span>{cfg.label}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", padding: "14px 20px 0", gap: "16px", flex: 1 }}>
                <div style={{ position: "relative", width: "76px", height: "76px", flexShrink: 0 }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: "-5px",
                      borderRadius: "999px",
                      background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)`,
                      animation: active ? "libriofyHaloBreathe 3.6s ease-in-out infinite" : undefined,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "999px",
                      background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03))",
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 12px 22px rgba(2, 10, 24, 0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: "4px",
                      borderRadius: "999px",
                      border: `1.15px solid ${cfg.ring}`,
                      boxShadow: `0 0 10px ${cfg.glow}, inset 0 0 12px rgba(255,255,255,0.04)`,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "linear-gradient(145deg, rgba(17, 58, 92, 0.96), rgba(8, 30, 51, 0.98))",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(145deg, rgba(255,255,255,0.12), transparent 40%)",
                      }}
                    />
                    {photoUrl ? (
                      <img src={photoUrl} alt={studentName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span
                        style={{
                          position: "relative",
                          fontSize: "24px",
                          fontWeight: 800,
                          color: cfg.color,
                          textShadow: `0 0 12px ${cfg.textGlow}`,
                        }}
                      >
                        {getInitials(studentName)}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "13px 14px 13px",
                    borderRadius: "19px",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.018))",
                    border: "1px solid rgba(255,255,255,0.065)",
                    boxShadow: "0 10px 18px rgba(2, 10, 24, 0.07), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: "5.8px",
                          fontWeight: 700,
                          letterSpacing: "0.22em",
                          color: "rgba(186, 230, 253, 0.56)",
                          textTransform: "uppercase",
                          marginBottom: "4px",
                        }}
                      >
                        Student Access Identity
                      </div>
                      <div
                        style={{
                          fontSize: "17px",
                          fontWeight: 800,
                          color: "#f8fdff",
                          lineHeight: 1.1,
                          letterSpacing: "-0.02em",
                          textShadow: "0 6px 14px rgba(2, 10, 24, 0.28)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {studentName}
                      </div>
                    </div>

                    {showVerifiedBadge ? (
                      <div
                        title="Verified smart pass"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "18px",
                          height: "18px",
                          borderRadius: "999px",
                          background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                          border: "1px solid rgba(125, 211, 252, 0.12)",
                          color: "rgba(207, 250, 254, 0.6)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                          flexShrink: 0,
                        }}
                      >
                        <ShieldCheck size={9} strokeWidth={2.2} />
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px 12px" }}>
                    {details.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          minWidth: 0,
                          padding: item.label === "TIME SLOT" || item.label === "VALID TILL" ? "8px 10px 9px" : "7px 9px 8px",
                          borderRadius: "11px",
                          background: "linear-gradient(180deg, rgba(4, 18, 34, 0.24), rgba(255,255,255,0.018))",
                          border: "1px solid rgba(255,255,255,0.045)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "6.6px",
                            fontWeight: 700,
                            letterSpacing: "0.14em",
                            color: "rgba(224, 242, 254, 0.52)",
                            marginBottom: "4px",
                          }}
                        >
                          {item.label}
                        </div>
                        <div
                          title={item.value}
                          style={{
                            fontSize: item.label === "TIME SLOT" ? "11px" : "11.4px",
                            fontWeight: item.highlight ? 700 : 650,
                            lineHeight: 1.26,
                            color: item.highlight ? cfg.color : "rgba(248, 250, 252, 0.92)",
                            textShadow: item.highlight ? `0 0 10px ${cfg.textGlow}` : "0 4px 10px rgba(2, 10, 24, 0.2)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "0 20px 12px",
                  marginTop: "auto",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "34px",
                    right: "34px",
                    top: "-1px",
                    height: "10px",
                    borderRadius: "999px",
                    background: "linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.14), rgba(45, 212, 191, 0.1), transparent)",
                    filter: "blur(7px)",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    paddingTop: "10px",
                  }}
                >
                  <div
                    style={{
                      height: "1.2px",
                      borderRadius: "999px",
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0.02), rgba(125, 211, 252, 0.5), rgba(94, 234, 212, 0.38), rgba(125, 211, 252, 0.5), rgba(255,255,255,0.02))",
                    }}
                  />
                  <div
                    style={{
                      height: "1px",
                      marginTop: "2px",
                      borderRadius: "999px",
                      opacity: expired ? 0.12 : 0.18,
                      background:
                        "repeating-linear-gradient(90deg, rgba(186,230,253,0.28) 0 6px, transparent 6px 10px)",
                    }}
                  />
                  <div
                    style={{
                      marginTop: "7px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "4px 9px",
                        borderRadius: "999px",
                        background: hovered
                          ? "linear-gradient(180deg, rgba(34, 211, 238, 0.18), rgba(13, 148, 136, 0.1))"
                          : "linear-gradient(180deg, rgba(34, 211, 238, 0.14), rgba(13, 148, 136, 0.08))",
                        border: "1px solid rgba(125, 211, 252, 0.22)",
                        color: "rgba(248, 250, 252, 0.96)",
                        fontSize: "7.2px",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        animation: isInteractive ? "libriofyHintPulse 2.8s ease-in-out infinite" : undefined,
                        boxShadow: hovered
                          ? "0 10px 20px rgba(8, 145, 178, 0.12), inset 0 1px 0 rgba(255,255,255,0.14)"
                          : "0 8px 16px rgba(2, 10, 24, 0.14), inset 0 1px 0 rgba(255,255,255,0.1)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "15px",
                          height: "15px",
                          borderRadius: "999px",
                          background: "rgba(255,255,255,0.08)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
                        }}
                      >
                        <RotateCw
                          size={9}
                          strokeWidth={2.3}
                          style={{ animation: isInteractive ? "libriofyHintTurn 1.9s ease-in-out infinite" : undefined }}
                        />
                      </span>
                      <span>Tap to flip for QR</span>
                    </div>

                    <div
                      style={{
                        fontSize: "6.9px",
                        fontWeight: 650,
                        letterSpacing: "0.09em",
                        color: "rgba(240, 249, 255, 0.62)",
                        textTransform: "uppercase",
                        textShadow: "0 4px 10px rgba(2, 10, 24, 0.18)",
                      }}
                    >
                      Powered by Libriofy
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: cardRadius,
                overflow: "hidden",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
                background: cardBackBackground,
                boxShadow: surfaceShadow,
                fontFamily: "'Inter', system-ui, sans-serif",
                color: "#ffffff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                transition: "box-shadow 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {showLanyard ? <LanyardSlot /> : null}

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(150deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 18%, transparent 42%)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0.04,
                  backgroundImage:
                    "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.75) 1px, transparent 0), linear-gradient(90deg, rgba(125,211,252,0.16) 1px, transparent 1px), linear-gradient(rgba(125,211,252,0.12) 1px, transparent 1px)",
                  backgroundSize: "22px 22px, 44px 44px, 44px 44px",
                  backgroundPosition: "0 0, 0 0, 0 0",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(circle at 50% 48%, ${cfg.glow} 0%, transparent 34%)`,
                  opacity: expired ? 0.45 : 0.75,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "6%",
                  right: "6%",
                  top: 0,
                  height: "1px",
                  background: "linear-gradient(90deg, transparent, rgba(186, 230, 253, 0.7), rgba(94, 234, 212, 0.55), transparent)",
                  opacity: expired ? 0.56 : 1,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: "-22%",
                  background:
                    "linear-gradient(118deg, transparent 44%, rgba(255,255,255,0.06) 48%, rgba(153, 246, 228, 0.12) 50%, rgba(255,255,255,0.06) 52%, transparent 56%)",
                  opacity: shimmerOpacity * 0.82,
                  animation: hovered && isInteractive ? "libriofyEdgeSweep 4.2s linear infinite" : undefined,
                  mixBlendMode: "screen",
                  pointerEvents: "none",
                }}
              />

              {showWatermark ? (
                <WatermarkGraphic
                  opacity={expired ? 0.32 : 0.48}
                  style={{
                    left: "50%",
                    top: "52%",
                    width: "62%",
                    height: "70%",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ) : null}

              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "36px",
                  width: "56px",
                  height: "4px",
                  borderRadius: "999px",
                  transform: "translateX(-50%)",
                  background: `linear-gradient(90deg, rgba(255,255,255,0.04), ${signatureTint}, rgba(255,255,255,0.04))`,
                  boxShadow: `0 0 14px ${cfg.glow}`,
                  opacity: hovered && isInteractive ? 0.88 : 0.62,
                }}
              />

              <div style={{ position: "absolute", top: "12px", textAlign: "center", zIndex: 2 }}>
                <div
                  style={{
                    fontSize: "7.4px",
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    color: "rgba(255,255,255,0.95)",
                    textTransform: "uppercase",
                    textShadow: "0 0 1px rgba(255,255,255,0.15)",
                    textRendering: "geometricPrecision",
                    WebkitFontSmoothing: "antialiased",
                  }}
                >
                  LIBRIOFY SMART ENTRY
                </div>
                <div
                  style={{
                    fontSize: "12.2px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: "rgba(255,255,255,0.98)",
                    marginTop: "4px",
                    textRendering: "geometricPrecision",
                    WebkitFontSmoothing: "antialiased",
                  }}
                >
                  SCAN FOR ATTENDANCE
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "12px",
                  marginTop: "10px",
                  transform: "translateY(8px)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: "-10px",
                    borderRadius: "22px",
                    background: `radial-gradient(circle, ${cfg.glow} 0%, transparent 70%)`,
                    filter: "blur(14px)",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    padding: "8px",
                    borderRadius: "22px",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 16px 34px rgba(2, 10, 24, 0.28), inset 0 1px 0 rgba(255,255,255,0.16)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: "-2px",
                      borderRadius: "24px",
                      border: "1px solid rgba(125, 211, 252, 0.14)",
                      opacity: active && isInteractive ? 0.9 : 0.56,
                      animation: active && isInteractive ? "libriofyScanPulse 3.4s ease-in-out infinite" : undefined,
                    }}
                  />
                  <div
                    style={{
                      position: "relative",
                      padding: "12px",
                      borderRadius: "16px",
                      background: "linear-gradient(180deg, #fbfdff 0%, #f1f7fb 100%)",
                      boxShadow: "0 0 0 1px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.95)",
                    }}
                  >
                    <QRCodeSVG value={qrValue} size={180} level="H" bgColor="#ffffff" fgColor="#000000" />
                  </div>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "999px",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(240, 249, 255, 0.86)",
                    fontSize: "7.9px",
                    fontWeight: 700,
                    letterSpacing: "0.03em",
                    boxShadow: "0 10px 20px rgba(2, 10, 24, 0.14), inset 0 1px 0 rgba(255,255,255,0.12)",
                  }}
                >
                  <ScanLine size={10} strokeWidth={2.2} />
                  <span>6-10 inches and good lighting</span>
                </div>

                <div
                  style={{
                    fontSize: "6.9px",
                    fontWeight: 650,
                    letterSpacing: "0.06em",
                    color: "rgba(224, 242, 254, 0.7)",
                    textTransform: "uppercase",
                    textRendering: "geometricPrecision",
                    WebkitFontSmoothing: "antialiased",
                  }}
                >
                  Keep the full QR visible for fast attendance.
                </div>
              </div>

              <div
                style={{
                  position: "absolute",
                  left: "16px",
                  right: "16px",
                  bottom: "10px",
                }}
              >
                <div
                  style={{
                    height: "1px",
                    borderRadius: "999px",
                    background:
                      "linear-gradient(90deg, rgba(255,255,255,0.02), rgba(125, 211, 252, 0.46), rgba(94, 234, 212, 0.32), rgba(125, 211, 252, 0.46), rgba(255,255,255,0.02))",
                    marginBottom: "9px",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "10px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "9.8px",
                        fontWeight: 700,
                        color: "rgba(248, 250, 252, 0.9)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {studentName}
                    </div>
                    <div
                      style={{
                        fontSize: "6.8px",
                        color: "rgba(224, 242, 254, 0.5)",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginTop: "3px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {libraryName}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "3px 8px",
                      borderRadius: "999px",
                      background: "linear-gradient(180deg, rgba(34, 211, 238, 0.12), rgba(13, 148, 136, 0.06))",
                      border: "1px solid rgba(125, 211, 252, 0.16)",
                      color: "rgba(240, 249, 255, 0.8)",
                      fontSize: "6.8px",
                      fontWeight: 700,
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                    }}
                  >
                    <RotateCw size={9} strokeWidth={2.3} />
                    <span>Flip back</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

StudentIdCard.displayName = "StudentIdCard";

export default memo(StudentIdCard);
