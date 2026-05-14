import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Percent, Tag, Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

type CouponRow = {
  id: string;
  code: string;
  discount_type: "percentage" | "flat";
  discount_value: number;
  expires_at: string | null;
  max_uses: number | null;
  is_active: boolean;
  created_at: string;
  usage_count?: number;
};

type CouponFormData = {
  code: string;
  discount_type: "percentage" | "flat";
  discount_value: string;
  expires_at: string;
  max_uses: string;
  is_active: boolean;
};

const EMPTY_FORM: CouponFormData = {
  code: "",
  discount_type: "percentage",
  discount_value: "",
  expires_at: "",
  max_uses: "",
  is_active: true,
};

const SuperAdminCoupons = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponRow | null>(null);
  const [form, setForm] = useState<CouponFormData>(EMPTY_FORM);

  // Fetch coupons
  const { data: coupons = [], isLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async (): Promise<CouponRow[]> => {
      const { data, error } = await supabase
        .from("coupons")
        .select("id, code, discount_type, discount_value, expires_at, max_uses, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      // Get usage counts
      const couponIds = (data ?? []).map((c: CouponRow) => c.id);
      let usageCounts = new Map<string, number>();
      if (couponIds.length > 0) {
        const { data: redemptions } = await supabase
          .from("coupon_redemptions")
          .select("coupon_id")
          .in("coupon_id", couponIds);
        if (redemptions) {
          for (const r of redemptions) {
            usageCounts.set(r.coupon_id, (usageCounts.get(r.coupon_id) ?? 0) + 1);
          }
        }
      }

      return (data ?? []).map((c: CouponRow) => ({
        ...c,
        usage_count: usageCounts.get(c.id) ?? 0,
      }));
    },
    staleTime: 15_000,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (input: { id?: string; data: Partial<CouponRow> }) => {
      if (input.id) {
        const { error } = await supabase
          .from("coupons")
          .update(input.data)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("coupons")
          .insert(input.data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      setDialogOpen(false);
      setEditingCoupon(null);
      setForm(EMPTY_FORM);
      toast({ title: editingCoupon ? "Coupon updated" : "Coupon created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Toggle active
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("coupons")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return coupons;
    const q = search.toLowerCase();
    return coupons.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.discount_type.includes(q)
    );
  }, [coupons, search]);

  const openCreate = () => {
    setEditingCoupon(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (coupon: CouponRow) => {
    setEditingCoupon(coupon);
    setForm({
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: String(coupon.discount_value),
      expires_at: coupon.expires_at ? coupon.expires_at.split("T")[0] : "",
      max_uses: coupon.max_uses ? String(coupon.max_uses) : "",
      is_active: coupon.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const code = form.code.trim().toUpperCase();
    const value = Number(form.discount_value);
    if (!code) { toast({ title: "Code required", variant: "destructive" }); return; }
    if (!value || value <= 0) { toast({ title: "Invalid discount value", variant: "destructive" }); return; }
    if (form.discount_type === "percentage" && value > 100) { toast({ title: "Percentage cannot exceed 100", variant: "destructive" }); return; }

    const payload: Partial<CouponRow> = {
      code,
      discount_type: form.discount_type,
      discount_value: value,
      expires_at: form.expires_at ? new Date(form.expires_at + "T23:59:59Z").toISOString() : null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      is_active: form.is_active,
    };

    saveMutation.mutate({ id: editingCoupon?.id, data: payload });
  };

  const totalDiscount = coupons.reduce((sum, c) => sum + (c.usage_count ?? 0) * c.discount_value, 0);
  const activeCoupons = coupons.filter(c => c.is_active).length;
  const totalRedemptions = coupons.reduce((sum, c) => sum + (c.usage_count ?? 0), 0);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Create Coupon</Button>}
          description="Create, manage, and track discount coupons for library subscriptions."
          title="Coupon Management"
        />

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Active Coupons</p>
            <p className="mt-1 text-2xl font-bold">{activeCoupons}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total Redemptions</p>
            <p className="mt-1 text-2xl font-bold">{totalRedemptions}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total Coupons</p>
            <p className="mt-1 text-2xl font-bold">{coupons.length}</p>
          </div>
        </div>

        {/* Search */}
        <Input
          placeholder="Search by coupon code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Table */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Max Uses</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No coupons found</TableCell></TableRow>
              ) : (
                filtered.map((coupon) => (
                  <TableRow key={coupon.id}>
                    <TableCell className="font-mono font-medium">{coupon.code}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {coupon.discount_type === "percentage" ? <Percent className="mr-1 h-3 w-3" /> : <Tag className="mr-1 h-3 w-3" />}
                        {coupon.discount_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {coupon.discount_type === "percentage" ? `${coupon.discount_value}%` : `₹${coupon.discount_value}`}
                    </TableCell>
                    <TableCell>{coupon.usage_count ?? 0}</TableCell>
                    <TableCell>{coupon.max_uses ?? "∞"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {coupon.expires_at ? format(new Date(coupon.expires_at), "dd MMM yyyy") : "Never"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={coupon.is_active}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: coupon.id, is_active: checked })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(coupon)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCoupon ? "Edit Coupon" : "Create Coupon"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Coupon Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. WELCOME50"
                disabled={!!editingCoupon}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Discount Type</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.discount_type}
                  onChange={(e) => setForm({ ...form, discount_type: e.target.value as "percentage" | "flat" })}
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="flat">Flat (₹)</option>
                </select>
              </div>
              <div>
                <Label>Discount Value</Label>
                <Input
                  type="number"
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  placeholder={form.discount_type === "percentage" ? "e.g. 20" : "e.g. 500"}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Expiry Date</Label>
                <Input
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                />
              </div>
              <div>
                <Label>Max Uses (blank = unlimited)</Label>
                <Input
                  type="number"
                  value={form.max_uses}
                  onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : editingCoupon ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminLayout>
  );
};

export default SuperAdminCoupons;
