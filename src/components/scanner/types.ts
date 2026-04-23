export type ScannerUiTone = "neutral" | "success" | "danger" | "warning" | "info";

export type ScannerLiveState = "ready" | "detected" | "scanning" | "matched" | "failed" | "offline";

export type ScannerDetailBadge = {
  label: string;
  tone?: ScannerUiTone;
  value: string;
};

export type LastScanCardData = {
  confidence: number;
  id: string;
  name: string;
  seat?: string | null;
  statusLabel: string;
  subtitle: string;
  timeLabel: string;
  tone: ScannerUiTone;
};

export type ActivityFeedItem = {
  badge?: string;
  detail: string;
  id: string;
  timestampLabel: string;
  title: string;
  tone: ScannerUiTone;
};

export type ScannerStatItem = {
  helper: string;
  label: string;
  tone?: ScannerUiTone;
  value: string;
};
