import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RadioTower,
  RefreshCcw,
  ShieldAlert,
  Users,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type ScannerOperationsPanelProps = {
  libraryId: string;
};

type EntryDeviceRecord = {
  device_id: string;
  device_name: string | null;
  id: string;
  is_active: boolean;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

type InsidePresenceRecord = {
  check_in: string;
  device_id: string | null;
  id: string;
  students: {
    full_name: string | null;
    seat_number: string | null;
  } | null;
};

type ScannerAlertRecord = {
  created_at: string;
  error_message: string;
  id: string;
  metadata: Record<string, unknown> | null;
  route: string;
  source: string;
};

type DevicePresence = "online" | "idle" | "offline" | "disabled";

const DEVICE_ONLINE_WINDOW_MS = 90_000;
const DEVICE_IDLE_WINDOW_MS = 10 * 60 * 1000;
const RELEVANT_ALERT_ROUTES = [
  "/api/scan-attendance",
  "/rpc/scan_attendance_entry",
  "/rpc/process_attendance_scan",
  "/api/device-setup",
  "/api/device-heartbeat",
];

const resolveErrorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim() ? error.message : "Unable to load scanner operations.";

const toMetadataRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const resolveDevicePresence = (device: EntryDeviceRecord): DevicePresence => {
  if (!device.is_active) {
    return "disabled";
  }

  const lastSeenMs = Date.parse(device.last_seen_at ?? "");
  if (Number.isNaN(lastSeenMs)) {
    return "offline";
  }

  const elapsed = Date.now() - lastSeenMs;
  if (elapsed <= DEVICE_ONLINE_WINDOW_MS) {
    return "online";
  }

  if (elapsed <= DEVICE_IDLE_WINDOW_MS) {
    return "idle";
  }

  return "offline";
};

const getPresenceBadgeProps = (presence: DevicePresence) => {
  switch (presence) {
    case "online":
      return {
        className: "border-emerald-300/30 bg-emerald-50 text-emerald-700",
        label: "Online",
      };
    case "idle":
      return {
        className: "border-amber-300/30 bg-amber-50 text-amber-700",
        label: "Idle",
      };
    case "disabled":
      return {
        className: "border-slate-300/30 bg-slate-100 text-slate-700",
        label: "Disabled",
      };
    default:
      return {
        className: "border-rose-300/30 bg-rose-50 text-rose-700",
        label: "Offline",
      };
  }
};

const formatRelativeTime = (value: string | null | undefined, fallback = "Never") => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return formatDistanceToNowStrict(parsed, { addSuffix: true });
};

const formatAlertLabel = (record: ScannerAlertRecord) => {
  const metadata = toMetadataRecord(record.metadata);
  const code =
    typeof metadata.code === "string" && metadata.code.trim()
      ? metadata.code.trim().replace(/_/g, " ")
      : record.source.includes("heartbeat")
        ? "Device heartbeat"
        : record.source.includes("device-setup")
          ? "Setup issue"
          : "Scanner alert";

  return code.toUpperCase();
};

const getAlertLibraryId = (record: ScannerAlertRecord) => {
  const metadata = toMetadataRecord(record.metadata);
  const libraryId = typeof metadata.library_id === "string" ? metadata.library_id.trim() : "";
  const expectedLibraryId =
    typeof metadata.expected_library_id === "string" ? metadata.expected_library_id.trim() : "";

  return libraryId || expectedLibraryId || null;
};

const getAlertToneClassName = (record: ScannerAlertRecord) => {
  const metadata = toMetadataRecord(record.metadata);
  const code = typeof metadata.code === "string" ? metadata.code.trim() : "";

  if (code === "INVALID_QR" || code === "WRONG_LIBRARY" || code === "INVALID_LIBRARY_ID") {
    return "border-rose-300/30 bg-rose-50 text-rose-700";
  }

  if (code === "TOO_FREQUENT" || code === "ALREADY_INSIDE" || code === "DEVICE_BLOCKED") {
    return "border-amber-300/30 bg-amber-50 text-amber-700";
  }

  return "border-sky-300/30 bg-sky-50 text-sky-700";
};

