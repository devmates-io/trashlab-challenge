import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserForm,
  toCreateUserRequest,
  type UserFormValues,
} from "@/components/users/user-form";
import { useRealUser } from "@/hooks/use-current-user";
import { useCreateUser } from "@/hooks/use-users";
import { toastSuccess } from "@/components/vendors/shared";

export default function UserCreatePage(): React.ReactElement {
  const navigate = useNavigate();
  const realUser = useRealUser();
  const createUser = useCreateUser();

  if (realUser.isLoading) {
    return <CreatePageSkeleton />;
  }
  // Admin-only route — same gate as the list page.
  if (!realUser.data || realUser.data.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(values: UserFormValues) {
    const body = toCreateUserRequest(values);
    await createUser.mutateAsync(body);
    toastSuccess("User created.");
    navigate("/users");
  }

  return (
    <UserForm
      mode="create"
      isSubmitting={createUser.isPending}
      onSubmit={handleSubmit}
      onCancel={() => navigate("/users")}
    />
  );
}

function CreatePageSkeleton() {
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
