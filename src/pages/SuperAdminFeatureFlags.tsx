import { useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useFeatureFlags } from "@/hooks/superAdmin";
import { formatDateTime } from "@/lib/superAdmin/presentation";

const SuperAdminFeatureFlags = () => {
  const { toast } = useToast();
  const { featureFlags, isLoading, saveFlag } = useFeatureFlags();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState("{}");
  const [draftRollout, setDraftRollout] = useState("100");

  const openEditor = (flag: (typeof featureFlags)[number]) => {
    setEditingKey(flag.key);
    setDraftConfig(JSON.stringify(flag.config ?? {}, null, 2));
    setDraftRollout(String(flag.rolloutPercentage));
  };

  const handleSave = async (flag: (typeof featureFlags)[number], enabled: boolean) => {
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(draftConfig || "{}") as Record<string, unknown>;
    } catch {
      toast({
        description: "Config must be valid JSON.",
        title: "Invalid config",
        variant: "destructive",
      });
      return;
    }

    try {
      await saveFlag.mutateAsync({
        config: parsedConfig,
        enabled,
        key: flag.key,
        rolloutPercentage: Number(draftRollout),
        variants: flag.variants,
      });
      setEditingKey(null);
      toast({ title: "Feature flag updated" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update the feature flag.",
        title: "Update failed",
        variant: "destructive",
      });
    }
  };

  const handleEmergencyKill = async (flag: (typeof featureFlags)[number]) => {
    try {
      await saveFlag.mutateAsync({
        config: flag.config,
        enabled: false,
        key: flag.key,
        rolloutPercentage: 0,
        variants: flag.variants,
      });
      toast({ title: "Emergency kill switch applied" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to disable the feature flag.",
        title: "Kill switch failed",
        variant: "destructive",
      });
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          description="Controlled rollouts, centralized cache invalidation, and emergency kill switches through the feature flag engine."
          title="Feature Flags"
        />

        <ControlPlaneCard title="Flag registry">
          <div className="space-y-4">
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading feature flags...</p>
            ) : (
              featureFlags.map((flag) => (
                <div key={flag.key} className="rounded-xl border border-border p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{flag.name}</p>
                        <Badge variant={flag.enabled ? "default" : "destructive"}>
                          {flag.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Badge variant="outline">{flag.rolloutPercentage}% rollout</Badge>
                        <Badge variant="secondary">{flag.rollout.stage.replaceAll("_", " ")}</Badge>
                        <Badge variant={flag.rollout.healthStatus === "critical" ? "destructive" : flag.rollout.healthStatus === "warning" ? "secondary" : "outline"}>
                          {flag.rollout.healthStatus}
                        </Badge>
                        <Badge variant="secondary">{flag.source}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{flag.description || flag.key}</p>
                      <p className="text-xs text-muted-foreground">
                        {flag.rollout.summary} • Emergency rollback {flag.rollout.emergencyRollbackReady ? "ready" : "blocked"}
                      </p>
                      {flag.rollout.warnings[0] ? (
                        <p className="text-xs text-amber-700">{flag.rollout.warnings[0]}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Cache TTL {flag.cacheTtlSeconds}s • Updated {formatDateTime(flag.updatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => handleEmergencyKill(flag)}
                        size="sm"
                        variant="outline"
                      >
                        Emergency kill
                      </Button>
                      <Button onClick={() => openEditor(flag)} size="sm">
                        Edit rollout
                      </Button>
                    </div>
                  </div>

                  {editingKey === flag.key ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Label htmlFor={`flag-enabled-${flag.key}`}>Flag enabled</Label>
                        </div>
                        <Switch
                          checked={flag.enabled}
                          id={`flag-enabled-${flag.key}`}
                          onCheckedChange={(enabled) => handleSave(flag, enabled)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`flag-rollout-${flag.key}`}>Rollout percentage</Label>
                        <Input
                          id={`flag-rollout-${flag.key}`}
                          onChange={(event) => setDraftRollout(event.target.value)}
                          value={draftRollout}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`flag-config-${flag.key}`}>Config JSON</Label>
                        <Textarea
                          id={`flag-config-${flag.key}`}
                          onChange={(event) => setDraftConfig(event.target.value)}
                          rows={8}
                          value={draftConfig}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => setEditingKey(null)} variant="outline">
                          Cancel
                        </Button>
                        <Button onClick={() => handleSave(flag, flag.enabled)}>
                          Save flag
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </ControlPlaneCard>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminFeatureFlags;
