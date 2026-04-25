import type { CameraErrorCode, CameraStartupErrorSummary } from "@/lib/cameraStartup";

export type CameraFacingPreference = "environment" | "user";

export type ScanControllerStatus = "idle" | "starting" | "ready" | "paused" | "error" | "stopped";

export type CameraDeviceKind = "rear" | "front" | "external" | "unknown";

export type CameraDeviceOption = {
  id: string;
  kind: CameraDeviceKind;
  label: string;
};

export type ScanDetectionSource = "barcode_detector" | "jsqr";

export type ScanFrameAnalysis = {
  brightness: number;
  blurry: boolean;
  edgeScore: number;
  glare: boolean;
  lowLight: boolean;
};

export type ScanDetectionPayload = {
  rawValue: string;
  detectedAt: string;
  source: ScanDetectionSource;
  timingMs: number;
  analysis: ScanFrameAnalysis;
};

export type ScanControllerError = {
  code: CameraErrorCode;
  detail: string;
  normalized: CameraStartupErrorSummary;
  title: string;
};

export type ScanControllerState = {
  activeCameraId: string | null;
  activeCameraLabel: string | null;
  devices: CameraDeviceOption[];
  error: ScanControllerError | null;
  lastFrameAt: number | null;
  permissionState: PermissionState | null;
  status: ScanControllerStatus;
  torchBusy: boolean;
  torchEnabled: boolean;
  torchSupported: boolean;
};

export type ScanControllerLogLevel = "info" | "warn" | "error";
