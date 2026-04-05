import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Search, Plus, ExternalLink, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";

type LibrarySummary = {
  active_students?: number | null;
  address?: string | null;
  city?: string | null;
  enabled?: boolean | null;
  id: string;
  monthly_revenue?: number | null;
  name: string;
  slug?: string | null;
  total_seats?: number | null;
};

type LibrarySubscriptionSummary = {
  library_id: string;
  plan_name?: string | null;
  status?: string | null;
};

const SuperAdminLibraries = () => {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [newLib, setNewLib] = useState({ name: "", address: "", city: "", district: "", state: "", country: "India" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: libraries = [], isLoading } = useQuery({
    queryKey: ["admin-libraries"],
    queryFn: async () => {
      const { data, error } = await supabase.from("libraries").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["admin-subs-for-libs"],
    queryFn: async (): Promise<LibrarySubscriptionSummary[]> => {
      const { data, error } = await supabase.from("library_subscriptions" as never).select("*");
      if (error) throw error;
      return (data as LibrarySubscriptionSummary[] | null) ?? [];
    },
  });

  const subMap = Object.fromEntries(subs.map((subscription) => [subscription.library_id, subscription]));

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("libraries").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      toast({ title: "Library updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("libraries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      toast({ title: "Library deleted" });
    },
    onError: (err) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Unable to delete library.",
        variant: "destructive",
      }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const slug = newLib.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { error } = await supabase.from("libraries").insert({
        name: newLib.name,
        address: newLib.address,
        city: newLib.city,
        district: newLib.district.trim() || null,
        state: newLib.state.trim() || null,
        country: newLib.country.trim() || "India",
        owner_id: user.id,
        slug,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      setNewLib({ name: "", address: "", city: "", district: "", state: "", country: "India" });
      setDialogOpen(false);
      toast({ title: "Library created" });
    },
    onError: (err) =>
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Unable to create library.",
        variant: "destructive",
      }),
  });

  const filtered = (libraries as LibrarySummary[]).filter((library) => {
    const matchesSearch =
      library.name.toLowerCase().includes(search.toLowerCase()) ||
      (library.city || "").toLowerCase().includes(search.toLowerCase());
    if (filter === "all") return matchesSearch;
    if (filter === "active") return matchesSearch && Boolean(library.enabled);
    if (filter === "disabled") return matchesSearch && !library.enabled;
    if (filter === "expired") {
      const sub = subMap[library.id];
      return matchesSearch && sub?.status === "expired";
    }
    return matchesSearch;
  });

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Libraries</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage all libraries on the platform</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" /> Add Library</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Create New Library</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Library Name</Label>
                  <Input value={newLib.name} onChange={(e) => setNewLib({ ...newLib, name: e.target.value })} placeholder="City Study Hub" />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input value={newLib.address} onChange={(e) => setNewLib({ ...newLib, address: e.target.value })} placeholder="123 Main St" />
                </div>
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input value={newLib.city} onChange={(e) => setNewLib({ ...newLib, city: e.target.value })} placeholder="Mumbai" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>District</Label>
                    <Input value={newLib.district} onChange={(e) => setNewLib({ ...newLib, district: e.target.value })} placeholder="e.g. Mumbai Suburban" />
                  </div>
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Input value={newLib.state} onChange={(e) => setNewLib({ ...newLib, state: e.target.value })} placeholder="e.g. Maharashtra" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input value={newLib.country} onChange={(e) => setNewLib({ ...newLib, country: e.target.value })} placeholder="India" />
                </div>
                <Button onClick={() => createMutation.mutate()} disabled={!newLib.name || createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Creating..." : "Create Library"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-lg font-display">All Libraries</CardTitle>
              <div className="flex gap-2">
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative w-full sm:w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No libraries found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Library</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead className="hidden md:table-cell">Plan</TableHead>
                    <TableHead className="hidden md:table-cell">Seats</TableHead>
                    <TableHead className="hidden lg:table-cell">Revenue</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Public</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((lib) => {
                    const sub = subMap[lib.id];
                    return (
                      <TableRow key={lib.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">{lib.name}</p>
                            <p className="text-xs text-muted-foreground">{lib.address || "—"}</p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-muted-foreground">{lib.city || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell capitalize">{sub?.plan_name || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{lib.active_students}/{lib.total_seats}</TableCell>
                        <TableCell className="hidden lg:table-cell font-medium">₹{Number(lib.monthly_revenue || 0).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={lib.enabled ? (sub?.status === "expired" ? "outline" : "default") : "secondary"}>
                            {!lib.enabled ? "Disabled" : sub?.status || "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {lib.slug && (
                            <Link to={`/library/${lib.slug}`} className="text-primary hover:underline text-xs flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> View
                            </Link>
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch checked={lib.enabled} onCheckedChange={(enabled) => toggleMutation.mutate({ id: lib.id, enabled })} />
                        </TableCell>
                        <TableCell className="text-right">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {lib.name}?</AlertDialogTitle>
                                <AlertDialogDescription>This will permanently delete this library and all associated data. This action cannot be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(lib.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminLibraries;
