import { formatDistanceToNowStrict } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useNotificationActions,
  useNotificationRealtime,
  useNotificationSummary,
} from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

type NotificationBellProps = {
  notificationsPath: string;
  showLibraryName?: boolean;
};

const NotificationBell = ({
  notificationsPath,
  showLibraryName = false,
}: NotificationBellProps) => {
  const navigate = useNavigate();
  useNotificationRealtime();
  const { data, isLoading } = useNotificationSummary(6);
  const { markAllAsRead, markAsRead } = useNotificationActions();

  const recent = data?.recent ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const unreadDisplay = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:text-foreground">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {unreadDisplay}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <p className="text-xs text-muted-foreground">
              {unreadCount} unread
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            disabled={unreadCount === 0 || markAllAsRead.isPending}
            onClick={() => markAllAsRead.mutate()}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all
          </Button>
        </div>

        <ScrollArea className="max-h-[360px]">
          <div className="p-2">
            {isLoading ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Loading notifications...
              </p>
            ) : recent.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : (
              recent.map((notification) => (
                <button
                  key={notification.id}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    notification.is_read
                      ? "border-transparent hover:bg-muted/50"
                      : "border-primary/20 bg-primary/5 hover:bg-primary/10",
                  )}
                  onClick={() => {
                    if (!notification.is_read) {
                      markAsRead.mutate(notification.id);
                    }
                    navigate(notificationsPath);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 rounded-full",
                        notification.is_read ? "bg-muted-foreground/30" : "bg-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-foreground">
                          {notification.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatDistanceToNowStrict(new Date(notification.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {notification.message || "Notification"}
                      </p>
                      {showLibraryName && notification.libraries?.name ? (
                        <p className="mt-2 text-[11px] font-medium text-foreground/80">
                          {notification.libraries.name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="w-full justify-center"
            onClick={() => navigate(notificationsPath)}
          >
            View all notifications
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default NotificationBell;
