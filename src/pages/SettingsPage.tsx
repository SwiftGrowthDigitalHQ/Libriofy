import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Plus, Pencil, Trash2, CreditCard, Clock, Building2, LayoutGrid, Globe, Copy, Send, CheckCircle, Loader2, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import WebsiteCustomizationTab from "@/components/dashboard/WebsiteCustomizationTab";

type LibraryRow = Database["public"]["Tables"]["libraries"]["Row"];
type LibraryUpdatePayload = Pick<
  Database["public"]["Tables"]["libraries"]["Update"],
  "name" | "address" | "city" | "logo_url" | "opening_hours" | "primary_color" | "total_seats" | "upi_id"
>;

const SettingsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["settings-library-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const { data: activeLibrary } = useQuery({
    queryKey: ["settings-library", resolvedLibraryId],
    queryFn: async (): Promise<LibraryRow | null> => {
      if (!resolvedLibraryId) return null;
      const { data, error } = await supabase
        .from("libraries")
        .select("*")
        .eq("id", resolvedLibraryId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const updateLibMutation = useMutation({
    mutationFn: async (updates: LibraryUpdatePayload) => {
      if (!activeLibrary) throw new Error("No library");
      const { error } = await supabase.from("libraries").update(updates).eq("id", activeLibrary.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-library", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["my-libraries"] });
      toast({ title: "Library updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure your library details, payment settings, website content, plans, slots, and capacity</p>
        </div>

        <Tabs defaultValue="library" className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="library"><Building2 className="w-4 h-4 mr-1.5" /> Library</TabsTrigger>
            <TabsTrigger value="website"><Palette className="w-4 h-4 mr-1.5" /> Website</TabsTrigger>
            <TabsTrigger value="plans"><CreditCard className="w-4 h-4 mr-1.5" /> Plans</TabsTrigger>
            <TabsTrigger value="slots"><Clock className="w-4 h-4 mr-1.5" /> Time Slots</TabsTrigger>
            <TabsTrigger value="seats"><LayoutGrid className="w-4 h-4 mr-1.5" /> Seats</TabsTrigger>
          </TabsList>

          {/* Library Tab */}
          <TabsContent value="library">
            <LibrarySettingsTab
              library={activeLibrary}
              onUpdate={(updates) => updateLibMutation.mutate(updates)}
              isPending={updateLibMutation.isPending || roleLibraryLoading || fallbackLoading}
            />
          </TabsContent>

          {/* Website Tab */}
          <TabsContent value="website">
            <WebsiteCustomizationTab library={activeLibrary} />
          </TabsContent>

          {/* Plans Tab */}
          <TabsContent value="plans">
            <PlansTab libraryId={activeLibrary?.id} />
          </TabsContent>

          {/* Time Slots Tab */}
          <TabsContent value="slots">
            <TimeSlotsTab libraryId={activeLibrary?.id} />
          </TabsContent>

          {/* Seats Tab */}
          <TabsContent value="seats">
            <SeatsTab library={activeLibrary} onUpdate={(u) => updateLibMutation.mutate(u)} isPending={updateLibMutation.isPending} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

const LibrarySettingsTab = ({
  library,
  onUpdate,
  isPending,
}: {
  library: LibraryRow | null | undefined;
  onUpdate: (updates: LibraryUpdatePayload) => void;
  isPending: boolean;
}) => {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#14b8a6");
  const [openingHours, setOpeningHours] = useState("");
  const [upiId, setUpiId] = useState("");

  useEffect(() => {
    if (!library) return;
    setName(library.name || "");
    setAddress(library.address || "");
    setCity(library.city || "");
    setLogoUrl(library.logo_url || "");
    setPrimaryColor(library.primary_color || "#14b8a6");
    setOpeningHours(library.opening_hours || "");
    setUpiId(library.upi_id || "");
  }, [library]);

  if (!library) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No library found.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Library Information</CardTitle>
          <CardDescription>Update your library's basic details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <Label>Library Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Opening Hours</Label>
            <Input placeholder="e.g. 6:00 AM - 10:00 PM" value={openingHours} onChange={(e) => setOpeningHours(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Logo URL</Label>
            <Input placeholder="https://example.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Brand Color</Label>
            <div className="flex items-center gap-3">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded border border-border cursor-pointer" />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-32" />
            </div>
          </div>
          <Button onClick={() => onUpdate({ name, address, city, logo_url: logoUrl, primary_color: primaryColor, opening_hours: openingHours })} disabled={isPending}>
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Payment Settings</CardTitle>
          <CardDescription>Students will pay directly to this UPI ID when renewing their seat.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <Label>Library Owner UPI ID</Label>
            <Input placeholder="abcstudylibrary@upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Renewal QR codes and UPI links will use this account. Libriofy only records the proof and approval status.
          </p>
          <Button onClick={() => onUpdate({ upi_id: upiId.trim() || null })} disabled={isPending}>
            {isPending ? "Saving..." : "Save Payment Settings"}
          </Button>
        </CardContent>
      </Card>

      <DomainRequestCard library={library} />
    </div>
  );
};

const DomainRequestCard = ({ library }: { library: any }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");

  const publicUrl = library?.slug ? `${window.location.origin}/library/${library.slug}` : "";

  const { data: requests = [] } = useQuery({
    queryKey: ["domain-requests", library?.id],
    queryFn: async () => {
      if (!library?.id) return [];
      const { data, error } = await supabase
        .from("domain_requests" as any)
        .select("*")
        .eq("library_id", library.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!library?.id,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("domain_requests" as any).insert({
        library_id: library.id,
        domain: domain.trim().toLowerCase(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["domain-requests"] });
      setDomain("");
      toast({ title: "Domain request submitted", description: "Waiting for admin approval." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const latestRequest = requests[0];
  const hasPending = requests.some((r: any) => r.status === "pending");
  const approvedDomain = library?.custom_domain;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-display flex items-center gap-2"><Globe className="w-5 h-5" /> Domain & Public URL</CardTitle>
        <CardDescription>Your library's public page and custom domain settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        {publicUrl && (
          <div className="space-y-2">
            <Label>Public Page URL</Label>
            <div className="flex items-center gap-2">
              <Input value={publicUrl} readOnly className="bg-secondary" />
              <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Copied!" }); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {approvedDomain && (
          <div className="p-3 rounded-lg border border-border bg-success/5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm font-medium text-foreground">Active Domain: {approvedDomain}</span>
            </div>
          </div>
        )}

        {/* Show request history */}
        {requests.length > 0 && (
          <div className="space-y-2">
            <Label>Domain Requests</Label>
            {requests.slice(0, 3).map((req: any) => (
              <div key={req.id} className="flex items-center justify-between p-2 rounded-lg border border-border text-sm">
                <span className="text-foreground">{req.domain}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={req.status === "approved" ? "default" : req.status === "rejected" ? "destructive" : "secondary"}>
                    {req.status === "pending" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    {req.status}
                  </Badge>
                  {req.review_note && <span className="text-xs text-muted-foreground">{req.review_note}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submit new request */}
        {!hasPending && (
          <div className="space-y-2">
            <Label>Request Custom Domain</Label>
            <div className="flex gap-2">
              <Input placeholder="e.g. citystudyhub.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
              <Button onClick={() => submitMutation.mutate()} disabled={!domain.trim() || submitMutation.isPending}>
                <Send className="w-4 h-4 mr-1" /> Request
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Submit a domain request. The Super Admin will review and approve it.</p>
          </div>
        )}

        {hasPending && (
          <p className="text-xs text-muted-foreground">Your domain request is pending approval. You'll be notified once reviewed.</p>
        )}
      </CardContent>
    </Card>
  );
};

const PlansTab = ({ libraryId }: { libraryId?: string }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", duration_hours: "", price: "", description: "" });

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans", libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const { data, error } = await supabase
        .from("plans" as any)
        .select("*")
        .eq("library_id", libraryId)
        .order("duration_hours");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!libraryId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId) throw new Error("No library");
      const payload = {
        library_id: libraryId,
        name: form.name,
        duration_hours: parseInt(form.duration_hours),
        price: parseFloat(form.price),
        description: form.description || null,
      };
      if (editing) {
        const { error } = await supabase.from("plans" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("plans" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editing ? "Plan updated" : "Plan created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("plans" as any).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plans"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast({ title: "Plan deleted" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", duration_hours: "", price: "", description: "" });
    setEditing(null);
  };

  const openEdit = (plan: any) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      duration_hours: String(plan.duration_hours),
      price: String(plan.price),
      description: plan.description || "",
    });
    setDialogOpen(true);
  };

  if (!libraryId) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No library selected.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-display">Pricing Plans</CardTitle>
            <CardDescription>Define study plans and pricing for your library</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Plan</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Edit Plan" : "New Plan"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Plan Name</Label>
                  <Input placeholder="e.g. Full Day" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Duration (hours)</Label>
                    <Input type="number" placeholder="8" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Price (INR)</Label>
                    <Input type="number" placeholder="3500" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Textarea placeholder="What's included..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <Button className="w-full" disabled={!form.name || !form.duration_hours || !form.price || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  {saveMutation.isPending ? "Saving..." : editing ? "Update Plan" : "Create Plan"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No plans yet. Create your first plan above.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan: any) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <p className="font-medium text-foreground">{plan.name}</p>
                    {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plan.duration_hours}h</TableCell>
                  <TableCell className="text-muted-foreground">Rs. {Number(plan.price || 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell>
                    <Switch checked={plan.is_active} onCheckedChange={(is_active) => toggleMutation.mutate({ id: plan.id, is_active })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(plan)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(plan.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

const TimeSlotsTab = ({ libraryId }: { libraryId?: string }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", start_time: "", end_time: "", max_seats: "" });

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["time-slots", libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const { data, error } = await supabase
        .from("time_slots" as any)
        .select("*")
        .eq("library_id", libraryId)
        .order("start_time");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!libraryId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId) throw new Error("No library");
      const payload = {
        library_id: libraryId,
        name: form.name,
        start_time: form.start_time,
        end_time: form.end_time,
        max_seats: form.max_seats ? parseInt(form.max_seats) : null,
      };
      if (editing) {
        const { error } = await supabase.from("time_slots" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("time_slots" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-slots"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: editing ? "Slot updated" : "Slot created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("time_slots" as any).update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["time-slots"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_slots" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-slots"] });
      toast({ title: "Slot deleted" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", start_time: "", end_time: "", max_seats: "" });
    setEditing(null);
  };

  const openEdit = (slot: any) => {
    setEditing(slot);
    setForm({
      name: slot.name,
      start_time: slot.start_time,
      end_time: slot.end_time,
      max_seats: slot.max_seats ? String(slot.max_seats) : "",
    });
    setDialogOpen(true);
  };

  const formatTime = (t: string) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    const hr = parseInt(h);
    return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
  };

  if (!libraryId) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No library selected.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-display">Time Slots</CardTitle>
            <CardDescription>Define operating time slots for seat booking</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Slot</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Edit Slot" : "New Time Slot"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Slot Name</Label>
                  <Input placeholder="e.g. Morning" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Max Seats (optional)</Label>
                  <Input type="number" placeholder="40" value={form.max_seats} onChange={(e) => setForm({ ...form, max_seats: e.target.value })} />
                </div>
                <Button className="w-full" disabled={!form.name || !form.start_time || !form.end_time || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  {saveMutation.isPending ? "Saving..." : editing ? "Update Slot" : "Create Slot"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No time slots yet. Create your first slot above.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Max Seats</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((slot: any) => (
                <TableRow key={slot.id}>
                  <TableCell className="font-medium text-foreground">{slot.name}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(slot.start_time)} - {formatTime(slot.end_time)}</TableCell>
                  <TableCell className="text-muted-foreground">{slot.max_seats || "Unlimited"}</TableCell>
                  <TableCell>
                    <Switch checked={slot.is_active} onCheckedChange={(is_active) => toggleMutation.mutate({ id: slot.id, is_active })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(slot)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(slot.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

const SeatsTab = ({ library, onUpdate, isPending }: { library: any; onUpdate: (u: any) => void; isPending: boolean }) => {
  const [seats, setSeats] = useState("");

  if (!library) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">No library selected.</CardContent></Card>;
  }

  if (!seats && library.total_seats) {
    setSeats(String(library.total_seats));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-display">Seat Capacity</CardTitle>
        <CardDescription>Set the total number of seats in your library</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-sm">
        <div className="p-4 bg-secondary rounded-lg">
          <p className="text-sm text-muted-foreground">Current capacity</p>
          <p className="text-3xl font-bold font-display text-foreground">{library.total_seats} seats</p>
        </div>
        <div className="space-y-2">
          <Label>New Capacity</Label>
          <Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="40" />
        </div>
        <Button onClick={() => onUpdate({ total_seats: parseInt(seats) })} disabled={isPending || !seats}>
          {isPending ? "Saving..." : "Update Capacity"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default SettingsPage;
