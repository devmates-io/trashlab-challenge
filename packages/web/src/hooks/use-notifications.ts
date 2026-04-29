import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { NotificationListResponse } from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";

// §6.10.4 — notifications hooks. The bell icon, the dropdown, and the
// /notifications page all read from the same query so the unread count
// and the list stay in sync without manual coordination.

export const NOTIFICATIONS_KEY = ["notifications"] as const;

// Polling interval. Notifications are produced by server-side state
// transitions, so we don't get push events — a 30s poll keeps the bell
// reasonably current without putting unnecessary load on the API. The
// query also refetches on window focus / mount so coming back to the tab
// gets a fresh count immediately.
const POLL_INTERVAL_MS = 30_000;

export function useNotifications(): UseQueryResult<NotificationListResponse> {
  return useQuery<NotificationListResponse>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiFetch<NotificationListResponse>("/notifications"),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

// Mark-read for a single notification. The server returns the updated
// row; we invalidate the list query so the unread count stays accurate.
// We could optimistic-update, but the operation is fast enough that the
// re-fetch on settle is sufficient.
export function useMarkNotificationRead(): UseMutationResult<
  unknown,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/read`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

// Bulk mark-all-read.
export function useMarkAllNotificationsRead(): UseMutationResult<
  unknown,
  unknown,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/notifications/read-all", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
