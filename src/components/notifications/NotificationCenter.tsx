import { useEffect, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Bell, CheckCheck, MessageSquareReply } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  type NotificationCategory,
  type NotificationWithLibrary,
  useNotificationActions,
  useNotifications,
  useNotificationSummary,
} from "@/hooks/useNotifications";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type NotificationCenterMode = "admin" | "library" | "partner";

type NotificationCenterProps = {
  mode: NotificationCenterMode;
};

const CATEGORY_OPTIONS: Array<{ label: string; value: NotificationCategory | "all" }> = [
  { label: "All types", value: "all" },
  { label: "Payments", value: "payment" },
  { label: "Renewals", value: "renewal" },
  { label: "Support", value: "support" },
  { label: "System", value: "system" },
  { label: "Affiliate", value: "affiliate" },
];

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  affiliate: "Affiliate",
  payment: "Payment",
  renewal: "Renewal",
  support: "Support",
  system: "System",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getTicketId = (notification: NotificationWithLibrary) => {
  const metadata = isRecord(notification.metadata) ? notification.metadata : null;
  const ticketId = metadata?.ticket_id;
  return typeof ticketId === "string" ? ticketId : null;
};

const NotificationCenter = ({ mode }: NotificationCenterProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { markAllAsRead, markAsRead } = useNotificationActions();

  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [replyTarget, setReplyTarget] = useState<NotificationWithLibrary | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState("resolved");

  const { data: summary } = useNotificationSummary(6);
  const { data, isLoading } = useNotifications({
    category,
    page,
    pageSize: 10,
    unreadOnly,
  });

  const notifications = data?.items ?? [];
  const pageCount = data?.pageCount ?? 1;
  const totalCount = data?.totalCount ?? 0;
  const unreadCount = summary?.unreadCount ?? 0;

  useEffect(() => {
    setPage(1);
  }, [category, unreadOnly]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const pageTitle = "Notifications";
  const pageDescription =
    mode === "admin"
      ? "Platform alerts, support activity, and monetization events."
      : mode === "partner"
        ? "Referral signups, commission updates, and payout activity."
        : "Student, payment, renewal, support, and system updates for your library.";

  const replyMutation = useMutation({
    mutationFn: async ({
      notification,
      reply,
      status,
    }: {
      notification: NotificationWithLibrary;
      reply: string;
      status: string;
    }) => {
      const ticketId = getTicketId(notification);
      if (!ticketId) throw new Error("Support ticket reference missing.");
      if (!user?.id) throw new Error("Not authenticated.");
      if (!reply.trim()) throw new Error("Reply is required.");

      const { error } = await supabase
        .from("support_tickets")
        .update({
          admin_reply: reply.trim(),
          admin_replied_at: new Date().toISOString(),
          admin_replied_by: user.id,
          status,
        })
        .eq("id", ticketId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast({ title: "Support reply sent" });
      setReplyTarget(null);
      setReplyText("");
      setReplyStatus("resolved");
      markAsRead.mutate(variables.notification.id);
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to send support reply",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canReplyToSupport = mode === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">{pageTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{pageDescription}</p>
          <p className="mt-2 text-sm text-muted-foreground">{unreadCount} unread notifications</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={unreadOnly ? "default" : "outline"}
            onClick={() => setUnreadOnly((current) => !current)}
          >
            {unreadOnly ? "Showing unread" : "Unread only"}
          </Button>
          <Button
            variant="outline"
            disabled={unreadCount === 0 || markAllAsRead.isPending}
            onClick={() => markAllAsRead.mutate()}
          >
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-60">
              <Label htmlFor="notification-filter" className="mb-2 inline-block text-xs text-muted-foreground">
                Filter by type
              </Label>
              <Select value={category} onValueChange={(value) => setCategory(value as NotificationCategory | "all")}>
                <SelectTrigger id="notification-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">
              {totalCount} notification{totalCount === 1 ? "" : "s"}
            </p>
          </div>

          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading notifications...</p>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center">
              <Bell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No notifications found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => {
                const notificationCategory = notification.category ?? "system";
                const ticketId = getTicketId(notification);

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "rounded-xl border p-4 transition-colors",
                      notification.is_read
                        ? "border-border bg-background"
                        : "border-primary/20 bg-primary/5",
                    )}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full",
                              notification.is_read ? "bg-muted-foreground/30" : "bg-primary",
                            )}
                          />
                          <p className="text-sm font-semibold text-foreground">{notification.title}</p>
                          <Badge variant="outline">{CATEGORY_LABELS[notificationCategory]}</Badge>
                          {mode !== "library" && notification.libraries?.name ? (
                            <Badge variant="secondary">{notification.libraries.name}</Badge>
                          ) : null}
                        </div>

                        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                          {notification.message || "Notification"}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>
                            {formatDistanceToNowStrict(new Date(notification.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                          <span>{format(new Date(notification.created_at), "dd MMM yyyy, hh:mm a")}</span>
                          <span className="font-medium text-foreground/70">{notification.type.replace(/_/g, " ")}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!notification.is_read ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={markAsRead.isPending}
                            onClick={() => markAsRead.mutate(notification.id)}
                          >
                            Mark as read
                          </Button>
                        ) : null}

                        {canReplyToSupport && ticketId ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setReplyTarget(notification);
                              setReplyText("");
                              setReplyStatus("resolved");
                            }}
                          >
                            <MessageSquareReply className="mr-2 h-4 w-4" />
                            Reply
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!replyTarget} onOpenChange={(open) => !open && setReplyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Reply to support ticket</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{replyTarget?.title}</p>
              <p className="mt-1 whitespace-pre-line">{replyTarget?.message || "Support request"}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="support-reply-status">Ticket status</Label>
              <Select value={replyStatus} onValueChange={setReplyStatus}>
                <SelectTrigger id="support-reply-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="support-reply-text">Reply</Label>
              <Textarea
                id="support-reply-text"
                rows={5}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                placeholder="Write the response that library admins should receive."
              />
            </div>

            <Button
              className="w-full"
              disabled={!replyTarget || replyMutation.isPending || !replyText.trim()}
              onClick={() => {
                if (!replyTarget) return;
                replyMutation.mutate({
                  notification: replyTarget,
                  reply: replyText,
                  status: replyStatus,
                });
              }}
            >
              {replyMutation.isPending ? "Sending..." : "Send reply"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NotificationCenter;
