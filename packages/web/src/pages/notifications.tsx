import * as React from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import type { NotificationDTO } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications";

// §6.10.4 — full notifications page. Surfaces the same data the bell
// dropdown shows but with more breathing room and a permanent target for
// "View all" deep links.

const TYPE_HEADLINES: Record<NotificationDTO["type"], string> = {
  bill_submitted: "Bill submitted for your approval",
  bill_approved: "Bill fully approved",
  bill_rejected: "Bill rejected",
  bill_paid: "Bill paid",
};

function formatDateTime(iso: string): string {
  const dt = new Date(iso);
  return dt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function NotificationsPage(): React.ReactElement {
  const navigate = useNavigate();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const items = notifications.data?.notifications ?? [];
  const unreadCount = notifications.data?.unread_count ?? 0;

  function handleSelect(n: NotificationDTO) {
    if (n.read_at === null) markRead.mutate(n.id);
    if (n.bill_id) navigate(`/bills/${n.bill_id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unreadCount === 0
            ? "You're all caught up."
            : `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`}
        </p>
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        {notifications.isLoading ? (
          <div className="divide-y">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-4">
                <Skeleton className="h-2 w-2 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No notifications yet. They'll appear here when bills are submitted,
            approved, rejected, or paid.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    n.read_at === null && "bg-blue-50/60 dark:bg-blue-950/20",
                  )}
                >
                  <div
                    className={cn(
                      "mt-2 h-2 w-2 shrink-0 rounded-full",
                      n.read_at === null ? "bg-blue-500" : "bg-transparent",
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {TYPE_HEADLINES[n.type]}
                      </span>
                      {n.read_at === null && (
                        <Badge variant="secondary" className="text-[10px]">
                          New
                        </Badge>
                      )}
                    </div>
                    {n.bill_summary && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {n.bill_summary.vendor_name} ·{" "}
                        {formatMoney(n.bill_summary.amount_cents)} ·{" "}
                        {n.bill_summary.status.replace(/_/g, " ")}
                      </p>
                    )}
                    {n.type === "bill_rejected" &&
                    typeof n.payload.rejection_reason === "string" &&
                    n.payload.rejection_reason ? (
                      <p className="mt-1 italic text-xs text-muted-foreground">
                        Reason: "{n.payload.rejection_reason}"
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDateTime(n.created_at)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
