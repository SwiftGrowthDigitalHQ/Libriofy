import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Phone, Plus, User, Users2 } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";

type LeadStatus = "new" | "contacted" | "demo_done" | "rejected" | "converted";

type LeadRow = {
  id: string;
  library_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  seats: number | null;
  status: LeadStatus;
  created_at: string;
};

const statusLabel: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  demo_done: "Demo Done",
  converted: "Converted",
  rejected: "Rejected",
};

const badgeForStatus = (status: LeadStatus) => {
  if (status === "converted") return <Badge className="bg-success/15 text-success border-success/30">Converted</Badge>;
  if (status === "demo_done") return <Badge variant="secondary">Demo Done</Badge>;
  if (status === "contacted") return <Badge variant="secondary">Contacted</Badge>;
  if (status === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">New</Badge>;
};

const PartnerLeadsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: partner, isLoading: partnerLoading } = usePartnerAffiliate();

  const [libraryName, setLibraryName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [seats, setSeats] = useState("");

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["partner-leads", partner?.id],
    queryFn: async (): Promise<LeadRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, library_name, owner_name, phone, city, seats, status, created_at")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeadRow[];
    },
    enabled: !!partner?.id,
    staleTime: 10_000,
  });

  const statusCounts = useMemo(() => {
    const counts: Record<LeadStatus, number> = { new: 0, contacted: 0, demo_done: 0, converted: 0, rejected: 0 };
    leads.forEach((lead) => {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    });
    return counts;
  }, [leads]);

  const createLeadMutation = useMutation({
    mutationFn: async () => {
      if (!partner?.id) throw new Error("Partner profile not found.");
      if (!libraryName.trim()) throw new Error("Library name is required.");
      if (!ownerName.trim()) throw new Error("Owner name is required.");
      if (!phone.trim()) throw new Error("Phone is required.");

      const seatsValue = seats.trim() ? Number(seats.trim()) : null;
      if (seats.trim() && !Number.isFinite(seatsValue)) throw new Error("Seats must be a number.");

      const { error } = await supabase.from("leads").insert({
        partner_id: partner.id,
        library_name: libraryName.trim(),
        owner_name: ownerName.trim(),
        phone: phone.trim(),
        city: city.trim() || null,
        seats: seatsValue,
        status: "new",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner-leads", partner?.id] });
      setLibraryName("");
      setOwnerName("");
      setPhone("");
      setCity("");
      setSeats("");
      toast({ title: "Lead added" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to add lead", description: error.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: LeadStatus }) => {
      const { error } = await supabase
        .from("leads")
        .update({ status })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["partner-leads", partner?.id] }),
    onError: (error: Error) => {
      toast({ title: "Unable to update lead", description: error.message, variant: "destructive" });
    },
  });

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">Leads</h2>
          <p className="text-sm text-muted-foreground">Add and track library leads through the sales pipeline.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card className="sm:col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">New</p>
              <p className="text-xl font-bold font-display">{statusCounts.new}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Contacted</p>
              <p className="text-xl font-bold font-display">{statusCounts.contacted}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Demo Done</p>
              <p className="text-xl font-bold font-display">{statusCounts.demo_done}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Converted</p>
              <p className="text-xl font-bold font-display">{statusCounts.converted}</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Rejected</p>
              <p className="text-xl font-bold font-display">{statusCounts.rejected}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Add a Lead</CardTitle>
            <Button
              type="button"
              onClick={() => createLeadMutation.mutate()}
              disabled={partnerLoading || createLeadMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Lead
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Library Name</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={libraryName} onChange={(e) => setLibraryName(e.target.value)} placeholder="ABC Library" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Owner Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner name" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91XXXXXXXXXX" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <div className="relative">
                  <Users2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Seats (optional)</Label>
                <Input value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="e.g., 80" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: Keep phone number accurate. Admin can later mark the lead as Converted after signup/payment.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">All Leads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leadsLoading ? (
              <p className="text-sm text-muted-foreground">Loading leads...</p>
            ) : leads.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads yet.</p>
            ) : (
              <div className="space-y-3">
                {leads.map((lead) => (
                  <div key={lead.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">{lead.library_name}</p>
                        {badgeForStatus(lead.status)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {lead.owner_name} • {lead.phone}
                        {lead.city ? ` • ${lead.city}` : ""}
                        {lead.seats ? ` • ${lead.seats} seats` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Added {new Date(lead.created_at).toLocaleDateString("en-IN")}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        value={lead.status}
                        onValueChange={(value) => updateStatusMutation.mutate({ leadId: lead.id, status: value as LeadStatus })}
                      >
                        <SelectTrigger className="w-[170px]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {(["new", "contacted", "demo_done", "rejected"] as LeadStatus[]).map((status) => (
                            <SelectItem key={status} value={status}>
                              {statusLabel[status]}
                            </SelectItem>
                          ))}
                          <SelectItem value="converted" disabled>
                            Converted (Admin only)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerLeadsPage;

