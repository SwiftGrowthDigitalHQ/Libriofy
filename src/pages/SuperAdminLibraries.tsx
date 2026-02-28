import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Building2, Users, CreditCard, TrendingUp, Search, Plus, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";

const SuperAdminLibraries = () => {
  const [search, setSearch] = useState("");
  const [newLib, setNewLib] = useState({ name: "", address: "", city: "" });
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

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const slug = newLib.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { error } = await supabase.from("libraries").insert({
        name: newLib.name,
        address: newLib.address,
        city: newLib.city,
        owner_id: user.id,
        slug,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      setNewLib({ name: "", address: "", city: "" });
      setDialogOpen(false);
      toast({ title: "Library created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = libraries.filter((l: any) =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    (l.city || "").toLowerCase().includes(search.toLowerCase())
  );

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
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search libraries..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                    <TableHead className="hidden md:table-cell">Seats</TableHead>
                    <TableHead className="hidden md:table-cell">Students</TableHead>
                    <TableHead className="hidden lg:table-cell">Revenue</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Public</TableHead>
                    <TableHead className="text-right">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((lib: any) => (
                    <TableRow key={lib.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{lib.name}</p>
                          <p className="text-xs text-muted-foreground">{lib.address || "—"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">{lib.city || "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">{lib.total_seats}</TableCell>
                      <TableCell className="hidden md:table-cell">{lib.active_students}</TableCell>
                      <TableCell className="hidden lg:table-cell font-medium">₹{Number(lib.monthly_revenue || 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={lib.enabled ? "default" : "secondary"}>
                          {lib.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {lib.slug && (
                          <Link to={`/library/${lib.slug}`} className="text-primary hover:underline text-xs flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> View
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={lib.enabled}
                          onCheckedChange={(enabled) => toggleMutation.mutate({ id: lib.id, enabled })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
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
