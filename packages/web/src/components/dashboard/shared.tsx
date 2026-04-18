import * as React from "react";
import { toast } from "sonner";
import type { BillStatus } from "@bill-pay/shared";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";

// §6.6.6 bill-status labels — kept local to dashboard scope so we don't couple
// to other engineers' components/{vendors,bills}/ modules. A tiny duplicate is
// the right trade-off for parallel development.
const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

function billStatusVariant(
  status: BillStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid":
    case "approved":
      return "default";
    case "pending_approval":
      return "secondary";
    case "rejected":
      return "destructive";
    case "draft":
    default:
      return "outline";
  }
}

export function BillStatusBadge({
  status,
}: {
  status: BillStatus;
}): React.ReactElement {
  return (
    <Badge variant={billStatusVariant(status)}>
      {BILL_STATUS_LABEL[status]}
    </Badge>
  );
}

// §6.6.11 toast patterns — success autoclose 4s, 4xx manual dismiss with the
// server's `detail`, 5xx generic. These helpers stay local to dashboard / rules
// scope to avoid cross-engineer imports.
export function toastSuccess(message: string): void {
  toast.success(message, { duration: 4000 });
}

export function toastApiError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      toast.error("Something went wrong. Please try again.", {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }
    toast.error(err.detail, { duration: Number.POSITIVE_INFINITY });
    return;
  }
  toast.error("Something went wrong. Please try again.", {
    duration: Number.POSITIVE_INFINITY,
  });
}
