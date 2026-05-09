import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDateTime,
  formatInr,
  formatNumber,
  toBadgeVariant,
} from "@/lib/superAdmin/presentation";
import type { AdminOperatorActionPreview } from "@/lib/superAdmin/types";
import type { OperatorActionContextSection } from "@/lib/superAdmin/operatorSafety";

type OperatorActionDialogConfig = {
  actionLabel: string;
  confirmButtonLabel: string;
  description: string;
  id: string;
  initialReason?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  requestPreview: (reason: string) => Promise<AdminOperatorActionPreview>;
  sections?: OperatorActionContextSection[];
  title: string;
  onConfirm: (input: {
    confirmationText: string;
    preview: AdminOperatorActionPreview;
    reason: string;
    token: string | null;
  }) => Promise<void>;
};

type OperatorActionDialogProps = {
  config: OperatorActionDialogConfig | null;
  onOpenChange: (open: boolean) => void;
};

const toneClassName = (tone: OperatorActionContextSection["items"][number]["tone"]) => {
  if (tone === "critical") {
    return "text-destructive";
  }

  if (tone === "warning") {
    return "text-amber-700";
  }

  return "text-foreground";
};

const renderPreviewValue = (
  preview: AdminOperatorActionPreview,
  key: "riskLevel" | "duplicateRisk" | "idempotencyState" | "severity",
) => String(preview[key] ?? "n/a").replaceAll("_", " ");

const buildFinancialImpactLabel = (preview: AdminOperatorActionPreview) => {
  const financialImpact = preview.financialImpact;
  if (!financialImpact) {
    return "No direct financial delta";
  }

  if (financialImpact.amount == null) {
    return financialImpact.summary;
  }

  return `${formatInr(financialImpact.amount)} - ${financialImpact.summary}`;
};

