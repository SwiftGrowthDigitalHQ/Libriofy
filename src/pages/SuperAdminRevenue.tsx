import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import RevenueChart from "@/components/dashboard/RevenueChart";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useControlPlane, useRevenue, useRevenueMutations } from "@/hooks/superAdmin";
import { formatDateTime, formatInr, formatNumber, toBadgeVariant } from "@/lib/superAdmin/presentation";

const readErrorStatus = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;

const SuperAdminRevenue = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("payouts");
  const [search, setSearch] = useState("");
  const [adjustmentLibraryId, setAdjustmentLibraryId] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [defaultCommissionPercent, setDefaultCommissionPercent] = useState("");

  const platformQuery = useControlPlane();
  const overviewQuery = useRevenue();
  const payoutsQuery = useRevenue({ enabled: activeTab === "payouts", query: { page: 1, pageSize: 8, scope: "payouts", search } });
  const adjustmentsQuery = useRevenue({ enabled: activeTab === "adjustments", query: { page: 1, pageSize: 8, scope: "adjustments", search } });
  const commissionsQuery = useRevenue({ enabled: activeTab === "commissions", query: { page: 1, pageSize: 8, scope: "commissions", search } });
  const paymentsQuery = useRevenue({ enabled: activeTab === "payments", query: { page: 1, pageSize: 8, scope: "payments", search } });
  const plansQuery = useRevenue({ enabled: activeTab === "plans", query: { page: 1, pageSize: 8, scope: "plans", search } });
  const { approveOrRejectPayout, saveCommission, saveRevenueAdjustment } = useRevenueMutations();

  const overview = "data" in (overviewQuery.data ?? {}) ? overviewQuery.data.data : overviewQuery.data;
  const pageError = platformQuery.error ?? overviewQuery.error;
  const hasAuthFailure = readErrorStatus(pageError) === 401;
  const isSummaryLoading = platformQuery.isLoading || overviewQuery.isLoading;
  const summaryFallbackValue = isSummaryLoading
    ? "Syncing"
    : hasAuthFailure
      ? "Session check required"
      : "Telemetry reconnecting";
  const dailyRevenueData = useMemo(
    () =>
      (platformQuery.data?.analytics.series ?? []).map((point) => ({
        currentMonthRevenue: point.totalRevenue,
        day: point.label,
        label: point.label,
        previousMonthRevenue: 0,
      })),
    [platformQuery.data?.analytics.series],
  );
  const monthlyRevenueData = useMemo(() => {
    const byMonth = new Map<string, number>();
    (platformQuery.data?.analytics.series ?? []).forEach((point) => {
      const key = point.date.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + point.totalRevenue);
    });

    return [...byMonth.entries()].slice(-6).map(([month, revenue]) => ({
      month: new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "short" }),
      revenue,
    }));
  }, [platformQuery.data?.analytics.series]);

  const handleAdjustmentSave = async () => {
    const amountDelta = Number(adjustmentAmount);
    if (!adjustmentLibraryId.trim() || !Number.isFinite(amountDelta) || !adjustmentReason.trim()) {
      toast({
        description: "Library ID, adjustment amount, and reason are required.",
        title: "Invalid adjustment",
        variant: "destructive",
      });
      return;
    }

    try {
      await saveRevenueAdjustment.mutateAsync({
        action: "revenue_adjustment",
        amountDelta,
        libraryId: adjustmentLibraryId.trim(),
        reason: adjustmentReason.trim(),
      });
      setAdjustmentAmount("");
      setAdjustmentLibraryId("");
      setAdjustmentReason("");
      toast({ title: "Revenue adjustment recorded" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to save the revenue adjustment.",
        title: "Adjustment failed",
        variant: "destructive",
      });
    }
  };

  const handleCommissionSave = async () => {
    const parsed = Number(defaultCommissionPercent);
    if (!Number.isFinite(parsed)) {
      toast({
        description: "Enter a valid default commission rate.",
        title: "Invalid commission",
        variant: "destructive",
      });
      return;
    }

    try {
      await saveCommission.mutateAsync({
        action: "commission_update",
        defaultCommissionPercent: parsed,
      });
      toast({ title: "Default commission updated" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update the default commission.",
        title: "Commission update failed",
        variant: "destructive",
      });
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          description="Centralized revenue controls for payouts, commissions, adjustments, and platform earnings."
          title="Revenue"
        />

        {pageError && !overview ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {hasAuthFailure ? "Super admin verification is required" : "Revenue telemetry is temporarily unavailable"}
            </AlertTitle>
            <AlertDescription>
              {pageError.message}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <ControlPlaneCard title="Total revenue">
            <p className="text-2xl font-bold font-display text-foreground">
              {overview ? formatInr(overview.summary.totalRevenue) : summaryFallbackValue}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Student payments">
            <p className="text-2xl font-bold font-display text-foreground">
              {overview ? formatInr(overview.summary.studentRevenue) : summaryFallbackValue}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Subscriptions">
            <p className="text-2xl font-bold font-display text-foreground">
              {overview ? formatInr(overview.summary.subscriptionRevenue) : summaryFallbackValue}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Adjustments">
            <p className="text-2xl font-bold font-display text-foreground">
              {overview ? formatInr(overview.summary.adjustmentRevenue) : summaryFallbackValue}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Queued payouts">
            <p className="text-2xl font-bold font-display text-foreground">
              {overview ? formatInr(overview.summary.queuedPayoutAmount) : summaryFallbackValue}
            </p>
          </ControlPlaneCard>
        </div>

        <RevenueChart
          dailyData={dailyRevenueData}
          data={monthlyRevenueData}
          subtitle="Control-plane revenue from the shared admin analytics series."
          title="Revenue Trend"
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Revenue controls">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="default-commission">Default commission (%)</Label>
                <Input
                  id="default-commission"
                  onChange={(event) => setDefaultCommissionPercent(event.target.value)}
                  placeholder={String(overview?.defaultCommissionPercent ?? 12.5)}
                  value={defaultCommissionPercent}
                />
                <Button disabled={saveCommission.isPending} onClick={handleCommissionSave}>
                  Save commission
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="adjustment-library-id">Revenue adjustment</Label>
                <Input
                  id="adjustment-library-id"
                  onChange={(event) => setAdjustmentLibraryId(event.target.value)}
                  placeholder="Library ID"
                  value={adjustmentLibraryId}
                />
                <Input
                  onChange={(event) => setAdjustmentAmount(event.target.value)}
                  placeholder="Amount delta"
                  value={adjustmentAmount}
                />
                <Textarea
                  onChange={(event) => setAdjustmentReason(event.target.value)}
                  placeholder="Why is this adjustment needed?"
                  rows={3}
                  value={adjustmentReason}
                />
                <Button disabled={saveRevenueAdjustment.isPending} onClick={handleAdjustmentSave}>
                  Record adjustment
                </Button>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Revenue data">
            <div className="space-y-4">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search payouts, commissions, adjustments, or plans"
                value={search}
              />

              <Tabs onValueChange={setActiveTab} value={activeTab}>
                <TabsList>
                  <TabsTrigger value="payouts">Payouts</TabsTrigger>
                  <TabsTrigger value="commissions">Commissions</TabsTrigger>
                  <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="plans">Plans</TabsTrigger>
                </TabsList>

                <TabsContent value="payouts">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Library</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Requested</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (payoutsQuery.data ?? {}) &&
                          payoutsQuery.data.items.items.map((payout) => (
                            <TableRow key={payout.id}>
                              <TableCell>{payout.libraryName || payout.libraryId}</TableCell>
                              <TableCell>
                                <Badge variant={toBadgeVariant(payout.status)}>{payout.status}</Badge>
                              </TableCell>
                              <TableCell>{formatDateTime(payout.requestedAt)}</TableCell>
                              <TableCell>{formatInr(payout.amount)}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  {payout.status === "queued" ? (
                                    <>
                                      <Button
                                        onClick={() =>
                                          approveOrRejectPayout.mutate({
                                            action: "payout_action",
                                            libraryId: payout.libraryId,
                                            payoutAction: "approve_payout",
                                            payoutId: payout.id,
                                          })
                                        }
                                        size="sm"
                                        variant="outline"
                                      >
                                        Approve
                                      </Button>
                                      <Button
                                        onClick={() =>
                                          approveOrRejectPayout.mutate({
                                            action: "payout_action",
                                            libraryId: payout.libraryId,
                                            payoutAction: "reject_payout",
                                            payoutId: payout.id,
                                          })
                                        }
                                        size="sm"
                                        variant="outline"
                                      >
                                        Reject
                                      </Button>
                                    </>
                                  ) : payout.status === "approved" ? (
                                    <Button
                                      onClick={() =>
                                        approveOrRejectPayout.mutate({
                                          action: "payout_action",
                                          libraryId: payout.libraryId,
                                          payoutAction: "mark_payout_paid",
                                          payoutId: payout.id,
                                        })
                                      }
                                      size="sm"
                                    >
                                      Mark paid
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="commissions">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Library</TableHead>
                          <TableHead>Commission</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead>Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (commissionsQuery.data ?? {}) &&
                          commissionsQuery.data.items.items.map((item) => (
                            <TableRow key={item.libraryId}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell>{item.commissionPercent}%</TableCell>
                              <TableCell>{item.notes || "—"}</TableCell>
                              <TableCell>{formatDateTime(item.updatedAt)}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="adjustments">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Library</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (adjustmentsQuery.data ?? {}) &&
                          adjustmentsQuery.data.items.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell>{item.reason}</TableCell>
                              <TableCell>{formatInr(item.amountDelta)}</TableCell>
                              <TableCell>{formatDateTime(item.createdAt)}</TableCell>
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
                          <TableHead>Amount</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (paymentsQuery.data ?? {}) &&
                          paymentsQuery.data.items.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell>{item.paymentType}</TableCell>
                              <TableCell>
                                <Badge variant={toBadgeVariant(item.status)}>{item.status}</Badge>
                              </TableCell>
                              <TableCell>{formatInr(item.amount)}</TableCell>
                              <TableCell>{formatDateTime(item.createdAt)}</TableCell>
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (plansQuery.data ?? {}) &&
                          plansQuery.data.items.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-foreground">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">{item.code}</p>
                                </div>
                              </TableCell>
                              <TableCell>{formatInr(item.price)}</TableCell>
                              <TableCell>{formatNumber(item.seatsLimit ?? 0)}</TableCell>
                              <TableCell>{formatNumber(item.lockersLimit ?? 0)}</TableCell>
                              <TableCell>
                                <Badge variant={item.isActive ? "default" : "outline"}>
                                  {item.isActive ? "Active" : "Disabled"}
                                </Badge>
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
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminRevenue;
