import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  LogOut,
  Power,
  RadioTower,
  RefreshCcw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  WifiOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  formatRelativeTime,
  getDeviceCommandStatusBadgeProps,
  getDeviceCommandTypeDescription,
  getDeviceCommandTypeLabel,
  getDeviceControlBadgeProps,
  getPresenceBadgeProps,
  resolveDeviceCommandMessage,
  resolveDeviceControlState,
  resolveDevicePresence,
  toMetadataRecord,
  type DeviceCommandRecord,
  type DeviceCommandType,
  type EntryDeviceRecord,
} from "@/lib/deviceControl";
import { issueDeviceCommand } from "@/lib/deviceCommands";
import { cn } from "@/lib/utils";

type DeviceControlCenterProps = {
  libraryId: string;
};

const EMPTY_DEVICE_LIST: EntryDeviceRecord[] = [];
const EMPTY_COMMAND_LIST: DeviceCommandRecord[] = [];

const resolveErrorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim() ? error.message : "Unable to load the device control center.";

const deviceCommandSelect =
  "id, library_id, device_id, command_type, payload, status, requested_by, requested_by_role, requested_at, acknowledged_at, completed_at, failed_at, error_message, metadata, updated_at";

const DeviceControlCenter = ({ libraryId }: DeviceControlCenterProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const devicesQuery = useQuery({
    queryKey: ["device-fleet", libraryId],
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
    refetchInterval: 15_000,
  });

  const commandsQuery = useQuery({
    queryKey: ["device-commands", libraryId],
    queryFn: async (): Promise<DeviceCommandRecord[]> => {
      const { data, error } = await supabase
        .from("device_commands")
        .select(deviceCommandSelect)
        .eq("library_id", libraryId)
        .order("requested_at", { ascending: false })
        .limit(24);

      if (error) {
        throw error;
      }

      return (data ?? []) as DeviceCommandRecord[];
    },
    enabled: Boolean(libraryId),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!libraryId) {
      return;
    }

    const channel = supabase
      .channel(`device-control:${libraryId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entry_devices",
          filter: `library_id=eq.${libraryId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["device-fleet", libraryId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "device_commands",
          filter: `library_id=eq.${libraryId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["device-commands", libraryId] });
          queryClient.invalidateQueries({ queryKey: ["device-fleet", libraryId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [libraryId, queryClient]);

  const devices = devicesQuery.data ?? EMPTY_DEVICE_LIST;
  const commands = commandsQuery.data ?? EMPTY_COMMAND_LIST;
  const latestCommandByDevice = useMemo(() => {
    const map = new Map<string, DeviceCommandRecord>();
    for (const command of commands) {
      if (!map.has(command.device_id)) {
        map.set(command.device_id, command);
      }
    }
    return map;
  }, [commands]);

  const onlineDevices = devices.filter((device) => resolveDevicePresence(device) === "online").length;
  const disabledDevices = devices.filter((device) => resolveDevicePresence(device) === "disabled").length;
  const offlineDevices = devices.filter((device) => resolveDevicePresence(device) === "offline").length;
  const idleDevices = devices.filter((device) => resolveDevicePresence(device) === "idle").length;
  const pendingCommands = commands.filter((command) => command.status === "pending");
  const acknowledgedCommands = commands.filter((command) => command.status === "acknowledged");
  const failedCommands = commands.filter((command) => command.status === "failed");
  const needsAttention = disabledDevices + pendingCommands.length + failedCommands.length;
  const loading = devicesQuery.isLoading || commandsQuery.isLoading;

  const issueCommandMutation = useMutation({
    mutationFn: async ({
      commandType,
      device,
    }: {
      commandType: DeviceCommandType;
      device: EntryDeviceRecord;
    }) =>
      issueDeviceCommand({
        commandType,
        deviceId: device.device_id,
        libraryId,
        payload: {
          device_name: device.device_name?.trim() || device.device_id,
          reason: getDeviceCommandTypeDescription(commandType),
          requested_from: "dashboard",
        },
      }),
    onSuccess: (command, variables) => {
      queryClient.invalidateQueries({ queryKey: ["device-commands", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["device-fleet", libraryId] });
      toast({
        title: `${getDeviceCommandTypeLabel(variables.commandType)} sent`,
        description:
          command.command_type === "disable_device"
            ? `${variables.device.device_name?.trim() || variables.device.device_id} was disabled immediately.`
            : `${variables.device.device_name?.trim() || variables.device.device_id} is processing the request.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to send command",
        description: resolveErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (device: EntryDeviceRecord) => {
      const currentMetadata = toMetadataRecord(device.metadata);
      const currentControl = toMetadataRecord(currentMetadata.device_control);
      const nextControl = {
        ...currentControl,
        current_command_error: null,
        current_command_id: null,
        current_command_requested_at: null,
        current_command_status: null,
        current_command_type: null,
        status: "active",
      };

      const { error } = await supabase
        .from("entry_devices")
        .update({
          is_active: true,
          metadata: {
            ...currentMetadata,
            device_control: nextControl,
          },
        })
        .eq("id", device.id)
        .eq("library_id", libraryId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, device) => {
      queryClient.invalidateQueries({ queryKey: ["device-fleet", libraryId] });
      toast({
        title: "Device reactivated",
        description: `${device.device_name?.trim() || device.device_id} can scan again.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to reactivate device",
        description: resolveErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const handleIssueCommand = (device: EntryDeviceRecord, commandType: DeviceCommandType) => {
    const label = device.device_name?.trim() || device.device_id;

    if (commandType === "disable_device") {
      if (!window.confirm(`Disable ${label}? The kiosk will stop scanning until you reactivate it.`)) {
        return;
      }
    }

    if (commandType === "force_logout") {
      if (!window.confirm(`Force ${label} back to setup now? The current kiosk session will be cleared.`)) {
        return;
      }
    }

    issueCommandMutation.mutate({ commandType, device });
  };

  const handleRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["device-fleet", libraryId] }),
      queryClient.invalidateQueries({ queryKey: ["device-commands", libraryId] }),
    ]);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">
            <RadioTower className="h-3.5 w-3.5" />
            Remote device control
          </div>
          <h3 className="text-xl font-semibold font-display text-foreground">Device Control Center</h3>
          <p className="text-sm text-muted-foreground">
            Monitor every kiosk, issue commands instantly, and watch devices react in near real time.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.94),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Online</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{onlineDevices}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100">
              <RadioTower className="h-5 w-5 text-emerald-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/60 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Offline / Idle</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{offlineDevices + idleDevices}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
              <WifiOff className="h-5 w-5 text-slate-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200/60 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Pending Commands</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{pendingCommands.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100">
              <Clock3 className="h-5 w-5 text-amber-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-200/60 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Needs Attention</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{needsAttention}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100">
              <AlertTriangle className="h-5 w-5 text-rose-700" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-lg font-display">Device Fleet</CardTitle>
            <CardDescription>
              Every kiosk is tracked with its live heartbeat, current control state, and the latest remote action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {devicesQuery.isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {resolveErrorMessage(devicesQuery.error)}
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
                No kiosk devices have been connected to this library yet.
              </div>
            ) : (
              devices.map((device) => {
                const presence = resolveDevicePresence(device);
                const presenceBadge = getPresenceBadgeProps(presence);
                const control = resolveDeviceControlState(device);
                const controlBadge = getDeviceControlBadgeProps(control.status);
                const latestCommand = latestCommandByDevice.get(device.device_id) ?? null;
                const latestCommandBadge = latestCommand
                  ? getDeviceCommandStatusBadgeProps(latestCommand.status)
                  : null;
                const latestCommandMessage = latestCommand ? resolveDeviceCommandMessage(latestCommand) : null;
                const isBusy =
                  issueCommandMutation.isPending ||
                  control.status !== "active" ||
                  latestCommand?.status === "pending" ||
                  latestCommand?.status === "acknowledged";

                return (
                  <div key={device.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-foreground">{device.device_name?.trim() || device.device_id}</p>
                          <Badge variant="outline" className={presenceBadge.className}>
                            {presenceBadge.label}
                          </Badge>
                          <Badge variant="outline" className={controlBadge.className}>
                            {controlBadge.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">Device ID {device.device_id}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Last heartbeat {formatRelativeTime(device.last_seen_at)}</span>
                          <span>Last control {formatRelativeTime(control.lastCommandAt)}</span>
                          <span>
                            {latestCommand ? `Latest command ${getDeviceCommandTypeLabel(latestCommand.command_type)}` : "No commands yet"}
                          </span>
                        </div>
                        {latestCommand ? (
                          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={latestCommandBadge?.className || "border-border/70 bg-muted/20 text-muted-foreground"}>
                                {latestCommandBadge?.label || "Unknown"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatRelativeTime(latestCommand.requested_at)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {getDeviceCommandTypeLabel(latestCommand.command_type)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {latestCommandMessage}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2 md:max-w-[320px] md:justify-end">
                        {device.is_active ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => handleIssueCommand(device, "disable_device")}
                            >
                              {issueCommandMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Power className="mr-2 h-4 w-4" />
                              )}
                              Disable
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => handleIssueCommand(device, "force_logout")}
                            >
                              <LogOut className="mr-2 h-4 w-4" />
                              Force logout
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => handleIssueCommand(device, "restart_scanner")}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Restart scanner
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => handleIssueCommand(device, "push_config_update")}
                            >
                              <Settings2 className="mr-2 h-4 w-4" />
                              Push config
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            disabled={reactivateMutation.isPending}
                            onClick={() => reactivateMutation.mutate(device)}
                          >
                            {reactivateMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                            )}
                            Reactivate device
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-lg font-display">Command Feed</CardTitle>
            <CardDescription>Live queue of the most recent kiosk commands across the fleet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {commandsQuery.isError ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {resolveErrorMessage(commandsQuery.error)}
              </div>
            ) : commands.length === 0 ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
                No remote commands have been issued yet.
              </div>
            ) : (
              commands.slice(0, 8).map((command) => {
                const device = devices.find((item) => item.device_id === command.device_id);
                const statusBadge = getDeviceCommandStatusBadgeProps(command.status);

                return (
                  <div key={command.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold text-foreground">
                          {device?.device_name?.trim() || command.device_id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {command.device_id} {command.requested_by_role ? `• ${command.requested_by_role}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn(statusBadge.className)}>
                        {statusBadge.label}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {getDeviceCommandTypeLabel(command.command_type)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resolveDeviceCommandMessage(command)}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Requested {formatRelativeTime(command.requested_at)}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-sky-200/60 bg-[linear-gradient(135deg,rgba(239,246,255,0.94),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Acknowledged</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{acknowledgedCommands.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100">
              <ShieldAlert className="h-5 w-5 text-sky-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/60 bg-[linear-gradient(135deg,rgba(236,253,245,0.94),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Completed</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">
                {commands.filter((command) => command.status === "completed").length}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-200/60 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(255,255,255,0.98))]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Failed</p>
              <p className="mt-3 text-3xl font-display font-bold text-slate-950">{failedCommands.length}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100">
              <AlertTriangle className="h-5 w-5 text-rose-700" />
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};

export default DeviceControlCenter;
