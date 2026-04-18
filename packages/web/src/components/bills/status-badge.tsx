import * as React from "react";
import type { BillStatus } from "@bill-pay/shared";
import { cn } from "@/lib/utils";

// §6.6.6 status-badge colors: draft=gray, pending=amber, approved=blue,
// paid=green, rejected=red. We render a pill using tailwind colors directly
// rather than reusing shadcn Badge variants, which don't include these hues.

const STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

const STATUS_CLASS: Record<BillStatus, string> = {
  draft: "bg-slate-200 text-slate-800 border-slate-300",
  pending_approval: "bg-amber-100 text-amber-900 border-amber-300",
  approved: "bg-sky-100 text-sky-900 border-sky-300",
  paid: "bg-emerald-100 text-emerald-900 border-emerald-300",
  rejected: "bg-rose-100 text-rose-900 border-rose-300",
};

export function BillStatusBadge({
  status,
  className,
  size = "sm",
}: {
  status: BillStatus;
  className?: string;
  size?: "sm" | "md";
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
