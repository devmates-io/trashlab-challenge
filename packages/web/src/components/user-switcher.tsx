import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { UserDTO } from "@bill-pay/shared";
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
  useCurrentUserId,
  useSetCurrentUser,
  useUsers,
} from "@/hooks/use-current-user";
import { formatMoney } from "@/lib/format";

// Known seeded user id used as a bootstrap default so the very first load
// (before localStorage is populated) has a valid X-User-Id to send. §6.8.2.
const BOOTSTRAP_USER_ID = "user_alice";

export function UserSwitcher() {
  const userId = useCurrentUserId();
  const setUser = useSetCurrentUser();

  // Bootstrap the stored id once, synchronously, so the first /users call
  // actually has a header and doesn't 401. The useEffect runs after the
  // first render; a setState in an effect keeps this safe from double-setting.
  React.useEffect(() => {
    if (userId === null) {
      setUser(BOOTSTRAP_USER_ID);
    }
  }, [userId, setUser]);

  const { data: users, isLoading, isError } = useUsers();
  const currentUser: UserDTO | undefined = React.useMemo(() => {
    if (!users || users.length === 0) return undefined;
    return users.find((u) => u.id === userId) ?? users[0];
  }, [users, userId]);

  // If the stored id doesn't match any returned user, default to first.
  React.useEffect(() => {
    if (!users || users.length === 0) return;
    if (!users.some((u) => u.id === userId)) {
      setUser(users[0].id);
    }
  }, [users, userId, setUser]);

  if (isLoading) {
    return (
      <Button variant="outline" disabled className="gap-2">
        Loading…
      </Button>
    );
  }
  if (isError || !currentUser) {
    return (
      <Button variant="outline" disabled className="gap-2">
        No users
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <span className="font-medium">{currentUser.name}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Limit {formatMoney(currentUser.max_approval_amount_cents)}
          </span>
          <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Switch user</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(users ?? []).map((u) => (
          <DropdownMenuItem
            key={u.id}
            onSelect={() => setUser(u.id)}
            className="flex items-start justify-between gap-3"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{u.name}</span>
              <span className="text-xs text-muted-foreground">
                {u.role} · Limit {formatMoney(u.max_approval_amount_cents)}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
