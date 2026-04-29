import * as React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Pencil, Plus, UserCheck, UserX } from "lucide-react";
import type { UserDTO, UserRole } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRealUser } from "@/hooks/use-current-user";
import {
  useActivateUser,
  useDeactivateUser,
  useUsers,
} from "@/hooks/use-users";
import { formatMoney } from "@/lib/format";
import { toastApiError, toastSuccess } from "@/components/vendors/shared";
import { DeactivateUserDialog } from "@/components/users/deactivate-user-dialog";

const ROLE_LABEL: Record<UserRole, string> = {
  submitter: "Submitter",
  approver: "Approver",
  admin: "Admin",
};

type ToggleAction = "deactivate" | "activate";

export default function UsersListPage(): React.ReactElement {
  const realUser = useRealUser();
  const users = useUsers();
  const navigate = useNavigate();
  const deactivate = useDeactivateUser();
  const activate = useActivateUser();

  const [pending, setPending] = React.useState<{
    user: UserDTO;
    action: ToggleAction;
  } | null>(null);

  React.useEffect(() => {
    if (users.isError) toastApiError(users.error);
  }, [users.isError, users.error]);

  // Wait for the auth query before deciding admin / non-admin so the page
  // doesn't flash content for non-admins. Once it resolves, anyone who isn't
  // an admin is sent home.
  if (realUser.isLoading) {
    return <UsersListSkeleton />;
  }
  if (!realUser.data || realUser.data.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // §6.5.4: API returns users sorted by name asc; we sort defensively in case
  // that contract changes, and so the order is stable while a row's status
  // is being toggled.
  const rows = (users.data ?? []).slice().sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const showEmpty = !users.isLoading && !users.isError && rows.length === 0;
  const isToggling = deactivate.isPending || activate.isPending;
  const realUserId = realUser.data.id;

  async function handleConfirm() {
    if (!pending) return;
    const { user, action } = pending;
    try {
      if (action === "deactivate") {
        await deactivate.mutateAsync(user.id);
        toastSuccess(`Deactivated ${user.name}.`);
      } else {
        await activate.mutateAsync(user.id);
        toastSuccess(`Activated ${user.name}.`);
      }
    } catch (err) {
      // Graceful surface for the API's "can't deactivate yourself" 409 — the
      // button is also disabled client-side, but if the server enforces this
      // for any reason we want a non-cryptic message.
      toastApiError(err);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          People who can sign in, submit bills, and approve payments.
        </p>
        <Button asChild>
          <Link to="/users/new">
            <Plus className="mr-2 h-4 w-4" />
            New user
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Approval limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`skel-${i}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-8 w-40" />
                  </TableCell>
                </TableRow>
              ))}
            {!users.isLoading &&
              rows.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={user.id === realUserId}
                  onEdit={() => navigate(`/users/${user.id}/edit`)}
                  onToggle={() =>
                    setPending({
                      user,
                      action: user.is_active ? "deactivate" : "activate",
                    })
                  }
                  pendingForThis={
                    isToggling && pending?.user.id === user.id
                  }
                />
              ))}
          </TableBody>
        </Table>

        {showEmpty && (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No users yet. Add a teammate to get started.
            </p>
            <Button asChild>
              <Link to="/users/new">
                <Plus className="mr-2 h-4 w-4" />
                New user
              </Link>
            </Button>
          </div>
        )}

        {users.isError && !users.isLoading && (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Could not load users. Please try again.
            </p>
            <Button variant="outline" onClick={() => users.refetch()}>
              Retry
            </Button>
          </div>
        )}
      </div>

      <DeactivateUserDialog
        open={pending !== null}
        action={pending?.action ?? "deactivate"}
        userName={pending?.user.name ?? ""}
        isPending={isToggling}
        onCancel={() => {
          if (!isToggling) setPending(null);
        }}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onEdit,
  onToggle,
  pendingForThis,
}: {
  user: UserDTO;
  isSelf: boolean;
  onEdit: () => void;
  onToggle: () => void;
  pendingForThis: boolean;
}) {
  // §6.6: inactive rows visually de-emphasized with reduced opacity; the
  // explicit "Inactive" badge is also rendered for non-color-dependent cues.
  const rowClass = user.is_active ? undefined : "opacity-60";
  return (
    <TableRow className={rowClass}>
      <TableCell className="font-medium">
        {user.name}
        {isSelf && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (you)
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{user.email}</TableCell>
      <TableCell>{ROLE_LABEL[user.role]}</TableCell>
      <TableCell>{formatMoney(user.max_approval_amount_cents)}</TableCell>
      <TableCell>
        {user.is_active ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
          {user.is_active ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              // Admin can't deactivate themselves — surfaced as a disabled
              // button with a hint. Server enforces the same rule (409) but
              // disabling client-side keeps the affordance unambiguous.
              disabled={isSelf || pendingForThis}
              title={
                isSelf ? "You can't deactivate yourself." : undefined
              }
            >
              <UserX className="mr-1 h-3.5 w-3.5" />
              Deactivate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              disabled={pendingForThis}
            >
              <UserCheck className="mr-1 h-3.5 w-3.5" />
              Activate
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function UsersListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