export const OperatorActionDialog = ({
  config,
  onOpenChange,
}: OperatorActionDialogProps) => {
  const open = Boolean(config);
  const [reason, setReason] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [preview, setPreview] = useState<AdminOperatorActionPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewPending, setIsPreviewPending] = useState(false);
  const [isConfirmPending, setIsConfirmPending] = useState(false);

  useEffect(() => {
    if (!config) {
      setReason("");
      setConfirmationText("");
      setPreview(null);
      setErrorMessage(null);
      setIsPreviewPending(false);
      setIsConfirmPending(false);
      return;
    }

    setReason(config.initialReason ?? "");
    setConfirmationText("");
    setPreview(null);
    setErrorMessage(null);
    setIsPreviewPending(false);
    setIsConfirmPending(false);
  }, [config]);

  const requiresTypedConfirmation = Boolean(preview?.review?.confirmationRequired);
  const confirmationLabel = preview?.confirmationLabel ?? "";
  const approvalReady =
    !preview?.review?.approvalPolicy?.approvalRequired ||
    preview.review?.approvalStatus === "approved";
  const canConfirm =
    Boolean(preview) &&
    approvalReady &&
    (!requiresTypedConfirmation || confirmationText.trim().toUpperCase() === confirmationLabel.toUpperCase());

  const previewHighlights = useMemo(() => {
    if (!preview) {
      return [];
    }

    return [
      { label: "Risk", value: renderPreviewValue(preview, "riskLevel") },
      { label: "Duplicate risk", value: renderPreviewValue(preview, "duplicateRisk") },
      { label: "Idempotency", value: renderPreviewValue(preview, "idempotencyState") },
      { label: "Rollback", value: preview.rollbackSummary ?? (preview.reversible ? "Available" : "Limited") },
    ];
  }, [preview]);

  const handleReasonChange = (nextReason: string) => {
    setReason(nextReason);
    setConfirmationText("");
    setErrorMessage(null);
    setPreview((currentPreview) => (currentPreview ? null : currentPreview));
  };

  const handlePreview = async () => {
    if (!config) {
      return;
    }

    setIsPreviewPending(true);
    setErrorMessage(null);

    try {
      const nextPreview = await config.requestPreview(reason.trim());
      setPreview(nextPreview);
      setConfirmationText("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate the action preview.");
    } finally {
      setIsPreviewPending(false);
    }
  };

  const handleConfirm = async () => {
    if (!config || !preview) {
      return;
    }

    setIsConfirmPending(true);
    setErrorMessage(null);

    try {
      await config.onConfirm({
        confirmationText: confirmationText.trim(),
        preview,
        reason: reason.trim(),
        token: preview.token,
      });
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to complete the action.");
    } finally {
      setIsConfirmPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {config ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{config.title}</DialogTitle>
              <DialogDescription>{config.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Operator intent
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Capture the reason first, then generate the server preview before confirming the action.
                </p>
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {config.reasonLabel ?? "Reason"}
                  </p>
                  <Textarea
                    onChange={(event) => handleReasonChange(event.target.value)}
                    placeholder={
                      config.reasonPlaceholder ??
                      "Explain what changed, what you validated, and why this action is safe right now."
                    }
                    rows={4}
                    value={reason}
                  />
                </div>
              </div>

              {config.sections?.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {config.sections.map((section) => (
                    <div key={section.title} className="rounded-xl border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">{section.title}</p>
                      <div className="mt-3 space-y-3">
                        {section.items.map((item) => (
                          <div
                            key={`${section.title}-${item.label}`}
                            className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
                          >
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                              {item.label}
                            </p>
                            <p className={`text-right text-sm font-medium ${toneClassName(item.tone)}`}>
                              {item.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {preview ? (
                <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold text-foreground">Server preview</p>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{preview.summary}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={toBadgeVariant(preview.riskLevel || preview.severity)}>
                        {renderPreviewValue(preview, "riskLevel")}
                      </Badge>
                      <Badge variant={toBadgeVariant(preview.duplicateRisk)}>
                        {renderPreviewValue(preview, "duplicateRisk")}
                      </Badge>
                      <Badge variant={preview.reversible ? "default" : "outline"}>
                        {preview.reversible ? "Rollback available" : "Rollback limited"}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {previewHighlights.map((item) => (
                      <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                        <p className="mt-2 text-sm font-semibold capitalize text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Impact summary</p>
                      <div className="mt-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Target
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.targetDisplay || "n/a"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Blast radius
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.blastRadius?.summary || "Single governed target"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Financial impact
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {buildFinancialImpactLabel(preview)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Preview expires
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {formatDateTime(preview.previewExpiresAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Governance review</p>
                      <div className="mt-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Approval status
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.approvalStatus || "not_required"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Approval request
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.approvalRequestId || "n/a"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Workflow
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.approvalChainMode || "single"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Typed confirmation
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.typedConfirmationLabel || "Not required"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Reason
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.reasonRequired ? "Required" : "Optional"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Cooldown
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.cooldownSeconds
                              ? `${formatNumber(preview.review.cooldownSeconds)}s`
                              : "None"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Approval expiry
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {formatDateTime(preview.review?.approvalExpiresAt)}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Progress
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.approvedCount ?? 0}/{preview.review?.approvalStageCount ?? 1}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Emergency bypass
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.emergencyBypassEligible ? "Eligible" : "Not eligible"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Linked incident
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {preview.review?.linkedIncidentKey || "None"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            Related traces
                          </span>
                          <span className="text-right text-sm font-medium text-foreground">
                            {formatNumber(preview.traceLineage.length)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {preview.governance ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Governance consistency</p>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Snapshot</p>
                          <p className="mt-2 text-sm text-foreground">{preview.governance.authoritySummary}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Version</p>
                          <p className="mt-2 text-sm text-foreground">
                            {preview.governance.cacheInvalidationKey || preview.governance.governanceVersion || "n/a"}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Consistent at {formatDateTime(preview.governance.consistencyAt)}
                          </p>
                        </div>
                      </div>
                      {preview.governance.conflictSummary.length ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          {preview.governance.conflictSummary.join(" ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {preview.playbooks?.length ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Playbooks</p>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {preview.playbooks.map((playbook) => (
                          <div key={playbook.key} className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">{playbook.title}</p>
                              <Badge variant={toBadgeVariant(playbook.severity)}>{playbook.severity}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{playbook.guidance}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.impacts.length ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Expected impact</p>
                      <div className="mt-3 space-y-3">
                        {preview.impacts.map((impact) => (
                          <div
                            key={`${impact.label}-${impact.before}-${impact.after}`}
                            className="rounded-lg border border-border bg-muted/30 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">{impact.label}</p>
                              <Badge variant="outline">
                                {`${impact.before || "n/a"} -> ${impact.after || "n/a"}`}
                              </Badge>
                            </div>
                            {impact.detail ? (
                              <p className="mt-2 text-sm text-muted-foreground">{impact.detail}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.dependencyStatus?.length ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Dependencies</p>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {preview.dependencyStatus.map((dependency) => (
                          <div key={dependency.label} className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">{dependency.label}</p>
                              <Badge variant={toBadgeVariant(dependency.status)}>{dependency.value}</Badge>
                            </div>
                            {dependency.detail ? (
                              <p className="mt-2 text-sm text-muted-foreground">{dependency.detail}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.permissionExplanation ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Permission explainability</p>
                      <p className="mt-2 text-sm text-muted-foreground">{preview.permissionExplanation.summary}</p>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Role chain</p>
                          <p className="mt-2 text-sm text-foreground">
                            {preview.permissionExplanation.roleChain.join(", ") || "No granting role chain"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scope chain</p>
                          <p className="mt-2 text-sm text-foreground">
                            {preview.permissionExplanation.scopeChain.join(", ") || "Global scope"}
                          </p>
                        </div>
                      </div>
                      {preview.permissionExplanation.restrictionBoundaries.length ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          {preview.permissionExplanation.restrictionBoundaries.join(" ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {preview.warnings.length ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <p className="text-sm font-semibold text-foreground">Warnings</p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {preview.warnings.map((warning) => (
                          <p key={warning} className="text-sm text-destructive">
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.review?.approvalPolicy?.approvalRequired && preview.review?.approvalStatus !== "approved" ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      Execution is blocked until the approval workflow reaches an approved state.
                    </div>
                  ) : null}

                  {requiresTypedConfirmation ? (
                    <div className="rounded-lg border border-border p-4">
                      <p className="text-sm font-semibold text-foreground">Typed confirmation</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Type <span className="font-medium text-foreground">{confirmationLabel}</span> to confirm.
                      </p>
                      <Input
                        className="mt-3"
                        onChange={(event) => setConfirmationText(event.target.value)}
                        placeholder={confirmationLabel}
                        value={confirmationText}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <DialogFooter className="mt-2">
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Cancel
              </Button>
              <Button disabled={isPreviewPending || isConfirmPending} onClick={handlePreview} variant="outline">
                {isPreviewPending ? "Generating preview..." : "Generate preview"}
              </Button>
              <Button
                disabled={!canConfirm || isConfirmPending || isPreviewPending}
                onClick={() => void handleConfirm()}
              >
                {isConfirmPending ? `${config.actionLabel}...` : config.confirmButtonLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export type { OperatorActionDialogConfig };
