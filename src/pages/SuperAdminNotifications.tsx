import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle } from "lucide-react";
import { format } from "date-fns";

const SuperAdminNotifications = () => {
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*, libraries(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-notifications"] }),
  });

  const unread = notifications.filter((n: any) => !n.read).length;

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Notifications</h2>
            <p className="text-sm text-muted-foreground mt-1">{unread} unread notifications</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
            ) : notifications.length === 0 ? (
              <div className="text-center py-12">
                <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((n: any) => (
                  <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${n.read ? "border-border bg-background" : "border-primary/20 bg-primary/5"}`}>
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${n.read ? "bg-muted-foreground/30" : "bg-primary"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{n.title}</p>
                        <Badge variant="outline" className="text-[10px]">{(n as any).libraries?.name || ""}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">{format(new Date(n.created_at), "dd MMM yyyy, hh:mm a")}</p>
                    </div>
                    {!n.read && (
                      <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)} className="flex-shrink-0">
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminNotifications;
