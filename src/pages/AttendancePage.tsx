import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanLine, CheckCircle, XCircle, LogIn, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AttendanceLog from "@/components/dashboard/AttendanceLog";

// Demo library ID — in production this comes from auth context
const DEMO_LIBRARY_ID = "00000000-0000-0000-0000-000000000000";

interface CheckInResult {
  success: boolean;
  error?: string;
  action?: "check_in" | "check_out";
  student_name?: string;
  seat?: string;
}

const AttendancePage = () => {
  const [qrInput, setQrInput] = useState("");
  const [lastResult, setLastResult] = useState<CheckInResult | null>(null);
  const { toast } = useToast();

  const checkInMutation = useMutation({
    mutationFn: async (qrCode: string) => {
      const { data, error } = await supabase.rpc("qr_check_in" as any, {
        p_qr_code: qrCode,
        p_library_id: DEMO_LIBRARY_ID,
      });
      if (error) throw error;
      return data as unknown as CheckInResult;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setQrInput("");
      if (result.success) {
        toast({
          title: result.action === "check_in" ? "Checked In!" : "Checked Out!",
          description: `${result.student_name} — Seat ${result.seat || "N/A"}`,
        });
      } else {
        toast({ title: "Denied", description: result.error, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrInput.trim()) return;
    checkInMutation.mutate(qrInput.trim());
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Attendance</h2>
          <p className="text-sm text-muted-foreground mt-1">QR code check-in / check-out & daily logs</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scanner Card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <ScanLine className="w-5 h-5 text-primary" />
                QR Scanner
              </CardTitle>
              <CardDescription>Scan or enter a student's QR code</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  placeholder="Enter or scan QR code..."
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  autoFocus
                  className="text-lg h-12 font-mono"
                />
                <Button type="submit" className="w-full" disabled={checkInMutation.isPending}>
                  {checkInMutation.isPending ? "Processing..." : "Verify & Log"}
                </Button>
              </form>

              {/* Result display */}
              {lastResult && (
                <div className={`mt-6 p-4 rounded-xl border-2 ${
                  lastResult.success
                    ? "border-success/30 bg-success/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}>
                  <div className="flex items-center gap-3 mb-2">
                    {lastResult.success ? (
                      <CheckCircle className="w-6 h-6 text-success" />
                    ) : (
                      <XCircle className="w-6 h-6 text-destructive" />
                    )}
                    <span className="font-semibold font-display text-foreground">
                      {lastResult.success ? "Access Granted" : "Access Denied"}
                    </span>
                  </div>
                  {lastResult.success ? (
                    <div className="space-y-1">
                      <p className="text-sm text-foreground font-medium">{lastResult.student_name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant={lastResult.action === "check_in" ? "default" : "secondary"}>
                          {lastResult.action === "check_in" ? (
                            <><LogIn className="w-3 h-3 mr-1" /> Check In</>
                          ) : (
                            <><LogOut className="w-3 h-3 mr-1" /> Check Out</>
                          )}
                        </Badge>
                        {lastResult.seat && (
                          <Badge variant="outline">Seat {lastResult.seat}</Badge>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-destructive">{lastResult.error}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Attendance Log */}
          <div className="lg:col-span-2">
            <AttendanceLog />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AttendancePage;
