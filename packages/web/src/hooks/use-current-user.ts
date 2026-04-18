import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserDTO } from "@bill-pay/shared";
import {
  CURRENT_USER_STORAGE_KEY,
  apiFetch,
  getCurrentUserId,
  setCurrentUserId,
} from "@/lib/api";

// Read the current user id from localStorage reactively. Components that
// display the identity re-render when the id changes (via a storage listener
// plus a custom event we dispatch on set).
const STORAGE_EVENT = "bill-pay:current-user-changed";

function dispatchChangeEvent() {
  try {
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    /* noop */
  }
}

export function useCurrentUserId(): string | null {
  const [id, setId] = React.useState<string | null>(() => getCurrentUserId());
  React.useEffect(() => {
    const sync = () => setId(getCurrentUserId());
    window.addEventListener(STORAGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(STORAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return id;
}

// List endpoint doesn't require a current user, but our api middleware
// enforces it. The hook below is used by the user switcher, which exists to
// pick a user — if none picked yet, we temporarily use the first known id
// returned from a list with a fallback behavior. For MVP simplicity we just
// call /users with whatever id is stored; on first load localStorage is
// empty, and the server returns 401. The App component handles bootstrap by
// also calling /users with a fallback approach — see user-switcher.tsx.

export function useUsers() {
  return useQuery<UserDTO[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserDTO[]>("/users"),
  });
}

export function useCurrentUser() {
  const id = useCurrentUserId();
  return useQuery<UserDTO>({
    queryKey: ["users", "me", id],
    queryFn: () => apiFetch<UserDTO>("/users/me"),
    enabled: id !== null,
  });
}

export function useSetCurrentUser() {
  const queryClient = useQueryClient();
  return React.useCallback(
    (id: string | null) => {
      setCurrentUserId(id);
      dispatchChangeEvent();
      // Per §6.6.1: "invalidates all React Query caches so views reflect the
      // new perspective".
      queryClient.invalidateQueries();
    },
    [queryClient],
  );
}

export { CURRENT_USER_STORAGE_KEY };
