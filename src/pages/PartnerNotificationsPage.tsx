import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import PartnerLayout from "@/components/dashboard/PartnerLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerAffiliate } from "@/hooks/usePartnerAffiliate";

const PartnerNotificationsPage = () => {
  const queryClient = useQueryClient();
  const { data: partner } = usePartnerAffiliate();
  const isMissingTableError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const message = "message" in error ? String((error as { message?: string }).message ?? "") : "";
    const code = "code" in error ? String((error as { code?: string }).code ?? "") : "";
    return code === "42P01" || /relation .* does not exist/i.test(message);
  };

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["partner-notifications", partner?.id],
    queryFn: async () => {
      if (!partner?.id) return [];
      const { data, error } = await supabase
        .from("partner_notifications")
        .select("id, type, title, message, read, scheduled_at, created_at, metadata")
        .eq("partner_id", partner.id)
        .order("created_at", { ascending: false });
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[partner-notifications] partner_notifications table missing. Skipping list.", error);
          return [];
        }
        throw error;
      }
      return data ?? [];
    },
    enabled: !!partner?.id,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("partner_notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[partner-notifications] partner_notifications table missing. Unable to mark read.", error);
          return;
        }
        throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["partner-notifications", partner?.id] }),
  });

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold font-display text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">Stay on top of follow-ups and income alerts.</p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Bell className="h-4 w-4" /> Smart Alerts
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => notifications.forEach((n) => !n.read && markReadMutation.mutate(n.id))}
              disabled={notifications.length === 0}
            >
              Mark all read
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading notifications...</p>
            ) : notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alerts yet. Add leads to trigger reminders.</p>
            ) : (
              notifications.map((note) => (
                <div
                  key={note.id}
                  className={`rounded-lg border p-3 ${note.read ? "bg-muted/30" : "bg-primary/5 border-primary/20"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{note.title}</p>
                      {note.message ? <p className="text-xs text-muted-foreground mt-1">{note.message}</p> : null}
                      <p className="text-[11px] text-muted-foreground mt-2">
                        {new Date(note.created_at).toLocaleString("en-IN")}
                      </p>
                    </div>
                    {!note.read ? (
                      <Button size="sm" variant="outline" onClick={() => markReadMutation.mutate(note.id)}>
                        <Check className="h-4 w-4 mr-1" /> Read
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </PartnerLayout>
  );
};

export default PartnerNotificationsPage;
