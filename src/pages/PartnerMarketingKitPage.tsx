import { useMemo } from "react";
import { Link2, Video } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";

const getReferralBaseUrl = () => {
  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : "";

  if (hostname === "partner.libriofy.com") return "https://libriofy.com";
  if (hostname === "partner.localhost") return `${protocol}//localhost${port}`;
  return `${protocol}//${hostname}${port}`;
};

const PartnerMarketingKitPage = () => {
  const { toast } = useToast();
  const { data: partner } = usePartnerAffiliate();

  const referralLink = useMemo(() => {
    if (!partner?.code) return "";
    return `${getReferralBaseUrl()}/signup?ref=${encodeURIComponent(partner.code)}`;
  }, [partner?.code]);

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
            </div>
            <p className="text-xs text-muted-foreground">
              Ask customers to sign up using this link: commission assignment is automatic.
            </p>
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
                <a href="/" target="_blank" rel="noreferrer">
                  Open pricing page
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">WhatsApp Message Template</CardTitle>
            <Button type="button" variant="outline" onClick={() => copy(whatsappScript, "WhatsApp template")}>
              Copy
            </Button>
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
      </div>
    </PartnerLayout>
  );
};

export default PartnerMarketingKitPage;

