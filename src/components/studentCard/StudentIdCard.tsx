/**
 * Libriofy Student ID Card — Production Component
 * 
 * CR80 standard card ratio (85.6mm × 54mm = 3.375" × 2.125")
 * Renders at 2x for print quality (1012px × 638px)
 * Optimized for:
 * - Real-world printing (300 DPI safe)
 * - Fast QR scanning from low-end devices
 * - Lamination readability
 * - Bulk generation (1000+ cards)
 */
import { QRCodeSVG } from "qrcode.react";

export type StudentCardData = {
  studentName: string;
  studentId: string;
  seatNumber: string;
  plan: string;
  timeSlot: string;
  validTill: string;
  libraryName: string;
  profileImageUrl?: string | null;
  qrValue: string;
  status: "active" | "expired";
  supportContact?: string;
  websiteUrl?: string;
};

const getInitials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";

// ─── FRONT SIDE ──────────────────────────────────────────────────────────────
export const StudentIdCardFront = ({ data }: { data: StudentCardData }) => {
  const isActive = data.status === "active";

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: "1012px",
        height: "638px",
        borderRadius: "24px",
        background: "linear-gradient(135deg, #0a1628 0%, #0d2847 40%, #0a1e3d 70%, #061224 100%)",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#ffffff",
      }}
    >
      {/* Background effects */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 20%, rgba(20, 184, 166, 0.08), transparent 50%)" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 80% 80%, rgba(6, 78, 130, 0.12), transparent 40%)" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, rgba(20, 184, 166, 0.3), transparent)" }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 40px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "linear-gradient(135deg, #14b8a6, #0d9488)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700 }}>L</div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>LIBRIOFY</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "#ffffff", marginTop: "1px" }}>{data.libraryName}</div>
          </div>
        </div>
        <div style={{
          padding: "6px 16px",
          borderRadius: "20px",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          background: isActive ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
          color: isActive ? "#34d399" : "#f87171",
          border: `1px solid ${isActive ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
          boxShadow: isActive ? "0 0 12px rgba(16, 185, 129, 0.2)" : "0 0 12px rgba(239, 68, 68, 0.2)",
        }}>
          {isActive ? "● ACTIVE" : "● EXPIRED"}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", alignItems: "center", padding: "30px 40px 0", gap: "36px" }}>
        {/* Profile image */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: "120px",
            height: "120px",
            borderRadius: "50%",
            border: "3px solid rgba(20, 184, 166, 0.5)",
            boxShadow: "0 0 20px rgba(20, 184, 166, 0.2), inset 0 0 20px rgba(0,0,0,0.3)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #1e3a5f, #0d2847)",
          }}>
            {data.profileImageUrl ? (
              <img src={data.profileImageUrl} alt={data.studentName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "40px", fontWeight: 700, color: "rgba(20, 184, 166, 0.7)" }}>{getInitials(data.studentName)}</span>
            )}
          </div>
        </div>

        {/* Student info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#ffffff", letterSpacing: "-0.02em", marginBottom: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {data.studentName}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 32px" }}>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "3px" }}>SEAT</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#e2e8f0" }}>{data.seatNumber}</div>
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "3px" }}>PLAN</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "#e2e8f0" }}>{data.plan}</div>
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "3px" }}>TIME SLOT</div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "#cbd5e1" }}>{data.timeSlot}</div>
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "3px" }}>VALID TILL</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: isActive ? "#34d399" : "#f87171" }}>{data.validTill}</div>
            </div>
          </div>
        </div>

        {/* Mini QR */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
          <div style={{ padding: "10px", borderRadius: "12px", background: "rgba(255,255,255,0.95)", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
            <QRCodeSVG value={data.qrValue} size={90} level="M" bgColor="#ffffff" fgColor="#0a1628" />
          </div>
          <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>QUICK SCAN</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: "20px", left: "40px", right: "40px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.05em" }}>ID: {data.studentId}</div>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>Powered by Libriofy</div>
      </div>
    </div>
  );
};

// ─── BACK SIDE ───────────────────────────────────────────────────────────────
export const StudentIdCardBack = ({ data }: { data: StudentCardData }) => (
  <div
    className="relative overflow-hidden"
    style={{
      width: "1012px",
      height: "638px",
      borderRadius: "24px",
      background: "linear-gradient(180deg, #0a1628 0%, #0d1f38 50%, #0a1628 100%)",
      fontFamily: "'Inter', system-ui, sans-serif",
      color: "#ffffff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {/* Subtle texture */}
    <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)", backgroundSize: "24px 24px" }} />
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, rgba(20, 184, 166, 0.2), transparent)" }} />

    {/* Header */}
    <div style={{ position: "absolute", top: "28px", left: 0, right: 0, textAlign: "center" }}>
      <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", color: "rgba(20, 184, 166, 0.6)", textTransform: "uppercase" }}>LIBRIOFY SMART ENTRY</div>
      <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.85)", marginTop: "6px", textTransform: "uppercase" }}>SCAN FOR ATTENDANCE</div>
    </div>

    {/* Main QR */}
    <div style={{ padding: "20px", borderRadius: "20px", background: "#ffffff", boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)" }}>
      <QRCodeSVG value={data.qrValue} size={280} level="H" bgColor="#ffffff" fgColor="#000000" includeMargin={false} />
    </div>

    {/* Scan instruction */}
    <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>
      <span>📱</span>
      <span>Hold device 6–10 inches from QR code</span>
    </div>

    {/* Footer info */}
    <div style={{ position: "absolute", bottom: "24px", left: "40px", right: "40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{data.studentName}</div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>ID: {data.studentId} · {data.libraryName}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>{data.supportContact || "support@libriofy.com"}</div>
          <div style={{ fontSize: "11px", color: "rgba(20, 184, 166, 0.6)", marginTop: "2px" }}>{data.websiteUrl || "www.libriofy.com"}</div>
        </div>
      </div>
    </div>
  </div>
);

// ─── COMBINED PREVIEW ────────────────────────────────────────────────────────
export const StudentIdCardPreview = ({ data }: { data: StudentCardData }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center" }}>
    <StudentIdCardFront data={data} />
    <StudentIdCardBack data={data} />
  </div>
);
