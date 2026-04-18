import * as React from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useBill } from "@/hooks/use-bills";
import { useCurrentUser } from "@/hooks/use-current-user";
import { BillForm } from "@/components/bills/bill-form";

export default function BillEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const billQuery = useBill(id);
  const currentUserQuery = useCurrentUser();

  if (billQuery.isLoading || currentUserQuery.isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading bill…
      </div>
    );
  }

  if (billQuery.isError) {
    const err = billQuery.error as ApiError | undefined;
    if (err instanceof ApiError && err.status === 404) {
      return (
        <div className="rounded-lg border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">Bill not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Couldn't load bill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {err?.detail ?? "An unexpected error occurred."}
        </p>
      </div>
    );
  }

  const bill = billQuery.data;
  const user = currentUserQuery.data;
  if (!bill || !user) return <Navigate to="/bills" replace />;

  // Edit access is guarded server-side (T2: NOT_BILL_CREATOR / ILLEGAL_TRANSITION).
  // UI guards match to avoid confusing the user (§6.6.5).
  if (bill.status !== "draft") {
    return <Navigate to={`/bills/${bill.id}`} replace />;
  }
  if (bill.created_by_user_id !== user.id) {
    return <Navigate to={`/bills/${bill.id}`} replace />;
  }

  return <BillForm mode="edit" initial={bill} />;
}
