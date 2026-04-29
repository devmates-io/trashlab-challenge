import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import type { NotificationDTO } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications";

// §6.10.4 — header bell. Click to open a dropdown listing the most recent
// 50 notifications; click any row to deep-link to its bill (and mark
// it as read in the same gesture). "Mark all read" lives in the dropdown
// header — visible only when there are unread items.

const TYPE_HEADLINES: Record<NotificationDTO["type"], string> = {
  bill_submitted: "Bill submitted for your approval",
  bill_approved: "Bill fully approved",
  bill_rejected: "Bill rejected",
  bill_paid: "Bill paid",
};

function relativeTime(iso: string): string {
  const dt = new Date(iso).getTime();
  const diffMs = Date.now() - dt;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const navigate = useNavigate();
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const data = notifications.data;
  const items = data?.notifications ?? [];
  const unreadCount = data?.unread_count ?? 0;

  function handleSelect(n: NotificationDTO) {
    if (n.read_at === null) {
      markRead.mutate(n.id);
    }
    if (n.bill_id) {
      navigate(`/bills/${n.bill_id}`);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative gap-2"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : "Notifications"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="h-auto px-2 py-1 text-xs"
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[26rem] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {notifications.isLoading
                ? "Loading…"
                : "You're all caught up."}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                      n.read_at === null && "bg-blue-50/60 dark:bg-blue-950/20",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        n.read_at === null ? "bg-blue-500" : "bg-transparent",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight">
                        {TYPE_HEADLINES[n.type]}
                      </p>
                      {n.bill_summary && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {n.bill_summary.vendor_name} ·{" "}
                          {formatMoney(n.bill_summary.amount_cents)}
                        </p>
                      )}
                      {n.type === "bill_rejected" &&
                      typeof n.payload.rejection_reason === "string" &&
                      n.payload.rejection_reason ? (
                        <p className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
                          "{n.payload.rejection_reason}"
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {relativeTime(n.created_at)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-3 py-2 text-center">
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
            <Link to="/notifications">View all</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
