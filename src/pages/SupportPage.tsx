import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Plus, Send } from "lucide-react";
import { format } from "date-fns";

const SupportPage = () => {
  const { user } = useAuth();
  const { data: roles } = useUserRole();
  const libraryId = roles?.find((r) => r.role === "library_owner")?.library_id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets", libraryId],
    queryFn: async () => {
      if (!libraryId) return [];
      const { data, error } = await supabase
        .from("support_tickets" as any)
        .select("*")
        .eq("library_id", libraryId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!libraryId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !user) throw new Error("Missing context");
      const { error } = await supabase.from("support_tickets" as any).insert({
        library_id: libraryId,
        user_id: user.id,
        title: title.trim(),
        description: desc.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setTitle("");
      setDesc("");
      toast({ title: "Ticket submitted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Support</h2>
          <p className="text-sm text-muted-foreground mt-1">Get help with your library</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* New ticket */}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Submit a Ticket</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Issue Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief description" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe your issue..." rows={4} />
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending} className="w-full">
                <Send className="w-4 h-4 mr-2" /> Submit
              </Button>
              <div className="pt-2 border-t border-border">
                <a href="https://wa.me/919999999999" target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" /> Quick help via WhatsApp
                </a>
              </div>
            </CardContent>
          </Card>

          {/* Tickets list */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg">Your Tickets</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
                ) : tickets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No support tickets yet</p>
                ) : (
                  <div className="space-y-3">
                    {tickets.map((t: any) => (
                      <div key={t.id} className="p-3 rounded-lg border border-border">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{t.title}</p>
                          <Badge variant={t.status === "open" ? "default" : t.status === "resolved" ? "secondary" : "outline"}>{t.status}</Badge>
                        </div>
                        {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                        <p className="text-[10px] text-muted-foreground/60 mt-2">{format(new Date(t.created_at), "dd MMM yyyy")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SupportPage;
