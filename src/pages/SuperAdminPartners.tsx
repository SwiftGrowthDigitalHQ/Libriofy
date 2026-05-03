import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BarChart3, Link2, Search, Settings2, Users2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPublicAppBaseUrl } from "@/lib/publicAppUrl";

type PartnerDashboardRow = {
  affiliate_id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  commission_rate: number;
  is_active: boolean;
  total_referrals: number;
  total_earnings: number;
  pending_payouts: number;
  created_at: string;
};

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const SuperAdminPartners = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [salesDialogOpen, setSalesDialogOpen] = useState(false);
  const [salesPartner, setSalesPartner] = useState<PartnerDashboardRow | null>(null);
  const [editing, setEditing] = useState<PartnerDashboardRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    commission_rate: "10",
    is_active: true,
    payout_method: "upi",
    upi_id: "",
  });

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["admin-partners"],
    queryFn: async (): Promise<PartnerDashboardRow[]> => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("admin_affiliate_dashboard" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        affiliate_id: String(row.affiliate_id),
        code: String(row.code ?? ""),
        name: String(row.name ?? ""),
        email: String(row.email ?? ""),
        phone: row.phone == null ? null : String(row.phone),
        city: row.city == null ? null : String(row.city),
        commission_rate: Number(row.commission_rate ?? 0),
        is_active: Boolean(row.is_active ?? true),
        total_referrals: Number(row.total_referrals ?? 0),
        total_earnings: Number(row.total_earnings ?? 0),
        pending_payouts: Number(row.pending_payouts ?? 0),
        created_at: String(row.created_at ?? ""),
      }));
    },
    staleTime: 30_000,
  });

  const totals = useMemo(
    () =>
      partners.reduce(
        (acc, row) => ({
          partners: acc.partners + 1,
          sales: acc.sales + (row.total_referrals || 0),
          earnings: acc.earnings + (row.total_earnings || 0),
          pending: acc.pending + (row.pending_payouts || 0),
        }),
        { partners: 0, sales: 0, earnings: 0, pending: 0 },
      ),
    [partners],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) =>
      `${p.code} ${p.name} ${p.email} ${p.phone ?? ""} ${p.city ?? ""}`.toLowerCase().includes(q),
    );
  }, [partners, search]);

  const referralBaseUrl = useMemo(() => {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : "";
    if (hostname === "partner.libriofy.com") return getPublicAppBaseUrl();
    if (hostname === "partner.localhost") return `${protocol}//localhost${port}`;
    return getPublicAppBaseUrl() || `${protocol}//${hostname}${port}`;
  }, []);

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ partnerId, isActive }: { partnerId: string; isActive: boolean }) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliates" as any)
        .update({ is_active: isActive })
        .eq("id", partnerId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
      toast({ title: "Partner updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const savePartnerMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No partner selected.");
      const name = form.name.trim();
      const email = form.email.trim().toLowerCase();
      const phone = form.phone.trim() || null;
      const city = form.city.trim() || null;
      const commissionRate = Number(form.commission_rate);
      const payout_method = form.payout_method.trim() || null;
      const upi_id = form.upi_id.trim() || null;

      if (!name) throw new Error("Name is required.");
      if (!email) throw new Error("Email is required.");
      if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        throw new Error("Commission rate must be between 0 and 100.");
      }

      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliates" as any)
        .update({
          name,
          email,
          phone,
          city,
          commission_rate: commissionRate,
          is_active: form.is_active,
          payout_method,
          upi_id,
        })
        .eq("id", editing.affiliate_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
      setDialogOpen(false);
      setEditing(null);
      toast({ title: "Partner saved" });
    },
    onError: (error: Error) => toast({ title: "Save failed", description: error.message, variant: "destructive" }),
  });

  const { data: partnerSales = [], isLoading: salesLoading } = useQuery({
    queryKey: ["admin-partner-sales", salesPartner?.affiliate_id],
    queryFn: async (): Promise<Array<Record<string, unknown>>> => {
      if (!salesPartner?.affiliate_id) return [];
      const { data, error } = await supabase
        .from("affiliate_commissions")
        .select("id, commission_rate, commission_earned, status, created_at, libraries(name, city), subscription_payments(amount)")
        .eq("affiliate_id", salesPartner.affiliate_id)
        .order("created_at", { ascending: false })
        .returns<Array<Record<string, unknown>>>();
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    },
    enabled: salesDialogOpen && !!salesPartner?.affiliate_id,
    staleTime: 15_000,
  });

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Partners</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage partners, commissions, and performance</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Partners</p>
              <p className="text-xl font-bold font-display">{totals.partners}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-xl font-bold font-display">{totals.sales}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Commission</p>
              <p className="text-xl font-bold font-display">{formatInr(totals.earnings)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Pending Payouts</p>
              <p className="text-xl font-bold font-display">{formatInr(totals.pending)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-[320px]">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search partners..." />
          </div>
          <Badge variant="outline" className="w-fit">
            <Users2 className="mr-2 h-3.5 w-3.5" /> {filtered.length} results
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">All Partners</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading partners...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No partners found.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Partner</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Earnings</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((partner) => {
                      const referralLink = `${referralBaseUrl}/signup?ref=${encodeURIComponent(partner.code)}`;
                      return (
                        <TableRow key={partner.affiliate_id}>
                          <TableCell>
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{partner.name}</span>
                                <Badge variant="secondary">{partner.code}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{partner.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-foreground">{partner.phone ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{partner.city ?? "—"}</p>
                          </TableCell>
                          <TableCell className="text-right">{partner.commission_rate}%</TableCell>
                          <TableCell className="text-right">{partner.total_referrals}</TableCell>
                          <TableCell className="text-right">{formatInr(partner.total_earnings)}</TableCell>
                          <TableCell className="text-right">{formatInr(partner.pending_payouts)}</TableCell>
                          <TableCell className="text-right">
                            <Switch
                              checked={partner.is_active}
                              onCheckedChange={(checked) =>
                                toggleActiveMutation.mutate({ partnerId: partner.affiliate_id, isActive: checked })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => {
                                  setSalesPartner(partner);
                                  setSalesDialogOpen(true);
                                }}
                                title="View sales"
                              >
                                <BarChart3 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(referralLink);
                                    toast({ title: "Copied", description: "Referral link copied." });
                                  } catch {
                                    toast({ title: "Copy failed", variant: "destructive" });
                                  }
                                }}
                                title="Copy referral link"
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>

                              <Dialog
                                open={dialogOpen && editing?.affiliate_id === partner.affiliate_id}
                                onOpenChange={(open) => {
                                  setDialogOpen(open);
                                  if (!open) setEditing(null);
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      const partnerId = partner.affiliate_id;
                                      setEditing(partner);
                                      setDialogOpen(true);
                                      setForm({
                                        name: partner.name,
                                        email: partner.email,
                                        phone: partner.phone ?? "",
                                        city: partner.city ?? "",
                                        commission_rate: String(partner.commission_rate ?? 10),
                                        is_active: partner.is_active,
                                        payout_method: "",
                                        upi_id: "",
                                      });

                                      void (async () => {
                                        const { data } = await supabase
                                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                          .from("affiliates" as any)
                                          .select("payout_method, upi_id")
                                          .eq("id", partnerId)
                                          .maybeSingle();
                                        if (!data) return;
                                        setForm((current) => ({
                                          ...current,
                                          payout_method: String((data as any).payout_method ?? "upi"),
                                          upi_id: String((data as any).upi_id ?? ""),
                                        }));
                                      })();
                                    }}
                                    title="Edit partner"
                                  >
                                    <Settings2 className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Edit partner</DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                        <Label>Name</Label>
                                        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Email</Label>
                                        <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Phone</Label>
                                        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>City</Label>
                                        <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Commission rate (%)</Label>
                                        <Input
                                          value={form.commission_rate}
                                          onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                                        />
                                      </div>
                                      <div className="flex items-center gap-3 pt-6">
                                        <Switch
                                          checked={form.is_active}
                                          onCheckedChange={(checked) => setForm({ ...form, is_active: checked })}
                                        />
                                        <span className="text-sm text-foreground">Active</span>
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Payout method</Label>
                                        <Input value={form.payout_method} onChange={(e) => setForm({ ...form, payout_method: e.target.value })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label>UPI ID</Label>
                                        <Input value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} />
                                      </div>
                                    </div>
                                    <div className="flex justify-end gap-2">
                                      <Button variant="outline" onClick={() => { setDialogOpen(false); setEditing(null); }}>
                                        Cancel
                                      </Button>
                                      <Button onClick={() => savePartnerMutation.mutate()} disabled={savePartnerMutation.isPending}>
                                        {savePartnerMutation.isPending ? "Saving..." : "Save"}
                                      </Button>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={salesDialogOpen}
          onOpenChange={(open) => {
            setSalesDialogOpen(open);
            if (!open) setSalesPartner(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                Sales — {salesPartner?.name ?? "Partner"} {salesPartner?.code ? `(${salesPartner.code})` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {salesLoading ? (
                <p className="text-sm text-muted-foreground">Loading sales...</p>
              ) : partnerSales.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Library</TableHead>
                        <TableHead className="text-right">Sale</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {partnerSales.map((row) => {
                        const libraryName = (row as any)?.libraries?.name ?? "Library";
                        const libraryCity = (row as any)?.libraries?.city ?? null;
                        const saleAmount = Number((row as any)?.subscription_payments?.amount ?? 0);
                        const commissionEarned = Number((row as any)?.commission_earned ?? 0);
                        const commissionRate = Number((row as any)?.commission_rate ?? 0);
                        const status = String((row as any)?.status ?? "pending");
                        const createdAt = String((row as any)?.created_at ?? "");

                        return (
                          <TableRow key={String((row as any)?.id)}>
                            <TableCell>
                              <div className="space-y-0.5">
                                <p className="font-medium text-foreground">{libraryName}</p>
                                <p className="text-xs text-muted-foreground">{libraryCity ?? "—"}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{formatInr(saleAmount)}</TableCell>
                            <TableCell className="text-right">
                              <div className="space-y-0.5">
                                <p className="font-medium text-foreground">{formatInr(commissionEarned)}</p>
                                <p className="text-xs text-muted-foreground">{commissionRate}%</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={status === "paid" ? "secondary" : "outline"}>{status}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {createdAt ? new Date(createdAt).toLocaleDateString("en-IN") : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSalesDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminPartners;