const ScannerOperationsPanel = ({ libraryId }: ScannerOperationsPanelProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const devicesQuery = useQuery({
    queryKey: ["scanner-fleet", libraryId],
    queryFn: async (): Promise<EntryDeviceRecord[]> => {
      const { data, error } = await supabase
        .from("entry_devices")
        .select("id, device_id, device_name, is_active, last_seen_at, metadata, updated_at")
        .eq("library_id", libraryId)
        .order("last_seen_at", { ascending: false })
        .order("updated_at", { ascending: false });

      if (error) {
        throw error;
      }

      return (data ?? []) as EntryDeviceRecord[];
    },
    enabled: Boolean(libraryId),
    refetchInterval: 15000,
  });

  const insideNowQuery = useQuery({
    queryKey: ["scanner-inside-now", libraryId],
    queryFn: async (): Promise<InsidePresenceRecord[]> => {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("id, check_in, device_id, students:student_id(full_name, seat_number)")
        .eq("library_id", libraryId)
        .is("check_out", null)
        .order("check_in", { ascending: false })
        .limit(8);

      if (error) {
        throw error;
      }

      return (data ?? []) as InsidePresenceRecord[];
    },
    enabled: Boolean(libraryId),
    refetchInterval: 15000,
  });

  const alertsQuery = useQuery({
    queryKey: ["scanner-alerts", libraryId],
    queryFn: async (): Promise<ScannerAlertRecord[]> => {
      const { data, error } = await supabase
        .from("app_error_logs")
        .select("id, created_at, error_message, metadata, route, source")
        .in("route", RELEVANT_ALERT_ROUTES)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        throw error;
      }

      const records = (data ?? []) as ScannerAlertRecord[];
      return records.filter((record) => getAlertLibraryId(record) === libraryId);
    },
    enabled: Boolean(libraryId),
    refetchInterval: 15000,
  });

  const deviceActionMutation = useMutation({
    mutationFn: async (device: EntryDeviceRecord) => {
      const currentMetadata = toMetadataRecord(device.metadata);
      const currentControl = toMetadataRecord(currentMetadata.device_control);
      const timestamp = new Date().toISOString();
      const nextActiveState = !device.is_active;

      const nextMetadata = {
        ...currentMetadata,
        device_control: {
          ...currentControl,
          reason: nextActiveState ? "manual_reactivation" : "manual_force_rebind",
          status: nextActiveState ? "active" : "rebind_required",
          updated_at: timestamp,
          ...(nextActiveState
            ? { reactivated_at: timestamp }
            : { forced_rebind_at: timestamp }),
        },
      };

      const { error } = await supabase
        .from("entry_devices")
        .update({
          is_active: nextActiveState,
          metadata: nextMetadata,
        })
        .eq("id", device.id)
        .eq("library_id", libraryId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, device) => {
      queryClient.invalidateQueries({ queryKey: ["scanner-fleet", libraryId] });
      toast({
        title: device.is_active ? "Device rebind requested" : "Device reactivated",
        description: device.is_active
          ? `${device.device_id} will be pushed back to setup on its next heartbeat.`
          : `${device.device_id} can scan again once it reconnects.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to update device",
        description: resolveErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const devices = devicesQuery.data ?? [];
  const insideNow = insideNowQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];
  const onlineDevices = devices.filter((device) => resolveDevicePresence(device) === "online").length;
  const disabledDevices = devices.filter((device) => resolveDevicePresence(device) === "disabled").length;
  const loading = devicesQuery.isLoading || insideNowQuery.isLoading || alertsQuery.isLoading;

  const handleRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scanner-fleet", libraryId] }),
      queryClient.invalidateQueries({ queryKey: ["scanner-inside-now", libraryId] }),
      queryClient.invalidateQueries({ queryKey: ["scanner-alerts", libraryId] }),
    ]);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold font-display text-foreground">Scanner Operations</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Live device health, active attendance presence, and scanner security alerts.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.94),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Devices Online</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{onlineDevices}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100">
              <RadioTower className="h-5 w-5 text-emerald-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-sky-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.94),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Inside Now</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{insideNow.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100">
              <Users className="h-5 w-5 text-sky-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Security Alerts</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{alerts.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100">
              <ShieldAlert className="h-5 w-5 text-amber-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/60 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Needs Action</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">
                {disabledDevices + alerts.length}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
              <AlertTriangle className="h-5 w-5 text-slate-700" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr_1fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-lg font-display">Multi-Gate Devices</CardTitle>
            <CardDescription>Each kiosk stays locked to this library and can be force-rebound remotely.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {devicesQuery.isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {resolveErrorMessage(devicesQuery.error)}
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                No kiosk devices have been connected to this library yet.
              </div>
            ) : (
              devices.map((device) => {
                const runtime = toMetadataRecord(toMetadataRecord(device.metadata).device_runtime);
                const presence = resolveDevicePresence(device);
                const badge = getPresenceBadgeProps(presence);
                const pendingCount =
                  typeof runtime.pending_count === "number"
                    ? runtime.pending_count
                    : typeof runtime.pending_count === "string"
                      ? Number.parseInt(runtime.pending_count, 10) || 0
                      : 0;
                const lastSyncAt =
                  typeof runtime.last_sync_at === "string" ? runtime.last_sync_at : null;

                return (
                  <div
                    key={device.id}
                    className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {device.device_name?.trim() || device.device_id}
                          </p>
                          <Badge variant="outline" className={badge.className}>
                            {badge.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">Device ID {device.device_id}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Last heartbeat {formatRelativeTime(device.last_seen_at)}</span>
                          <span>Last sync {formatRelativeTime(lastSyncAt, "No sync yet")}</span>
                          <span>{pendingCount} queued scan{pendingCount === 1 ? "" : "s"}</span>
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant={device.is_active ? "destructive" : "outline"}
                        disabled={deviceActionMutation.isPending}
                        onClick={() => deviceActionMutation.mutate(device)}
                      >
                        {deviceActionMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : device.is_active ? (
                          <WifiOff className="mr-2 h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        {device.is_active ? "Force Rebind" : "Reactivate"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-lg font-display">Who Is Inside</CardTitle>
            <CardDescription>Students with an open entry record right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {insideNowQuery.isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {resolveErrorMessage(insideNowQuery.error)}
              </div>
            ) : insideNow.length === 0 ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                No active open entries right now.
              </div>
            ) : (
              insideNow.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {entry.students?.full_name || "Student"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {entry.students?.seat_number
                          ? `Seat ${entry.students.seat_number}`
                          : "Seat not assigned"}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-sky-300/30 bg-sky-50 text-sky-700">
                      {entry.device_id?.trim() || "Scanner"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Entered {formatRelativeTime(entry.check_in)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-lg font-display">Scanner Alerts</CardTitle>
            <CardDescription>Invalid ID, wrong-library, and duplicate-protection signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertsQuery.isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {resolveErrorMessage(alertsQuery.error)}
              </div>
            ) : alerts.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200/30 bg-emerald-50 p-4 text-sm text-emerald-700">
                No scanner alerts are active for this library right now.
              </div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={getAlertToneClassName(alert)}>
                      {formatAlertLabel(alert)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(alert.created_at)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-foreground">{alert.error_message}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {alert.route} via {alert.source}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default ScannerOperationsPanel;
