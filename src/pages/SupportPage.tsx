import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { MessageSquare, Send } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TicketRow = Database["public"]["Tables"]["support_tickets"]["Row"];
type TicketInsert = Database["public"]["Tables"]["support_tickets"]["Insert"];

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const formatStatus = (status: string) =>
  status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "resolved" || status === "closed") return "secondary";
  if (status === "open") return "default";
  if (status === "rejected") return "destructive";
  return "outline";
};

const SupportPage = () => {
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["my-libraries-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const {
    data: tickets = [],
    isLoading: ticketsLoading,
    isError: ticketsError,
    error: ticketsQueryError,
  } = useQuery({
    queryKey: ["support-tickets", resolvedLibraryId],
    queryFn: async (): Promise<TicketRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId || !user?.id) throw new Error("Library context missing.");
      if (!title.trim()) throw new Error("Issue title is required.");

      const payload: TicketInsert = {
        library_id: resolvedLibraryId,
        user_id: user.id,
        title: title.trim(),
        description: desc.trim() || null,
      };

      const { error } = await supabase.from("support_tickets").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setDesc("");
      queryClient.invalidateQueries({ queryKey: ["support-tickets", resolvedLibraryId] });
      toast({ title: "Ticket submitted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to submit ticket", description: error.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!resolvedLibraryId) throw new Error("Library context missing.");
      const { error } = await supabase
        .from("support_tickets")
        .update({ status })
        .eq("id", id)
        .eq("library_id", resolvedLibraryId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets", resolvedLibraryId] });
      toast({ title: "Ticket status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update ticket", description: error.message, variant: "destructive" });
    },
  });

  const loading = roleLibraryLoading || fallbackLoading || ticketsLoading;
  const supportWhatsApp = ((import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) || "919999999999").replace(/\D/g, "");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Support</h2>
          <p className="text-sm text-muted-foreground mt-1">Get help with your library</p>
        </div>

        {!resolvedLibraryId && !loading && (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Library not linked to your account. Please check user role setup.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Submit a Ticket</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Issue Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief description"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="Describe your issue..."
                  rows={4}
                />
              </div>
              <Button
                className="w-full"
                disabled={!resolvedLibraryId || !title.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                <Send className="w-4 h-4 mr-2" />
                {createMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
              <div className="pt-2 border-t border-border">
                <a
                  href={`https://wa.me/${supportWhatsApp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Quick help via WhatsApp
                </a>
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg">Your Tickets</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading tickets...</p>
                ) : ticketsError ? (
                  <p className="text-sm text-destructive text-center py-8">
                    Unable to load tickets: {getErrorMessage(ticketsQueryError)}
                  </p>
                ) : tickets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No support tickets yet</p>
                ) : (
                  <div className="space-y-3">
                    {tickets.map((ticket) => {
                      const nextStatus = ticket.status === "resolved" ? "open" : "resolved";
                      return (
                        <div key={ticket.id} className="p-3 rounded-lg border border-border">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">{ticket.title}</p>
                            <Badge variant={statusVariant(ticket.status)}>{formatStatus(ticket.status)}</Badge>
                          </div>
                          {ticket.description && <p className="text-xs text-muted-foreground mt-1">{ticket.description}</p>}
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-[10px] text-muted-foreground/70">
                              Created {format(new Date(ticket.created_at), "dd MMM yyyy, hh:mm a")}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ id: ticket.id, status: nextStatus })}
                            >
                              {ticket.status === "resolved" ? "Reopen" : "Mark Resolved"}
                            </Button>
                          </div>
                          {ticket.admin_reply ? (
                            <div className="mt-3 rounded-lg bg-secondary/60 p-3">
                              <p className="text-xs font-medium text-foreground">Support reply</p>
                              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                                {ticket.admin_reply}
                              </p>
                              {ticket.admin_replied_at ? (
                                <p className="mt-2 text-[10px] text-muted-foreground/70">
                                  Replied {format(new Date(ticket.admin_replied_at), "dd MMM yyyy, hh:mm a")}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
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
