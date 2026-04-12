import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type LeadStatus = "new" | "contacted" | "demo_done" | "converted" | "rejected";

type LeadRow = {
  id: string;
  partner_id: string;
  library_name: string;
  owner_name: string;
  phone: string;
  city: string | null;
  seats: number | null;
  status: LeadStatus;
  created_at: string;
  converted_at: string | null;
  affiliates?: { code: string | null; name: string | null } | null;
};

const badgeForStatus = (status: LeadStatus) => {
  if (status === "converted") return <Badge className="bg-success/15 text-success border-success/30">Converted</Badge>;
  if (status === "demo_done") return <Badge variant="secondary">Demo Done</Badge>;
  if (status === "contacted") return <Badge variant="secondary">Contacted</Badge>;
  if (status === "rejected") return <Badge variant="outline">Rejected</Badge>;
  return <Badge variant="outline">New</Badge>;
};

const SuperAdminLeads = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["admin-leads"],
    queryFn: async (): Promise<LeadRow[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, partner_id, library_name, owner_name, phone, city, seats, status, created_at, converted_at, affiliates(code, name)")
        .order("created_at", { ascending: false })
        .returns<LeadRow[]>();
      if (error) throw error;
      return (data ?? []) as LeadRow[];
    },
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesStatus = statusFilter === "all" ? true : lead.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      const partnerLabel = `${lead.affiliates?.code ?? ""} ${lead.affiliates?.name ?? ""}`;
      return `${lead.library_name} ${lead.owner_name} ${lead.phone} ${lead.city ?? ""} ${partnerLabel}`.toLowerCase().includes(q);
    });
  }, [leads, search, statusFilter]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: LeadStatus }) => {
      const payload: Record<string, unknown> = { status };
      if (status === "converted") {
        payload.converted_at = new Date().toISOString();
      }
      const { error } = await supabase.from("leads").update(payload).eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
      toast({ title: "Lead updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const statusCounts = useMemo(() => {
    const counts: Record<LeadStatus, number> = { new: 0, contacted: 0, demo_done: 0, converted: 0, rejected: 0 };
    leads.forEach((lead) => {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    });
    return counts;
  }, [leads]);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Leads</h2>
            <p className="text-sm text-muted-foreground mt-1">Track partner leads and move them through the pipeline</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">New</p><p className="text-xl font-bold font-display">{statusCounts.new}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Contacted</p><p className="text-xl font-bold font-display">{statusCounts.contacted}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Demo Done</p><p className="text-xl font-bold font-display">{statusCounts.demo_done}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Converted</p><p className="text-xl font-bold font-display">{statusCounts.converted}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Rejected</p><p className="text-xl font-bold font-display">{statusCounts.rejected}</p></CardContent></Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:w-[340px]">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads..." />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="demo_done">Demo Done</SelectItem>
              <SelectItem value="converted">Converted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">All Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading leads...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No leads found.</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Seats</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Update</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-foreground">{lead.library_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {lead.owner_name} • {lead.phone}
                              {lead.city ? ` • ${lead.city}` : ""}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="text-sm text-foreground">{lead.affiliates?.name ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{lead.affiliates?.code ?? "—"}</p>
                          </div>
                        </TableCell>
                        <TableCell>{badgeForStatus(lead.status)}</TableCell>
                        <TableCell className="text-right">{lead.seats ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(lead.created_at).toLocaleDateString("en-IN")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Select
                            value={lead.status}
                            onValueChange={(value) =>
                              updateStatusMutation.mutate({ leadId: lead.id, status: value as LeadStatus })
                            }
                          >
                            <SelectTrigger className="w-[180px] ml-auto">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="new">New</SelectItem>
                              <SelectItem value="contacted">Contacted</SelectItem>
                              <SelectItem value="demo_done">Demo Done</SelectItem>
                              <SelectItem value="converted">Converted</SelectItem>
                              <SelectItem value="rejected">Rejected</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminLeads;
