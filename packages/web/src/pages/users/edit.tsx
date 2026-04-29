import * as React from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserForm,
  toAdminUpdateRequest,
  toSelfUpdateRequest,
  type UserFormValues,
} from "@/components/users/user-form";
import { useRealUser } from "@/hooks/use-current-user";
import { useUpdateUser, useUser } from "@/hooks/use-users";
import { toastApiError, toastSuccess } from "@/components/vendors/shared";

export default function UserEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const realUser = useRealUser();
  const userQuery = useUser(id);
  const updateUser = useUpdateUser(id ?? "");

  React.useEffect(() => {
    if (userQuery.isError) toastApiError(userQuery.error);
  }, [userQuery.isError, userQuery.error]);

  // Wait for both auth + target user before deciding what to render. Auth
  // gates access; target user data drives form initial values.
  if (realUser.isLoading || userQuery.isLoading) {
    return <EditPageSkeleton />;
  }

  // Without a real user we can't make any auth decision — bail to the root
  // (Package C handles redirect-to-login at the App level).
  if (!realUser.data) {
    return <Navigate to="/" replace />;
  }

  const isAdmin = realUser.data.role === "admin";
  const isSelfEdit = realUser.data.id === id;
  // Non-admin can only edit their own profile. Anyone else: redirect home.
  if (!isAdmin && !isSelfEdit) {
    return <Navigate to="/" replace />;
  }

  if (userQuery.isError || !userQuery.data) {
    const notFound =
      userQuery.error instanceof ApiError && userQuery.error.status === 404;
    return (
      <div className="rounded-lg border border-dashed bg-card p-10 text-center">
        <h2 className="text-xl font-semibold">
          {notFound ? "User not found" : "Could not load user"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {notFound
            ? "It may have been deleted."
            : "Please try again in a moment."}
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => navigate(isAdmin ? "/users" : "/")}
          >
            {isAdmin ? "Back to users" : "Back to dashboard"}
          </Button>
        </div>
      </div>
    );
  }

  const user = userQuery.data;
  // The form's "Permissions" section is shown only when the actor can change
  // role / limit / active. Admins always can; non-admin self-edits cannot.
  const canEditAllFields = isAdmin;

  async function handleSubmit(values: UserFormValues) {
    const body = canEditAllFields
      ? toAdminUpdateRequest(values)
      : toSelfUpdateRequest(values);
    await updateUser.mutateAsync(body);
    toastSuccess("User updated.");
    // Admin lands back on the user list; non-admin goes home (the only place
    // they can navigate to after a profile edit, since they can't see /users).
    navigate(isAdmin ? "/users" : "/");
  }

  return (
    <UserForm
      mode="edit"
      user={user}
      canEditAllFields={canEditAllFields}
      isSelfEdit={isSelfEdit}
      isSubmitting={updateUser.isPending}
      onSubmit={handleSubmit}
      onCancel={() => navigate(isAdmin ? "/users" : "/")}
    />
  );
}

function EditPageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
