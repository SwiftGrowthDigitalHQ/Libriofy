import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, CheckCircle2, Clock3, Copy, ExternalLink, Upload } from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildUpiPaymentLink, PAYMENT_SCREENSHOT_BUCKET } from "@/lib/payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RenewalContext = {
  expiry_date: string | null;
  latest_payment_created_at: string | null;
  latest_payment_status: string | null;
  library_id: string | null;
  library_name: string | null;
  plan_name: string | null;
  renewal_amount: number | null;
  seat_id: string | null;
  seat_number: string | null;
  student_id: string | null;
  student_name: string | null;
  upi_id: string | null;
};

const formatCurrency = (amount: number) => `Rs ${amount.toLocaleString("en-IN")}`;

const sanitizeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "-");

const StudentRenewalPage = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["student-renewal-context", token],
    queryFn: async (): Promise<RenewalContext | null> => {
      if (!token) return null;
      const { data, error } = await supabase.rpc("get_student_renewal_context", {
        p_student_token: token,
      });
      if (error) throw error;
      return (data ?? null) as RenewalContext | null;
    },
    enabled: !!token,
  });

  const amount = Number(data?.renewal_amount ?? 0);
  const hasApprovedPayment = (data?.latest_payment_status || "").toLowerCase() === "approved";
  const hasPendingPayment = (data?.latest_payment_status || "").toLowerCase() === "pending";

  const upiLink = useMemo(() => {
    if (!data?.upi_id || !data?.library_name || amount <= 0) return "";
    return buildUpiPaymentLink({
      upiId: data.upi_id,
      libraryName: data.library_name,
      amount,
    });
  }, [amount, data?.library_name, data?.upi_id]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Invalid renewal link.");
      if (!data?.library_id) throw new Error("Library details are missing.");
      if (!upiLink) throw new Error("UPI payment setup is incomplete.");
      if (!file) throw new Error("Please upload your payment screenshot.");

      const path = `${data.library_id}/${token}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_SCREENSHOT_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: file.type || "image/png",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: rpcData, error: rpcError } = await supabase.rpc("submit_renewal_payment", {
        p_student_token: token,
        p_amount: amount,
        p_payment_screenshot: path,
      });

      if (rpcError) {
        await supabase.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([path]);
        throw rpcError;
      }

      const result = (rpcData ?? null) as { error?: string; success?: boolean; status?: string } | null;
      if (!result?.success) {
        await supabase.storage.from(PAYMENT_SCREENSHOT_BUCKET).remove([path]);
        throw new Error(result?.error || "Unable to submit renewal payment.");
      }

      return result;
    },
    onSuccess: () => {
      toast({
        title: "Payment proof submitted",
        description: "Library owner will verify your screenshot and approve the renewal.",
      });
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["student-renewal-context", token] });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to submit proof",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const getStatusBadge = () => {
    if (hasApprovedPayment) {
      return <Badge className="bg-success/10 text-success hover:bg-success/10">Approved</Badge>;
    }
    if (hasPendingPayment) {
      return <Badge variant="secondary">Pending Verification</Badge>;
    }
    return <Badge variant="outline">Awaiting Payment Proof</Badge>;
  };

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="py-10 text-center text-destructive">Invalid renewal link.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.12),_transparent_35%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--secondary)))] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary/70">Libriofy Renewal</p>
          <h1 className="text-3xl font-bold font-display text-foreground sm:text-4xl">Seat Renewal Payment</h1>
          <p className="text-sm text-muted-foreground">Pay directly to your library owner via UPI and upload the payment screenshot for approval.</p>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading renewal details...</CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              {(error as Error)?.message || "Unable to load renewal details."}
            </CardContent>
          </Card>
        ) : !data?.student_id ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">This renewal link is invalid or has expired.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-2xl font-display">{data.student_name}</CardTitle>
                    <CardDescription>{data.library_name}</CardDescription>
                  </div>
                  {getStatusBadge()}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Seat Number</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{data.seat_number || "-"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Renewal Amount</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{formatCurrency(amount)}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Expiry Date</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">
                      {data.expiry_date ? format(new Date(`${data.expiry_date}T00:00:00`), "dd MMM yyyy") : "Not set"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current Plan</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{data.plan_name || "Membership"}</p>
                  </div>
                </div>

                {!data.upi_id ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <p>The library has not configured its UPI ID yet. Please contact the library owner before making payment.</p>
                  </div>
                ) : amount <= 0 ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <p>The renewal amount is not configured for your current plan. Please contact the library owner.</p>
                  </div>
                ) : hasApprovedPayment ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm text-success">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <p>Your latest renewal payment has already been approved. Your seat validity has been extended.</p>
                  </div>
                ) : hasPendingPayment ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
                    <Clock3 className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
                    <p>
                      Your payment screenshot was submitted on{" "}
                      {data.latest_payment_created_at ? format(new Date(data.latest_payment_created_at), "dd MMM yyyy, hh:mm a") : "recently"}.
                      Approval is still pending.
                    </p>
                  </div>
                ) : (
                  <Card className="border-dashed border-primary/30 bg-primary/5 shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg font-display">Upload Payment Screenshot</CardTitle>
                      <CardDescription>After paying via the QR code or UPI link, upload your payment proof here.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="payment-screenshot">Payment Screenshot</Label>
                        <Input
                          id="payment-screenshot"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                        />
                      </div>
                      <Button className="w-full sm:w-auto" onClick={() => submitMutation.mutate()} disabled={!file || submitMutation.isPending}>
                        <Upload className="mr-2 h-4 w-4" />
                        {submitMutation.isPending ? "Submitting..." : "Upload Payment Screenshot"}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-sm">
              <CardHeader className="pb-4 text-center">
                <CardTitle className="text-2xl font-display">Scan & Pay</CardTitle>
                <CardDescription>Use any UPI app like Google Pay, PhonePe or Paytm.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="mx-auto flex w-full max-w-sm justify-center rounded-[2rem] border border-border/70 bg-white p-6 shadow-inner">
                  {upiLink ? (
                    <QRCodeSVG value={upiLink} size={280} includeMargin />
                  ) : (
                    <div className="grid min-h-[280px] w-[280px] place-items-center rounded-2xl bg-secondary text-center text-sm text-muted-foreground">
                      QR code will appear once UPI setup is complete.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-2xl border border-border/70 bg-secondary/40 p-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">UPI ID</p>
                    <p className="mt-1 break-all text-base font-medium text-foreground">{data.upi_id || "Not configured"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Payment Link</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{upiLink || "Unavailable"}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button variant="outline" onClick={() => data.upi_id && copyText(data.upi_id, "UPI ID")} disabled={!data.upi_id}>
                    <Copy className="mr-2 h-4 w-4" /> Copy UPI ID
                  </Button>
                  <Button variant="outline" onClick={() => upiLink && copyText(upiLink, "Payment link")} disabled={!upiLink}>
                    <Copy className="mr-2 h-4 w-4" /> Copy Payment Link
                  </Button>
                </div>

                <Button className="w-full" asChild disabled={!upiLink}>
                  <a href={upiLink || "#"} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Open in UPI App
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentRenewalPage;
