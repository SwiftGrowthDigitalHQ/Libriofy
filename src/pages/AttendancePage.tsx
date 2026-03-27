import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanLine, CheckCircle, XCircle, LogIn, LogOut, Camera, CameraOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AttendanceLog from "@/components/dashboard/AttendanceLog";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";

interface CheckInResult {
  success: boolean;
  error?: string;
  action?: "check_in" | "check_out";
  student_name?: string;
  seat?: string;
}

type BarcodeDetectorResult = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const AttendancePage = () => {
  const queryClient = useQueryClient();
  const [qrInput, setQrInput] = useState("");
  const [lastResult, setLastResult] = useState<CheckInResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const cameraOpenRef = useRef(false);
  const scanLockRef = useRef(false);

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["my-libraries-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
    cameraOpenRef.current = false;
    scanLockRef.current = false;
    setCameraOpen(false);
    setCameraBusy(false);
  }, []);

  const checkInMutation = useMutation({
    mutationFn: async (qrCode: string) => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      const { data, error } = await supabase.rpc("qr_check_in", {
        p_qr_code: qrCode,
        p_library_id: resolvedLibraryId,
      });
      if (error) throw error;
      return data as unknown as CheckInResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["attendance-logs-today", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      setLastResult(result);
      setQrInput("");
      if (result.success) {
        toast({
          title: result.action === "check_in" ? "Checked In!" : "Checked Out!",
          description: `${result.student_name} - Seat ${result.seat || "N/A"}`,
        });
      } else {
        toast({ title: "Denied", description: result.error, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const readQrCodeFromFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const detector = detectorRef.current;
    if (detector) {
      try {
        const barcodes = await detector.detect(video);
        const nativeValue = barcodes.find((item) => typeof item.rawValue === "string" && item.rawValue.trim())?.rawValue?.trim();
        if (nativeValue) return nativeValue;
      } catch {
        // If native detection fails for a frame, continue with the canvas fallback below.
      }
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;

    const maxScanWidth = 960;
    const scale = width > maxScanWidth ? maxScanWidth / width : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    return code?.data?.trim() || null;
  }, []);

  const runScanLoop = useCallback(() => {
    const loop = async () => {
      if (!cameraOpenRef.current || scanLockRef.current) return;

      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = window.requestAnimationFrame(() => void loop());
        return;
      }

      try {
        const scannedValue = await readQrCodeFromFrame();
        if (scannedValue) {
          scanLockRef.current = true;
          setQrInput(scannedValue);
          stopCamera();
          checkInMutation.mutate(scannedValue);
          return;
        }
      } catch {
        // Ignore transient frame decode errors; scanner keeps running.
      }

      rafRef.current = window.requestAnimationFrame(() => void loop());
    };

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => void loop());
  }, [checkInMutation, readQrCodeFromFrame, stopCamera]);

  const getCameraErrorMessage = (error: unknown) => {
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        return "Camera permission was denied. Allow camera access and try again.";
      }
      if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        return "No camera was found on this device.";
      }
      if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        return "Camera is busy in another app or browser tab. Close it there and try again.";
      }
      if (error.name === "OverconstrainedError") {
        return "Unable to start the preferred camera. Try again or switch devices.";
      }
      if (error.name === "SecurityError") {
        return "Camera access is blocked by browser security settings for this page.";
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "Camera permission denied or camera unavailable.";
  };

  const startCamera = async () => {
    setCameraError(null);

    if (!resolvedLibraryId) {
      setCameraError("Library not linked to your account.");
      return;
    }

    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera API not available in this browser.");
      return;
    }

    try {
      stopCamera();
      setCameraBusy(true);

      detectorRef.current = null;
      if (BarcodeDetectorCtor) {
        try {
          detectorRef.current = new BarcodeDetectorCtor({ formats: ["qr_code"] });
        } catch {
          detectorRef.current = null;
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      if (!videoRef.current) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      }

      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Camera preview unavailable.");
      }

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      cameraOpenRef.current = true;
      setCameraOpen(true);
      setCameraBusy(false);
      runScanLoop();
    } catch (error: unknown) {
      stopCamera();
      setCameraError(getCameraErrorMessage(error));
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={checkInMutation.isPending || roleLibraryLoading || fallbackLoading || !resolvedLibraryId}
                >
                  {checkInMutation.isPending ? "Processing..." : "Verify & Log"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={cameraOpen ? stopCamera : () => void startCamera()}
                  disabled={cameraBusy || checkInMutation.isPending || roleLibraryLoading || fallbackLoading || !resolvedLibraryId}
                >
                  {cameraOpen ? (
                    <>
                      <CameraOff className="w-4 h-4 mr-2" /> Stop Camera
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4 mr-2" /> {cameraBusy ? "Opening Camera..." : "Scan with Camera"}
                    </>
                  )}
                </Button>
              </form>

              {(cameraOpen || cameraBusy) && (
                <div className="mt-4 rounded-lg border border-border overflow-hidden bg-secondary/20">
                  <video
                    ref={videoRef}
                    className={`w-full h-56 object-cover ${cameraOpen ? "block" : "hidden"}`}
                    autoPlay
                    muted
                    playsInline
                  />
                  {cameraBusy && !cameraOpen ? (
                    <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                      Initializing camera preview...
                    </div>
                  ) : null}
                </div>
              )}

              {cameraError && <p className="text-xs text-destructive mt-2">{cameraError}</p>}

              {!resolvedLibraryId && !roleLibraryLoading && !fallbackLoading && (
                <p className="text-xs text-destructive mt-2">Library not linked to your account. Please check user role setup.</p>
              )}

              {lastResult && (
                <div
                  className={`mt-6 p-4 rounded-xl border-2 ${
                    lastResult.success ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
                  }`}
                >
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
                            <>
                              <LogIn className="w-3 h-3 mr-1" /> Check In
                            </>
                          ) : (
                            <>
                              <LogOut className="w-3 h-3 mr-1" /> Check Out
                            </>
                          )}
                        </Badge>
                        {lastResult.seat && <Badge variant="outline">Seat {lastResult.seat}</Badge>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-destructive">{lastResult.error}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <AttendanceLog libraryId={resolvedLibraryId} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AttendancePage;
