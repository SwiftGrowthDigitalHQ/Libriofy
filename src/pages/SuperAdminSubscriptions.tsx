import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Search, CreditCard, Zap, Crown, Rocket } from "lucide-react";
import { format } from "date-fns";

const PLANS = [
  { name: "starter", label: "Starter", price: 999, seats: 50, icon: Zap, features: ["seat_management", "analytics"] },
  { name: "growth", label: "Growth", price: 1999, seats: 150, icon: Rocket, features: ["seat_management", "analytics", "notifications", "export"] },
  { name: "pro", label: "Pro", price: 2999, seats: 9999, icon: Crown, features: ["seat_management", "analytics", "notifications", "export", "custom_domain", "priority_support"] },
];

const SuperAdminSubscriptions = () => {
  const [search, setSearch] = useState("");
  const [editSub, setEditSub] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: subs = [], isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_subscriptions" as any)
        .select("*, libraries(name, city, owner_id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: any) => {
      const { id, ...rest } = updates;
      const { error } = await supabase
        .from("library_subscriptions" as any)
        .update(rest)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      setEditSub(null);
      toast({ title: "Subscription updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusColor = (s: string) => {
    if (s === "active") return "default";
    if (s === "trial") return "secondary";
    if (s === "expired") return "outline";
    return "destructive";
  };

  const filtered = subs.filter((s: any) =>
    (s.libraries?.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Subscriptions</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage library subscription plans</p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <Card key={plan.name} className={plan.name === "growth" ? "border-primary ring-1 ring-primary" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <plan.icon className="w-5 h-5 text-primary" />
                  <CardTitle className="font-display text-lg">{plan.label}</CardTitle>
                  {plan.name === "growth" && <Badge className="ml-auto">Popular</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-foreground">₹{plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="text-sm text-muted-foreground mt-1">{plan.seats === 9999 ? "Unlimited" : `Up to ${plan.seats}`} seats</p>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      {f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Subscription table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-lg font-display">Library Subscriptions</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Library</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="hidden sm:table-cell">Price</TableHead>
                    <TableHead className="hidden md:table-cell">Seats Limit</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((sub: any) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">{sub.libraries?.name || "—"}</TableCell>
                      <TableCell className="capitalize">{sub.plan_name}</TableCell>
                      <TableCell className="hidden sm:table-cell">₹{Number(sub.price).toLocaleString()}</TableCell>
                      <TableCell className="hidden md:table-cell">{sub.seats_limit >= 9999 ? "Unlimited" : sub.seats_limit}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {sub.expires_at ? format(new Date(sub.expires_at), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor(sub.status) as any}>{sub.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditSub(sub)}>Edit</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Edit dialog */}
        <Dialog open={!!editSub} onOpenChange={(open) => !open && setEditSub(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Edit Subscription — {editSub?.libraries?.name}</DialogTitle>
            </DialogHeader>
            {editSub && (
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={editSub.plan_name} onValueChange={(v) => {
                    const plan = PLANS.find((p) => p.name === v);
                    setEditSub({ ...editSub, plan_name: v, price: plan?.price ?? editSub.price, seats_limit: plan?.seats ?? editSub.seats_limit, features: plan?.features ?? editSub.features });
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLANS.map((p) => <SelectItem key={p.name} value={p.name}>{p.label} — ₹{p.price}/mo</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editSub.status} onValueChange={(v) => setEditSub({ ...editSub, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expiry Date</Label>
                  <Input type="date" value={editSub.expires_at ? editSub.expires_at.split("T")[0] : ""} onChange={(e) => setEditSub({ ...editSub, expires_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </div>
                <Button className="w-full" onClick={() => updateMutation.mutate({ id: editSub.id, plan_name: editSub.plan_name, price: editSub.price, seats_limit: editSub.seats_limit, status: editSub.status, expires_at: editSub.expires_at, features: editSub.features })} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminSubscriptions;
