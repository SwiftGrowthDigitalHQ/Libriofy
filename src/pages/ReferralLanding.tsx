import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const ReferralLanding = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const referralCode = (code ?? "").trim();
    if (!referralCode) {
      navigate("/", { replace: true });
      return;
    }

    const trackClick = async () => {
      try {
        const { error } = await supabase.from("partner_referral_clicks").insert({
          referral_code: referralCode,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        });
        if (error) {
          const message = String(error.message ?? "");
          const code = String((error as { code?: string }).code ?? "");
          if (code === "42P01" || /relation .* does not exist/i.test(message)) {
            console.warn("[referral] partner_referral_clicks table missing. Skipping tracking.", error);
          } else {
            console.error("[referral] failed to track referral click", error);
          }
        }
      } catch {
        // Ignore tracking failures
      } finally {
        navigate(`/signup?ref=${encodeURIComponent(referralCode)}`, { replace: true });
      }
    };

    void trackClick();
  }, [code, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Redirecting to signup...</span>
      </div>
    </div>
  );
};

export default ReferralLanding;
