import { useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { OperatorActionDialog, type OperatorActionDialogConfig } from "@/components/superAdmin/OperatorActionDialog";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SuperAdminSnapshotNotice } from "@/components/superAdmin/SuperAdminSnapshotNotice";
import { useToast } from "@/hooks/use-toast";
import { useBilling, useBillingDownload, useBillingMutations, useRevenue, useSecurity } from "@/hooks/superAdmin";
import {
  SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED,
  resolveSuperAdminSnapshotRefresh,
} from "@/lib/superAdmin/lightweightMode";
import {
  buildPriorOperatorActions,
  buildRuntimeDependencyStatus,
  hydrateOperatorPreview,
} from "@/lib/superAdmin/operatorPreview";
import {
  extractOperatorActionPreview,
  resolveOperatorPlaybooks,
  type OperatorActionContextSection,
} from "@/lib/superAdmin/operatorSafety";
import { formatDateTime, formatInr, formatNumber, saveBlob, toBadgeVariant } from "@/lib/superAdmin/presentation";
import type { AdminBillingPaymentRow } from "@/lib/superAdmin/types";

const SuperAdminBilling = () => {
  const { toast } = useToast();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED);
  const [activeTab, setActiveTab] = useState("invoices");
  const [actionDialog, setActionDialog] = useState<OperatorActionDialogConfig | null>(null);
  const [search, setSearch] = useState("");
  const [selectedPayment, setSelectedPayment] = useState<AdminBillingPaymentRow | null>(null);
  const [invoiceLibraryId, setInvoiceLibraryId] = useState("");
  const [invoiceSubtotal, setInvoiceSubtotal] = useState("");
  const [refundLibraryId, setRefundLibraryId] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [planForm, setPlanForm] = useState({
    code: "",
    description: "",
    features: "",
    isActive: true,
    lockersLimit: "",
    name: "",
    price: "",
    seatsLimit: "",
    sortOrder: "100",
  });

  const refetchIntervalMs = resolveSuperAdminSnapshotRefresh(autoRefreshEnabled);

  const billingOverviewQuery = useBilling({
    query: { page: 1, pageSize: 1, scope: "invoices" },
    refetchIntervalMs,
  });
  const invoicesQuery = useBilling({
    enabled: activeTab === "invoices",
    query: { page: 1, pageSize: 10, scope: "invoices", search },
    refetchIntervalMs,
  });
  const refundsQuery = useBilling({
    enabled: activeTab === "refunds",
    query: { page: 1, pageSize: 10, scope: "refunds", search },
    refetchIntervalMs,
  });
  const paymentsQuery = useBilling({
    enabled: activeTab === "payments",
    query: { page: 1, pageSize: 25, scope: "payments", search },
    refetchIntervalMs,
  });
  const plansQuery = useRevenue({
    enabled: activeTab === "plans",
    query: { page: 1, pageSize: 10, scope: "plans", search },
  });
  const securityQuery = useSecurity({ refetchIntervalMs });
  const { createInvoice, deletePlan, processRefund, upsertPlan } = useBillingMutations();
  const downloadBilling = useBillingDownload();
  const paymentOperations = billingOverviewQuery.data?.operations;
  const runtimeVisibility = securityQuery.data?.runtimeVisibility;
  const runtimeGovernance = paymentOperations
    ? { billingMutationsEnabled: paymentOperations.billingMutationsEnabled }
    : null;

  const handleInvoiceCreate = async () => {
    const subtotal = Number(invoiceSubtotal);
    if (!invoiceLibraryId.trim() || !Number.isFinite(subtotal) || subtotal <= 0) {
      toast({
        description: "Library ID and a positive subtotal are required.",
        title: "Invalid invoice",
        variant: "destructive",
      });
      return;
    }

    try {
      await createInvoice.mutateAsync({
        action: "create_invoice",
        libraryId: invoiceLibraryId.trim(),
        subtotal,
      });
      setInvoiceLibraryId("");
      setInvoiceSubtotal("");
      toast({ title: "Invoice created" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to create the invoice.",
        title: "Invoice failed",
        variant: "destructive",
      });
    }
  };

  const buildRefundSections = (): OperatorActionContextSection[] => [
    {
      items: [
        {
          label: "Library",
          value: refundLibraryId.trim() || "n/a",
        },
        {
          label: "Amount",
          value: formatInr(Number(refundAmount) || 0),
        },
        {
          label: "Reason",
          tone: refundReason.trim() ? "default" : "warning",
          value: refundReason.trim() || "Reason not captured yet",
        },
      ],
      title: "Affected entities",
    },
    {
      items: [
        {
          label: "Billing mutations",
          tone: runtimeGovernance?.billingMutationsEnabled === false ? "critical" : "default",
          value: runtimeGovernance?.billingMutationsEnabled === false ? "Stopped" : "Enabled",
        },
        {
          label: "Payment retry rate",
          tone: (paymentOperations?.paymentRetryRate ?? 0) >= 20 ? "warning" : "default",
          value: `${formatNumber(paymentOperations?.paymentRetryRate ?? 0)}%`,
        },
        {
          label: "Recent refund actions",
          value:
            buildPriorOperatorActions(
              securityQuery.data?.operatorTimeline,
              (entry) =>
                entry.targetType === "billing_refund" &&
                (entry.targetDisplay === refundLibraryId.trim() ||
                  String(entry.metadata.library_id || "") === refundLibraryId.trim()),
              2,
            )
              .map((entry) => `${entry.action} at ${formatDateTime(entry.occurredAt)}`)
              .join(" | ") || "No recent refund overrides for this library",
        },
      ],
      title: "Financial context",
    },
  ];

  const handleRefundCreate = async () => {
    const amount = Number(refundAmount);
    if (!refundLibraryId.trim() || !Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) {
      toast({
        description: "Library ID, amount, and reason are required.",
        title: "Invalid refund",
        variant: "destructive",
      });
      return;
    }

    setActionDialog({
      actionLabel: "Processing refund",
      confirmButtonLabel: "Process refund",
      description:
        "Refund execution now runs through a dry-run preview so duplicate risk, financial impact, and runtime playbooks are visible before money state changes.",
      id: `refund-${refundLibraryId.trim()}-${amount}`,
      initialReason: refundReason.trim(),
      requestPreview: async (reason) => {
        const response = await processRefund.mutateAsync({
          action: "process_refund",
          amount,
          dryRun: true,
          libraryId: refundLibraryId.trim(),
          reason: reason || refundReason.trim(),
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for the refund.");
        }

        return hydrateOperatorPreview(preview, {
          affectedEntities: [
            {
              id: refundLibraryId.trim(),
              kind: "library",
              label: refundLibraryId.trim(),
              status: "refund_target",
            },
          ],
          blastRadius: {
            affectedCount: 1,
            scope: "single",
            summary: "Single library billing target",
          },
          dependencyStatus: buildRuntimeDependencyStatus({
            runtimeGovernance,
            runtimeVisibility,
          }),
          financialImpact: {
            amount,
            currency: "INR",
            summary: "Direct refund override",
          },
          playbooks: resolveOperatorPlaybooks({
            actionId: preview.actionId,
            preview,
            runtimeGovernance,
            runtimeVisibility,
          }),
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) =>
              entry.targetType === "billing_refund" &&
              (entry.targetDisplay === refundLibraryId.trim() ||
                String(entry.metadata.library_id || "") === refundLibraryId.trim()),
          ),
        });
      },
      sections: buildRefundSections(),
      title: "Review refund override",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await processRefund.mutateAsync({
          action: "process_refund",
          actionToken: token,
          amount,
          confirmationText,
          libraryId: refundLibraryId.trim(),
          reason: reason || refundReason.trim(),
        });
        setRefundAmount("");
        setRefundLibraryId("");
        setRefundReason("");
        toast({ title: "Refund recorded" });
      },
    });
  };

  const handlePlanSave = async () => {
    const price = Number(planForm.price);
    const seatsLimit = planForm.seatsLimit.trim() ? Number(planForm.seatsLimit) : null;
    const lockersLimit = planForm.lockersLimit.trim() ? Number(planForm.lockersLimit) : null;
    const sortOrder = Number(planForm.sortOrder);
    if (!planForm.code.trim() || !planForm.name.trim() || !Number.isFinite(price)) {
      toast({
        description: "Plan code, name, and price are required.",
        title: "Invalid plan",
        variant: "destructive",
      });
      return;
    }

    try {
      await upsertPlan.mutateAsync({
        action: "upsert_plan",
        code: planForm.code.trim(),
        description: planForm.description.trim() || null,
        features: planForm.features
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        isActive: planForm.isActive,
        lockersLimit,
        name: planForm.name.trim(),
        price,
        seatsLimit,
        sortOrder,
      });
      setPlanForm({
        code: "",
        description: "",
        features: "",
        isActive: true,
        lockersLimit: "",
        name: "",
        price: "",
        seatsLimit: "",
        sortOrder: "100",
      });
      toast({ title: "Plan saved" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to save the plan.",
        title: "Plan failed",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async (format: "csv" | "pdf", invoiceId?: string) => {
    try {
      const result = await downloadBilling.mutateAsync({
        format,
        invoiceId,
        scope: invoiceId ? "invoices" : "payments",
      });
      saveBlob(result.blob, result.fileName);
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to download the report.",
        title: "Download failed",
        variant: "destructive",
      });
    }
  };

  const handleRefresh = async () => {
    const refreshes: Array<Promise<unknown>> = [
      billingOverviewQuery.refetch(),
      securityQuery.refetch(),
    ];

    if (activeTab === "invoices") {
      refreshes.push(invoicesQuery.refetch());
    } else if (activeTab === "refunds") {
      refreshes.push(refundsQuery.refetch());
    } else if (activeTab === "payments") {
      refreshes.push(paymentsQuery.refetch());
    } else if (activeTab === "plans") {
      refreshes.push(plansQuery.refetch());
    }

    await Promise.all(refreshes);
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Auto-refresh</span>
                <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
              </div>
              <Button onClick={() => void handleRefresh()} variant="outline">
                Refresh snapshot
              </Button>
              <Button onClick={() => handleDownload("csv")} variant="outline">
                Export payments CSV
              </Button>
            </>
          }
          description="Operational billing workflows, duplicate detection, reconciliation state, retry visibility, and payment trace inspection."
          title="Billing"
        />

        <SuperAdminSnapshotNotice
          description="Billing telemetry is running in cached snapshot mode so refunds, invoices, and reconciliation views stop hammering Supabase between operator actions."
          generatedAt={billingOverviewQuery.data?.generatedAt ?? securityQuery.data?.generatedAt}
          refreshIntervalMs={refetchIntervalMs}
          title="Operational analytics running in lightweight mode."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <ControlPlaneCard title="Pending payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.pendingPayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Failed payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.failedPayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Reconciled payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.reconciledPayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Webhook failures">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.webhookDeliveryFailures ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Retry rate">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.paymentRetryRate ?? 0)}%
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Duplicate payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.duplicatePayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Manual review">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.manualReviewPayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Stuck payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.stuckPayments ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Webhook retries">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(paymentOperations?.webhookRetries ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Mutations">
            <Badge variant={paymentOperations?.billingMutationsEnabled ? "default" : "destructive"}>
              {paymentOperations?.billingMutationsEnabled ? "Enabled" : "Emergency stop"}
            </Badge>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Billing operations">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="invoice-library-id">Create invoice</Label>
                <Input
                  id="invoice-library-id"
                  onChange={(event) => setInvoiceLibraryId(event.target.value)}
                  placeholder="Library ID"
                  value={invoiceLibraryId}
                />
                <Input
                  onChange={(event) => setInvoiceSubtotal(event.target.value)}
                  placeholder="Subtotal"
                  value={invoiceSubtotal}
                />
                <Button disabled={createInvoice.isPending} onClick={handleInvoiceCreate}>
                  Create invoice
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refund-library-id">Process refund</Label>
                <Input
                  id="refund-library-id"
                  onChange={(event) => setRefundLibraryId(event.target.value)}
                  placeholder="Library ID"
                  value={refundLibraryId}
                />
                <Input
                  onChange={(event) => setRefundAmount(event.target.value)}
                  placeholder="Refund amount"
                  value={refundAmount}
                />
                <Textarea
                  onChange={(event) => setRefundReason(event.target.value)}
                  placeholder="Refund reason"
                  rows={3}
                  value={refundReason}
                />
                <Button disabled={processRefund.isPending} onClick={handleRefundCreate}>
                  Process refund
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="plan-code">Save plan</Label>
                <Input
                  id="plan-code"
                  onChange={(event) => setPlanForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="Code"
                  value={planForm.code}
                />
                <Input
                  onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Plan name"
                  value={planForm.name}
                />
                <Input
                  onChange={(event) => setPlanForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder="Price"
                  value={planForm.price}
                />
                <Input
                  onChange={(event) => setPlanForm((current) => ({ ...current, seatsLimit: event.target.value }))}
                  placeholder="Seats limit"
                  value={planForm.seatsLimit}
                />
                <Input
                  onChange={(event) => setPlanForm((current) => ({ ...current, lockersLimit: event.target.value }))}
                  placeholder="Lockers limit"
                  value={planForm.lockersLimit}
                />
                <Textarea
                  onChange={(event) => setPlanForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Description"
                  rows={2}
                  value={planForm.description}
                />
                <Textarea
                  onChange={(event) => setPlanForm((current) => ({ ...current, features: event.target.value }))}
                  placeholder="One feature per line"
                  rows={4}
                  value={planForm.features}
                />
                <Button disabled={upsertPlan.isPending} onClick={handlePlanSave}>
                  Save plan
                </Button>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Billing data">
            <div className="space-y-4">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search invoices, refunds, payments, or plans"
                value={search}
              />

              <Tabs onValueChange={setActiveTab} value={activeTab}>
                <TabsList>
                  <TabsTrigger value="invoices">Invoices</TabsTrigger>
                  <TabsTrigger value="refunds">Refunds</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="plans">Plans</TabsTrigger>
                </TabsList>

                <TabsContent value="invoices">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Library</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoicesQuery.data?.items.items.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{invoice.invoiceNumber}</p>
                                <p className="text-xs text-muted-foreground">{invoice.invoiceType}</p>
                              </div>
                            </TableCell>
                            <TableCell>{invoice.libraryName || invoice.libraryId}</TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(invoice.status)}>{invoice.status}</Badge>
                            </TableCell>
                            <TableCell>{formatInr(invoice.totalAmount)}</TableCell>
                            <TableCell>{formatDateTime(invoice.issuedAt)}</TableCell>
                            <TableCell className="text-right">
                              <Button onClick={() => handleDownload("pdf", invoice.id)} size="sm" variant="outline">
                                PDF
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="refunds">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Library</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Processed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {refundsQuery.data?.items.items.map((refund) => (
                          <TableRow key={refund.id}>
                            <TableCell>{refund.libraryName || refund.libraryId}</TableCell>
                            <TableCell>{refund.reason}</TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(refund.status)}>{refund.status}</Badge>
                            </TableCell>
                            <TableCell>{formatInr(refund.amount)}</TableCell>
                            <TableCell>{formatDateTime(refund.processedAt || refund.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="payments">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Library</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Duplicate</TableHead>
                          <TableHead>Reconciliation</TableHead>
                          <TableHead>Retries</TableHead>
                          <TableHead>Capture source</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentsQuery.data?.items.items.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>{payment.libraryName || payment.libraryId}</TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-foreground">{payment.paymentType}</p>
                                <p className="text-xs text-muted-foreground">{formatInr(payment.amount)}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(payment.status)}>{payment.status}</Badge>
                            </TableCell>
                            <TableCell>{payment.duplicateDetected ? `${payment.duplicateCount} dupes` : "No"}</TableCell>
                            <TableCell>
                              <Badge variant={toBadgeVariant(payment.reconciliationStatus)}>
                                {payment.reconciliationStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatNumber(payment.retryCount)}</TableCell>
                            <TableCell>{payment.captureSource || "n/a"}</TableCell>
                            <TableCell className="text-right">
                              <Button onClick={() => setSelectedPayment(payment)} size="sm" variant="outline">
                                Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="plans">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Plan</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Seats</TableHead>
                          <TableHead>Lockers</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (plansQuery.data ?? {}) &&
                          plansQuery.data.items.items.map((plan) => (
                            <TableRow key={plan.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-foreground">{plan.name}</p>
                                  <p className="text-xs text-muted-foreground">{plan.code}</p>
                                </div>
                              </TableCell>
                              <TableCell>{formatInr(plan.price)}</TableCell>
                              <TableCell>{formatNumber(plan.seatsLimit ?? 0)}</TableCell>
                              <TableCell>{formatNumber(plan.lockersLimit ?? 0)}</TableCell>
                              <TableCell>
                                <Badge variant={plan.isActive ? "default" : "outline"}>
                                  {plan.isActive ? "Active" : "Disabled"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  onClick={() => deletePlan.mutate({ action: "delete_plan", planId: plan.id })}
                                  size="sm"
                                  variant="outline"
                                >
                                  Delete
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ControlPlaneCard>
        </div>

        <Sheet onOpenChange={(open) => !open && setSelectedPayment(null)} open={!!selectedPayment}>
          <SheetContent className="w-full sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle className="font-display">Payment operations</SheetTitle>
            </SheetHeader>

            {selectedPayment ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-lg font-semibold text-foreground">
                      {selectedPayment.libraryName || selectedPayment.libraryId}
                    </p>
                    <Badge variant={toBadgeVariant(selectedPayment.reconciliationStatus)}>
                      {selectedPayment.reconciliationStatus}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Payment reference</p>
                      <p className="font-medium text-foreground">{selectedPayment.reference || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Capture source</p>
                      <p className="font-medium text-foreground">{selectedPayment.captureSource || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Verification attempts</p>
                      <p className="font-medium text-foreground">{formatNumber(selectedPayment.verificationAttempts)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Webhook attempts</p>
                      <p className="font-medium text-foreground">{formatNumber(selectedPayment.webhookAttempts)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Request ID</p>
                      <p className="font-medium text-foreground">{selectedPayment.captureRequestId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Correlation ID</p>
                      <p className="font-medium text-foreground">{selectedPayment.captureCorrelationId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Trace ID</p>
                      <p className="font-medium text-foreground">{selectedPayment.captureTraceId || "n/a"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Stuck reason</p>
                      <p className="font-medium text-foreground">{selectedPayment.stuckReason || "n/a"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium text-foreground">Lifecycle timeline</p>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {JSON.stringify(selectedPayment.lifecycleTimeline, null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>

        <OperatorActionDialog
          config={actionDialog}
          onOpenChange={(open) => {
            if (!open) {
              setActionDialog(null);
            }
          }}
        />
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminBilling;
