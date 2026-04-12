import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarDays, MessageCircle, Phone, Plus, User, Users2 } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";
import { useToast } from "@/hooks/use-toast";

type LeadStatus = "new" | "contacted" | "demo_done" | "converted" | "rejected";

type LeadRow = {
  id: string;
  library_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  seats: number | null;
  status: LeadStatus;
  created_at: string;
  notes: string | null;
  expected_value: number | null;
  demo_scheduled_at: string | null;
  next_followup_at: string | null;
};

const statusLabel: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  demo_done: "Demo Scheduled",
  converted: "Converted",
  rejected: "Rejected",
};

const badgeForStatus = (status: LeadStatus) => {
  if (status === "converted") return <Badge className="bg-success/15 text-success border-success/30">Converted</Badge>;
  if (status === "demo_done") return <Badge variant="secondary">Demo Scheduled</Badge>;
  if (status === "contacted") return <Badge variant="secondary">Contacted</Badge>;
  if (status === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">New</Badge>;
};

const whatsappTemplate = (lead: LeadRow) =>
  `Namaste ${lead.owner_name},\n\n` +
  `Main Libriofy team se bol raha/rahi hu. Aapki library "${lead.library_name}" ke liye 10-min demo dikhana hai.\n` +
  `Kya aaj 11-2 PM ya shaam 5-7 PM me demo schedule ho sakta hai?\n\n` +
  `Thanks!`;

const buildWhatsAppUrl = (phone: string, message: string) => {
  const digits = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

const LeadCard = ({
  lead,
  onUpdate,
  onLog,
}: {
  lead: LeadRow;
  onUpdate: (id: string, update: Partial<LeadRow>) => void;
  onLog: (id: string, action: string, metadata?: Record<string, unknown>) => void;
}) => {
  const [noteDraft, setNoteDraft] = useState(lead.notes ?? "");

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{lead.library_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {lead.owner_name} - {lead.phone} {lead.city ? `- ${lead.city}` : ""} {lead.seats ? `- ${lead.seats} seats` : ""}
          </p>
        </div>
        {badgeForStatus(lead.status)}
      </div>
      {lead.expected_value != null ? (
        <p className="text-[11px] text-muted-foreground">Expected value: Rs {lead.expected_value}</p>
      ) : null}
      {lead.next_followup_at ? (
        <p className="text-[11px] text-muted-foreground">
          Follow-up: {new Date(lead.next_followup_at).toLocaleString("en-IN")}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select
          value={lead.status}
          onValueChange={(value) => {
            onUpdate(lead.id, { status: value as LeadStatus } as any);
            onLog(lead.id, "status_change", { status: value });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {(["new", "contacted", "demo_done", "converted", "rejected"] as LeadStatus[]).map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.href = `tel:${lead.phone}`;
            onLog(lead.id, "call", { phone: lead.phone });
            onUpdate(lead.id, { last_contacted_at: new Date().toISOString() } as any);
          }}
        >
          <Phone className="mr-2 h-4 w-4" /> Call
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.open(buildWhatsAppUrl(lead.phone, whatsappTemplate(lead)), "_blank", "noreferrer");
            onLog(lead.id, "whatsapp", { phone: lead.phone });
            onUpdate(lead.id, { last_contacted_at: new Date().toISOString() } as any);
          }}
        >
          <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const demoTime = new Date();
            demoTime.setDate(demoTime.getDate() + 1);
            onUpdate(lead.id, { status: "demo_done", demo_scheduled_at: demoTime.toISOString() } as any);
            onLog(lead.id, "schedule_demo", { scheduled_at: demoTime.toISOString() });
          }}
        >
          <CalendarDays className="mr-2 h-4 w-4" /> Schedule Demo
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Add notes about this lead..."
          className="min-h-[70px]"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onUpdate(lead.id, { notes: noteDraft } as any);
            onLog(lead.id, "note", { note: noteDraft });
          }}
        >
          Save Notes
        </Button>
      </div>
    </div>
  );
};

const PartnerLeadsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: partner, isLoading: partnerLoading } = usePartnerAffiliate();
  const [legacySchema, setLegacySchema] = useState(false);

  const [libraryName, setLibraryName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [seats, setSeats] = useState("");
  const [expectedValue, setExpectedValue] = useState("");
  const [autoWhatsapp, setAutoWhatsapp] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("partner:auto-whatsapp") === "true";
  });

  const isMissingColumnError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: string }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
    return code === "42703" || /column .* does not exist/i.test(message);
  };

  const sanitizeLeadUpdate = (update: Partial<LeadRow>) => {
    if (!legacySchema) return update;
    const { expected_value, demo_scheduled_at, next_followup_at, last_contacted_at, ...rest } = update as any;
    return rest;
  };

  const buildLeadSelect = (useLegacy: boolean) =>
    useLegacy
      ? "id, library_name, owner_name, phone, city, seats, status, created_at, notes"
      : "id, library_name, owner_name, phone, city, seats, status, created_at, notes, expected_value, demo_scheduled_at, next_followup_at";

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ["partner-leads", partner?.id],
    queryFn: async (): Promise<LeadRow[]> => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("leads")
        .select(buildLeadSelect(legacySchema))
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });
      if (!error) {
        return (data ?? []) as LeadRow[];
      }
      if (isMissingColumnError(error)) {
        console.warn("[partner-leads] Legacy leads schema detected. Falling back to core columns.", error);
        setLegacySchema(true);
        const fallback = await supabase
          .from("leads")
          .select(buildLeadSelect(true))
          .eq("partner_id", partner.id)
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        return ((fallback.data ?? []) as LeadRow[]).map((lead) => ({
          ...lead,
          expected_value: null,
          demo_scheduled_at: null,
          next_followup_at: null,
        }));
      }
      throw error;
    },
    enabled: !!partner?.id,
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ leadId, update }: { leadId: string; update: Partial<LeadRow> }) => {
      const { error } = await supabase
        .from("leads")
        .update(sanitizeLeadUpdate(update) as any)
        .eq("id", leadId);
      if (!error) return;
      if (isMissingColumnError(error)) {
        console.warn("[partner-leads] Legacy schema update retry.", error);
        setLegacySchema(true);
        const retry = await supabase
          .from("leads")
          .update(sanitizeLeadUpdate(update) as any)
          .eq("id", leadId);
        if (retry.error) throw retry.error;
        return;
      }
      throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["partner-leads", partner?.id] }),
    onError: (error: Error) => toast({ title: "Unable to update lead", description: error.message, variant: "destructive" }),
  });

  const logActivity = async (leadId: string, action: string, metadata?: Record<string, unknown>) => {
    if (!partner?.id) return;
    const { error } = await supabase.from("partner_lead_activity").insert({
      lead_id: leadId,
      partner_id: partner.id,
      action_type: action,
      metadata: metadata ?? {},
    });
    if (error) {
      const message = String(error.message ?? "");
      const code = String((error as { code?: string }).code ?? "");
      if (code === "42P01" || /relation .* does not exist/i.test(message)) {
        console.warn("[partner-leads] partner_lead_activity table missing. Skipping activity log.", error);
        return;
      }
      console.error("[partner-leads] failed to log activity", error);
    }
  };

  const createLeadMutation = useMutation({
    mutationFn: async () => {
      if (!partner?.id) throw new Error("Partner profile not found.");
      if (!libraryName.trim()) throw new Error("Library name is required.");
      if (!ownerName.trim()) throw new Error("Owner name is required.");
      if (!phone.trim()) throw new Error("Phone is required.");

      const seatsValue = seats.trim() ? Number(seats.trim()) : null;
      if (seats.trim() && !Number.isFinite(seatsValue)) throw new Error("Seats must be a number.");
      const expectedValueNum = expectedValue.trim() ? Number(expectedValue.trim()) : null;

      const payload = {
        partner_id: partner.id,
        library_name: libraryName.trim(),
        owner_name: ownerName.trim(),
        phone: phone.trim(),
        city: city.trim() || null,
        seats: seatsValue,
        expected_value: expectedValueNum,
        status: "new",
      };

      const { data, error } = await supabase
        .from("leads")
        .insert(legacySchema ? sanitizeLeadUpdate(payload as any) : (payload as any))
        .select("id, phone")
        .single();
      let inserted = data as { id: string; phone?: string } | null;
      if (error) {
        if (isMissingColumnError(error)) {
          console.warn("[partner-leads] Legacy schema insert retry.", error);
          setLegacySchema(true);
          const retry = await supabase
            .from("leads")
            .insert(sanitizeLeadUpdate(payload as any))
            .select("id, phone")
            .single();
          if (retry.error) throw retry.error;
          inserted = retry.data as { id: string; phone?: string } | null;
        } else {
          throw error;
        }
      }

      if (autoWhatsapp && inserted?.phone) {
        window.open(buildWhatsAppUrl(inserted.phone, whatsappTemplate({
          id: inserted.id,
          library_name: libraryName,
          owner_name: ownerName,
          phone: inserted.phone,
          city: city || null,
          seats: seatsValue,
          status: "new",
          created_at: new Date().toISOString(),
          notes: null,
          expected_value: expectedValueNum,
          demo_scheduled_at: null,
          next_followup_at: null,
        })), "_blank", "noreferrer");
      }

      return inserted as { id: string } | null;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["partner-leads", partner?.id] });
      setLibraryName("");
      setOwnerName("");
      setPhone("");
      setCity("");
      setSeats("");
      setExpectedValue("");
      toast({ title: "Lead added" });
      if (data?.id) void logActivity(data.id, "lead_created");
    },
    onError: (error: Error) => {
      console.error("[partner-leads] add lead failed", error);
      toast({ title: "Unable to add lead", description: error.message, variant: "destructive" });
    },
  });

  const statusColumns: { status: LeadStatus; label: string }[] = [
    { status: "new", label: "New" },
    { status: "contacted", label: "Contacted" },
    { status: "demo_done", label: "Demo Scheduled" },
    { status: "converted", label: "Converted" },
    { status: "rejected", label: "Rejected" },
  ];

  const leadsByStatus = useMemo(() => {
    const grouped: Record<LeadStatus, LeadRow[]> = {
      new: [],
      contacted: [],
      demo_done: [],
      converted: [],
      rejected: [],
    };
    leads.forEach((lead) => grouped[lead.status]?.push(lead));
    return grouped;
  }, [leads]);

  const statusCounts = useMemo(() => {
    const counts: Record<LeadStatus, number> = { new: 0, contacted: 0, demo_done: 0, converted: 0, rejected: 0 };
    leads.forEach((lead) => {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    });
    return counts;
  }, [leads]);

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">Leads CRM</h2>
          <p className="text-sm text-muted-foreground">Track every lead, follow up, and close with confidence.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {statusColumns.map((column) => (
            <Card key={column.status}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{column.label}</p>
                <p className="text-xl font-bold font-display">{statusCounts[column.status]}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg font-display">Add a Lead</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  checked={autoWhatsapp}
                  onCheckedChange={(value) => {
                    setAutoWhatsapp(value);
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem("partner:auto-whatsapp", String(value));
                    }
                  }}
                />
                Auto WhatsApp on add
              </div>
              <Button type="button" onClick={() => createLeadMutation.mutate()} disabled={partnerLoading || createLeadMutation.isPending}>
                <Plus className="mr-2 h-4 w-4" /> Add Lead
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className="space-y-2">
                <Label>Expected Value (Rs)</Label>
                <Input value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} placeholder="e.g., 2500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: Keep phone number accurate. Admin can later mark the lead as Converted after signup/payment.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {statusColumns.map((column) => (
            <Card key={column.status} className="xl:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">{column.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {leadsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading leads...</p>
                ) : leadsByStatus[column.status].length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leads here yet.</p>
                ) : (
                  leadsByStatus[column.status].map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onUpdate={(id, update) => updateLeadMutation.mutate({ leadId: id, update })}
                      onLog={(id, action, metadata) => void logActivity(id, action, metadata)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PartnerLayout>
  );
};

export default PartnerLeadsPage;
