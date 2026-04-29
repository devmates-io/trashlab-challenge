import * as React from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { UserDTO } from "@bill-pay/shared";
import { ApiError } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  useImpersonate,
  useIsImpersonating,
  useRealUser,
  useUsers,
} from "@/hooks/use-current-user";
import { formatMoney } from "@/lib/format";

// Admin-only "Login as another user" dropdown. Replaces the previous
// header-based user picker (which was an unauthenticated workaround in §6.6.1
// for the demo, removed once real login landed).
//
// Visibility: only when the real session owner is admin AND not currently
// impersonating someone. While impersonating, the layout shows an "Acting as
// …" pill in this same slot instead.
//
// Eligible-impersonation-target rules — kept loose client-side because the
// API enforces them authoritatively (Package B, 403 codes):
//   - Cannot impersonate self.
//   - Cannot impersonate other admins (admin-on-admin is rejected).
//   - Cannot impersonate inactive users.
// Any user that fails one of these is filtered out of the dropdown so the
// admin doesn't even attempt the action.
export function UserSwitcher() {
  const realUser = useRealUser();
  const isImpersonating = useIsImpersonating();
  const usersQuery = useUsers();
  const impersonate = useImpersonate();

  const isAdmin = realUser.data?.role === "admin";

  // Gate the entire component. The layout already routes around this when
  // !isAdmin || isImpersonating, but we double-check here so a misuse of
  // <UserSwitcher /> in a different surface still degrades safely.
  if (!isAdmin || isImpersonating) return null;

  const realId = realUser.data?.id;
  const eligible: UserDTO[] = (usersQuery.data ?? []).filter((u) => {
    if (!u.is_active) return false;
    if (u.id === realId) return false;
    if (u.role === "admin") return false;
    return true;
  });

  async function handleImpersonate(userId: string) {
    try {
      await impersonate.mutateAsync(userId);
    } catch (err) {
      // Surface the API's 403 detail (e.g. CANNOT_IMPERSONATE_SELF). 5xx
      // collapses to a generic message — same toast policy as §6.6.11.
      if (err instanceof ApiError && err.status < 500) {
        toast.error(err.detail, { duration: Number.POSITIVE_INFINITY });
        return;
      }
      toast.error("Couldn't impersonate that user. Please try again.", {
        duration: Number.POSITIVE_INFINITY,
      });
    }
  }

  if (usersQuery.isLoading) {
    return (
      <Button variant="outline" disabled className="gap-2">
        Loading…
      </Button>
    );
  }
  if (usersQuery.isError) {
    return (
      <Button variant="outline" disabled className="gap-2">
        Couldn't load users
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={impersonate.isPending}>
          <span className="font-medium">Login as another user</span>
          <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Impersonate</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {eligible.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            No eligible users.
          </div>
        ) : (
          eligible.map((u) => (
            <DropdownMenuItem
              key={u.id}
              onSelect={() => handleImpersonate(u.id)}
              className="flex items-start justify-between gap-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{u.name}</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {u.role} · Limit {formatMoney(u.max_approval_amount_cents)}
                </span>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
