import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Globe, CheckCircle, XCircle, Search } from "lucide-react";
import { format } from "date-fns";

const SuperAdminDomains = () => {
  const [search, setSearch] = useState("");
  const [reviewItem, setReviewItem] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["admin-domain-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("domain_requests" as any)
        .select("*, libraries(name, city, slug)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, domain, libraryId }: { id: string; status: string; domain: string; libraryId: string }) => {
      // Update request status
      const { error: reqError } = await supabase
        .from("domain_requests" as any)
        .update({ status, reviewed_at: new Date().toISOString(), review_note: reviewNote || null })
        .eq("id", id);
      if (reqError) throw reqError;

      // If approved, set custom_domain on library
      if (status === "approved") {
        const { error: libError } = await supabase
          .from("libraries")
          .update({ custom_domain: domain })
          .eq("id", libraryId);
        if (libError) throw libError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-domain-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-libraries"] });
      setReviewItem(null);
      setReviewNote("");
      toast({ title: "Domain request reviewed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const pending = requests.filter((r: any) => r.status === "pending");
  const filtered = requests.filter((r: any) =>
    r.domain.toLowerCase().includes(search.toLowerCase()) ||
    (r.libraries?.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Domain Management</h2>
          <p className="text-sm text-muted-foreground mt-1">{pending.length} pending domain requests</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-lg font-display">All Domain Requests</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No domain requests yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Library</TableHead>
                    <TableHead className="hidden sm:table-cell">Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Note</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((req: any) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium text-foreground">{req.domain}</TableCell>
                      <TableCell className="text-muted-foreground">{req.libraries?.name || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {format(new Date(req.requested_at), "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={req.status === "approved" ? "default" : req.status === "rejected" ? "destructive" : "secondary"}>
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{req.review_note || "—"}</TableCell>
                      <TableCell className="text-right">
                        {req.status === "pending" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="text-success border-success/30" onClick={() => {
                              setReviewItem(req);
                              setReviewNote("");
                            }}>
                              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Review
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {req.reviewed_at ? format(new Date(req.reviewed_at), "dd MMM") : ""}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Review dialog */}
        <Dialog open={!!reviewItem} onOpenChange={(open) => !open && setReviewItem(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Review Domain Request</DialogTitle>
            </DialogHeader>
            {reviewItem && (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-lg border border-border bg-secondary/50">
                  <p className="text-sm"><span className="text-muted-foreground">Domain:</span> <span className="font-medium text-foreground">{reviewItem.domain}</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Library:</span> <span className="font-medium text-foreground">{reviewItem.libraries?.name}</span></p>
                </div>
                <div className="space-y-2">
                  <Label>Review Note (optional)</Label>
                  <Textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Add a note..." rows={2} />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => reviewMutation.mutate({ id: reviewItem.id, status: "approved", domain: reviewItem.domain, libraryId: reviewItem.library_id })} disabled={reviewMutation.isPending}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Approve
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => reviewMutation.mutate({ id: reviewItem.id, status: "rejected", domain: reviewItem.domain, libraryId: reviewItem.library_id })} disabled={reviewMutation.isPending}>
                    <XCircle className="w-4 h-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDomains;
