import { useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useRevenue, useRevenueMutations } from "@/hooks/superAdmin";
import { formatDateTime, formatInr, formatNumber, toBadgeVariant } from "@/lib/superAdmin/presentation";

const SuperAdminRevenue = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("plans");
  const [search, setSearch] = useState("");
  const [adjustmentLibraryId, setAdjustmentLibraryId] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [defaultCommissionPercent, setDefaultCommissionPercent] = useState("");

  const overviewQuery = useRevenue<"overview">();
  const plansQuery = useRevenue({ enabled: activeTab === "plans", query: { page: 1, pageSize: 20, scope: "plans", search } });
  const paymentsQuery = useRevenue({ enabled: activeTab === "payments", query: { page: 1, pageSize: 15, scope: "payments", search } });
  const adjustmentsQuery = useRevenue({ enabled: activeTab === "adjustments", query: { page: 1, pageSize: 10, scope: "adjustments", search } });
  const commissionsQuery = useRevenue({ enabled: activeTab === "commissions", query: { page: 1, pageSize: 10, scope: "commissions", search } });
  const { saveCommission, saveRevenueAdjustment } = useRevenueMutations();

  const overview = overviewQuery.data?.data;
  const isLoading = overviewQuery.isLoading;
  const pageError = overviewQuery.error ?? plansQuery.error;
  const isAuthError = pageError && "status" in (pageError as any) && (pageError as any).status === 401;

  const handleAdjustmentSave = async () => {
    const amountDelta = Number(adjustmentAmount);
    if (!adjustmentLibraryId.trim() || !Number.isFinite(amountDelta) || !adjustmentReason.trim()) {
      toast({ description: "Library ID, amount, and reason are required.", title: "Invalid adjustment", variant: "destructive" });
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
      toast({ description: error instanceof Error ? error.message : "Failed to save adjustment.", title: "Error", variant: "destructive" });
    }
  };

  const handleCommissionSave = async () => {
    const parsed = Number(defaultCommissionPercent);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      toast({ description: "Enter a valid commission rate (0-100).", title: "Invalid commission", variant: "destructive" });
      return;
    }

    try {
      await saveCommission.mutateAsync({ action: "commission_update", defaultCommissionPercent: parsed });
      toast({ title: "Default commission updated" });
    } catch (error) {
      toast({ description: error instanceof Error ? error.message : "Failed to update commission.", title: "Error", variant: "destructive" });
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-foreground">Plans & Revenue</h1>
          <p className="text-sm text-muted-foreground">Manage subscription plans, view revenue, and record adjustments.</p>
        </div>

        {isAuthError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Session expired. Please sign in again.</p>
            <p className="mt-1 text-xs text-muted-foreground">Admin APIs require an active super admin session.</p>
          </div>
        ) : pageError && !isLoading ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-4 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Failed to load data</p>
            <p className="mt-1 text-xs text-muted-foreground">{pageError.message || "An unexpected error occurred."}</p>
          </div>
        ) : null}

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-bold">{isLoading ? "—" : formatInr(overview?.summary.totalRevenue ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Student Payments</p>
              <p className="text-2xl font-bold">{isLoading ? "—" : formatInr(overview?.summary.studentRevenue ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Subscriptions</p>
              <p className="text-2xl font-bold">{isLoading ? "—" : formatInr(overview?.summary.subscriptionRevenue ?? 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Default Commission</p>
              <p className="text-2xl font-bold">{isLoading ? "—" : `${overview?.defaultCommissionPercent ?? 12.5}%`}</p>
            </CardContent>
          </Card>
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_2.5fr]">
          {/* Controls sidebar */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Commission Rate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  onChange={(e) => setDefaultCommissionPercent(e.target.value)}
                  placeholder={String(overview?.defaultCommissionPercent ?? 12.5)}
                  type="number"
                  value={defaultCommissionPercent}
                />
                <Button className="w-full" disabled={saveCommission.isPending} onClick={handleCommissionSave} size="sm">
                  Update
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Revenue Adjustment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input onChange={(e) => setAdjustmentLibraryId(e.target.value)} placeholder="Library ID" value={adjustmentLibraryId} />
                <Input onChange={(e) => setAdjustmentAmount(e.target.value)} placeholder="Amount (±)" type="number" value={adjustmentAmount} />
                <Textarea onChange={(e) => setAdjustmentReason(e.target.value)} placeholder="Reason" rows={2} value={adjustmentReason} />
                <Button className="w-full" disabled={saveRevenueAdjustment.isPending} onClick={handleAdjustmentSave} size="sm">
                  Record Adjustment
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Data tables */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-4">
                <Input onChange={(e) => setSearch(e.target.value)} placeholder="Search..." value={search} />
              </div>

              <Tabs onValueChange={setActiveTab} value={activeTab}>
                <TabsList>
                  <TabsTrigger value="plans">Plans</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
                  <TabsTrigger value="commissions">Commissions</TabsTrigger>
                </TabsList>

                <TabsContent value="plans">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Plan</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Seats</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plansQuery.isLoading ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading plans...</TableCell></TableRow>
                        ) : plansQuery.isError ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-destructive py-8">Failed to load subscription plans. {plansQuery.error?.message}</TableCell></TableRow>
                        ) : (plansQuery.data?.items?.items ?? []).length > 0 ? (
                          (plansQuery.data?.items?.items ?? []).map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <p className="font-medium">{item.name}</p>
                                <p className="text-xs text-muted-foreground">{item.code}</p>
                              </TableCell>
                              <TableCell>{formatInr(item.price)}</TableCell>
                              <TableCell>{item.seatsLimit ?? "∞"}</TableCell>
                              <TableCell>
                                <Badge variant={item.isActive ? "default" : "outline"}>{item.isActive ? "Active" : "Disabled"}</Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No plans configured yet</TableCell></TableRow>
                        )}
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
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paymentsQuery.isLoading ? (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                        ) : paymentsQuery.isError ? (
                          <TableRow><TableCell colSpan={5} className="text-center text-destructive py-8">Failed to load payments. {paymentsQuery.error?.message}</TableCell></TableRow>
                        ) : (paymentsQuery.data?.items?.items ?? []).length > 0 ? (
                          (paymentsQuery.data?.items?.items ?? []).map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell className="text-xs">{item.paymentType === "subscription_payment" ? "Subscription" : "Student"}</TableCell>
                              <TableCell><Badge variant={toBadgeVariant(item.status)}>{item.status}</Badge></TableCell>
                              <TableCell>{formatInr(item.amount)}</TableCell>
                              <TableCell className="text-xs">{formatDateTime(item.createdAt)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No payments found</TableCell></TableRow>
                        )}
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
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustmentsQuery.isLoading ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                        ) : adjustmentsQuery.isError ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-destructive py-8">Failed to load adjustments.</TableCell></TableRow>
                        ) : (adjustmentsQuery.data?.items?.items ?? []).length > 0 ? (
                          (adjustmentsQuery.data?.items?.items ?? []).map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell>{item.reason}</TableCell>
                              <TableCell>{formatInr(item.amountDelta)}</TableCell>
                              <TableCell className="text-xs">{formatDateTime(item.createdAt)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No adjustments</TableCell></TableRow>
                        )}
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
                        {commissionsQuery.isLoading ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                        ) : commissionsQuery.isError ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-destructive py-8">Failed to load commissions.</TableCell></TableRow>
                        ) : (commissionsQuery.data?.items?.items ?? []).length > 0 ? (
                          (commissionsQuery.data?.items?.items ?? []).map((item) => (
                            <TableRow key={item.libraryId}>
                              <TableCell>{item.libraryName || item.libraryId}</TableCell>
                              <TableCell>{item.commissionPercent}%</TableCell>
                              <TableCell>{item.notes || "—"}</TableCell>
                              <TableCell className="text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No overrides</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminRevenue;
