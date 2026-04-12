import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Share2, Video } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getPublicAppBaseUrl, getReferralLink } from "@/lib/partnerLinks";

const PartnerMarketingKitPage = () => {
  const { toast } = useToast();
  const { data: partner } = usePartnerAffiliate();
  const isMissingTableError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: string }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
    return code === "42P01" || /relation .* does not exist/i.test(message);
  };

  const referralLink = useMemo(() => {
    if (!partner?.code) return "";
    return getReferralLink(partner.code);
  }, [partner?.code]);

  const { data: referralClicks = 0 } = useQuery({
    queryKey: ["partner-referral-clicks", partner?.id],
    queryFn: async () => {
      if (!partner?.code) return 0;
      const { count, error } = await supabase
        .from("partner_referral_clicks")
        .select("id", { count: "exact", head: true })
        .eq("referral_code", partner.code);
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[partner-kit] partner_referral_clicks table missing. Skipping clicks count.", error);
          return 0;
        }
        throw error;
      }
      return Number(count ?? 0);
    },
    enabled: !!partner?.code,
  });

  const { data: referralSignups = 0 } = useQuery({
    queryKey: ["partner-referral-signups", partner?.id],
    queryFn: async () => {
      if (!partner?.id) return 0;
      const { count } = await supabase
        .from("library_acquisition")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_id", partner.id);
      return Number(count ?? 0);
    },
    enabled: !!partner?.id,
  });

  const { data: referralConversions = 0 } = useQuery({
    queryKey: ["partner-referral-conversions", partner?.id],
    queryFn: async () => {
      if (!partner?.id) return 0;
      const { count } = await supabase
        .from("affiliate_commissions")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_id", partner.id)
        .in("status", ["pending", "paid"]);
      return Number(count ?? 0);
    },
    enabled: !!partner?.id,
  });

  const whatsappScript =
    `Namaste sir/ma'am,\n\n` +
    `Main Libriofy team se bol raha/rahi hu.\n` +
    `Hum library management software provide karte hain jisse student entry, seat management aur payment tracking automatic ho jata hai.\n\n` +
    `Main demo video bhej raha/rahi hu. Aap dekh kar bataiye, main 10-minute ka live demo bhi de dunga/dungi.\n\n` +
    `Thank you.`;

  const callingScript =
    `1) Intro: "Namaste, main Libriofy se bol raha hu. Aapki library ka naam? (Confirm owner)"\n` +
    `2) Problem: "Seat availability, payments, renewals aur student tracking me time lagta hai?"\n` +
    `3) Value: "Libriofy se student entry, seat management, payment tracking aur WhatsApp reminders automatic ho jate hain."\n` +
    `4) CTA: "Main demo video WhatsApp par bhej deta hu. 10-minute ka demo aaj ya kal kab free hain?"\n` +
    `5) Close: "Sign up is link se karna, taki setup fast ho aur referral track ho jaye."`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
    } catch (err: any) {
      toast({ title: "Copy failed", description: err?.message ?? "Unable to copy.", variant: "destructive" });
    }
  };

  const downloadPoster = () => {
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="80" y="80" width="920" height="1190" rx="40" fill="#ffffff" opacity="0.06"/>
  <text x="120" y="240" fill="#ffffff" font-size="64" font-family="Arial, sans-serif" font-weight="700">Libriofy Partner</text>
  <text x="120" y="330" fill="#cbd5f5" font-size="36" font-family="Arial, sans-serif">Automate your library management</text>
  <text x="120" y="500" fill="#ffffff" font-size="40" font-family="Arial, sans-serif">✅ Student entry</text>
  <text x="120" y="580" fill="#ffffff" font-size="40" font-family="Arial, sans-serif">✅ Seat management</text>
  <text x="120" y="660" fill="#ffffff" font-size="40" font-family="Arial, sans-serif">✅ Payment tracking</text>
  <text x="120" y="820" fill="#38bdf8" font-size="44" font-family="Arial, sans-serif" font-weight="700">Book a 10-min demo</text>
  <text x="120" y="900" fill="#94a3b8" font-size="28" font-family="Arial, sans-serif">Contact your Libriofy partner for the demo link.</text>
</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "libriofy-partner-poster.svg";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">Marketing Kit</h2>
          <p className="text-sm text-muted-foreground">Share-ready resources to help you close faster.</p>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Your Referral Link</CardTitle>
            {partner?.code ? <Badge variant="secondary">{partner.code}</Badge> : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={referralLink} readOnly placeholder="Referral link will appear here" />
              <Button type="button" variant="outline" disabled={!referralLink} onClick={() => copy(referralLink, "Referral link")}>
                <Link2 className="mr-2 h-4 w-4" /> Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!referralLink}
                onClick={() => {
                  const message = `Libriofy partner referral: ${referralLink}`;
                  const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
                  window.open(url, "_blank", "noreferrer");
                }}
              >
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ask customers to sign up using this link: commission assignment is automatic.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Clicks</p>
                <p className="text-lg font-semibold text-foreground">{referralClicks}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Signups</p>
                <p className="text-lg font-semibold text-foreground">{referralSignups}</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Conversions</p>
                <p className="text-lg font-semibold text-foreground">{referralConversions}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-display">Customer Demo Video</CardTitle>
              <Video className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Upload your demo video link in partner training material. (Recommended: YouTube unlisted / Google Drive)
              </p>
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-xs text-muted-foreground">Demo video should cover:</p>
                <ul className="mt-2 list-disc pl-4 space-y-1">
                  <li>Libriofy overview</li>
                  <li>Student entry system</li>
                  <li>Seat management</li>
                  <li>Payment tracking + renewals</li>
                  <li>WhatsApp notifications</li>
                  <li>Dashboard analytics</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Send the pricing page to customers (or request a PDF from admin if needed).
              </p>
              <Button asChild variant="outline">
                <a href={`${getPublicAppBaseUrl()}/#pricing`} target="_blank" rel="noreferrer">
                  Open pricing page
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">WhatsApp Message Template</CardTitle>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => copy(whatsappScript, "WhatsApp template")}>
                Copy
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const url = `https://wa.me/?text=${encodeURIComponent(whatsappScript)}`;
                  window.open(url, "_blank", "noreferrer");
                }}
              >
                Send
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm text-foreground">
              {whatsappScript}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Calling Script</CardTitle>
            <Button type="button" variant="outline" onClick={() => copy(callingScript, "Calling script")}>
              Copy
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm text-foreground">
              {callingScript}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Posters & Creatives</CardTitle>
            <Button type="button" onClick={downloadPoster}>
              Download Poster
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use this branded poster for WhatsApp forwards or print. More creatives can be added by admin.
            </p>
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerMarketingKitPage;
