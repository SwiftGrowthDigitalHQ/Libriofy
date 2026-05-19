import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

export const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value || 0);

export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value || 0);

export const formatPercent = (value: number, fractionDigits = 1) =>
  `${Number(value || 0).toFixed(fractionDigits)}%`;

export const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString("en-IN");
};

export const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const formatOperationalTimestamp = (value?: string | null) => {
  if (!value) {
    return "Waiting for first activity";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Waiting for first activity";
  }

  const diffMs = Math.abs(Date.now() - parsed.getTime());
  if (diffMs < 60 * 60 * 1000) {
    return formatDistanceToNowStrict(parsed, { addSuffix: true });
  }

  if (isToday(parsed)) {
    return `Today at ${format(parsed, "h:mm a")}`;
  }

  if (isYesterday(parsed)) {
    return `Yesterday at ${format(parsed, "h:mm a")}`;
  }

  return format(parsed, "dd MMM yyyy, h:mm a");
};

export const toBadgeVariant = (
  status: string | null | undefined,
): "default" | "secondary" | "outline" | "destructive" => {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (
    normalized === "active" ||
    normalized === "enabled" ||
    normalized === "green" ||
    normalized === "healthy" ||
    normalized === "ready" ||
    normalized === "stable" ||
    normalized === "paid" ||
    normalized === "sent" ||
    normalized === "completed" ||
    normalized === "success"
  ) {
    return "default";
  }

  if (
    normalized === "warning" ||
    normalized === "yellow" ||
    normalized === "medium" ||
    normalized === "watch" ||
    normalized === "caution" ||
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "trial" ||
    normalized === "approved"
  ) {
    return "secondary";
  }

  if (
    normalized === "error" ||
    normalized === "red" ||
    normalized === "high" ||
    normalized === "action" ||
    normalized === "blocked" ||
    normalized === "failed" ||
    normalized === "critical" ||
    normalized === "banned" ||
    normalized === "rejected"
  ) {
    return "destructive";
  }

  return "outline";
};

export const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
