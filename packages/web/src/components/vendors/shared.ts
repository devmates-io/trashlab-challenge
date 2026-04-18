import { toast } from "sonner";
import type { BillStatus, PaymentMethod } from "@bill-pay/shared";
import { ApiError } from "@/lib/api";

// §6.6.7 list column uses mixed case (ACH / Check / Wire / Card).
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  card: "Card",
};

// §6.6.7 detail uses all-upper (ACH / CHECK / WIRE / CARD).
export const PAYMENT_METHOD_LABEL_UPPER: Record<PaymentMethod, string> = {
  ach: "ACH",
  check: "CHECK",
  wire: "WIRE",
  card: "CARD",
};

// §6.6.6 badge colors per bill state — used by the vendor-detail bills table.
export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

export function billStatusBadgeVariant(
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

// §6.6.11 toast patterns.
// - Success: autoclose 4s.
// - Error 4xx: manual dismiss with API `detail`.
// - Error 5xx: generic "Something went wrong…" (no autoclose per spec).
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

// Mask account_number / last_four display (§6.6.7 / V-AC-4).
export function maskLast4(value: string): string {
  const last4 = value.slice(-4);
  return `••••${last4}`;
}
