import * as React from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PaymentMethod } from "@bill-pay/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  estimatedSettlementDate,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/format";
import { usePayBill, type BillDetailDTO } from "@/hooks/use-bills";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  card: "Card",
};

function settlementDescription(method: PaymentMethod): string {
  switch (method) {
    case "ach":
      return "2 business days";
    case "check":
      return "7 calendar days";
    case "wire":
      return "Same day";
    case "card":
      return "Same day";
  }
}

// §6.6.6 + §6.7.5 — a single Dialog switches between "confirm payment" and
// "receipt" states. On confirm success we DO NOT close and reopen the dialog
// (per §6.7.5); we mutate its inner content.

export function PayModal({
  open,
  onOpenChange,
  bill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: BillDetailDTO;
}): React.ReactElement {
  const method = bill.vendor.payment_method;
  const pay = usePayBill(bill.id);

  // `paidBill` lets us render the receipt content once the pay mutation
  // succeeds. The mutation result includes BillDetailDTO with `payment`.
  const [paidBill, setPaidBill] = React.useState<BillDetailDTO | null>(null);
  const idempotencyKeyRef = React.useRef<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Reset on open close.
  React.useEffect(() => {
    if (!open) {
      setPaidBill(null);
      idempotencyKeyRef.current = null;
      setCopied(false);
    } else {
      // Generate a fresh idempotency key per open (§6.5.4 — scoped per click).
      idempotencyKeyRef.current = crypto.randomUUID();
    }
  }, [open]);

  const estimate = React.useMemo(
    () => estimatedSettlementDate(new Date(), method),
    [method],
  );

  const showReceipt = paidBill?.payment != null;

  async function onConfirm() {
    try {
      const updated = await pay.mutateAsync({
        idempotencyKey:
          idempotencyKeyRef.current ?? crypto.randomUUID(),
      });
      setPaidBill(updated);
      toast.success("Payment successful.");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to process payment.";
      toast.error(msg, { duration: Infinity });
    }
  }

  async function copyReference() {
    const ref = paidBill?.payment?.mock_reference;
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard.", { duration: Infinity });
    }
  }

  // §6.7.5: receipt modal is non-dismissable on outside click / ESC.
  const receiptOnly = showReceipt;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While showing the receipt we only allow explicit Done to close.
        if (receiptOnly && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        onPointerDownOutside={(e) => {
          if (receiptOnly) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (receiptOnly) e.preventDefault();
        }}
      >
        {!showReceipt ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm payment</DialogTitle>
              <DialogDescription>
                Pay {formatMoney(bill.amount_cents)} via {METHOD_LABEL[method]}{" "}
                to {bill.vendor.name}? This cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border bg-muted/30 p-4 text-sm">
              <DetailRow label="Bill">
                {bill.invoice_number} — {bill.vendor.name}
              </DetailRow>
              <DetailRow label="Amount">
                {formatMoney(bill.amount_cents)}
              </DetailRow>
              <DetailRow label="Method">{METHOD_LABEL[method]}</DetailRow>
              <DetailRow label="Estimated completion">
                {formatDate(estimate)} ({settlementDescription(method)})
              </DetailRow>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pay.isPending}
              >
                Cancel
              </Button>
              <Button onClick={onConfirm} disabled={pay.isPending}>
                {pay.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Confirm payment
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="items-center text-center sm:text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-6 w-6" />
              </div>
              <DialogTitle>Payment successful</DialogTitle>
            </DialogHeader>

            {paidBill?.payment && (
              <div className="rounded-md border bg-muted/30 p-4 text-sm">
                <DetailRow label="Bill">
                  {paidBill.invoice_number} — {paidBill.vendor.name}
                </DetailRow>
                <DetailRow label="Amount">
                  {formatMoney(paidBill.payment.amount_cents)}
                </DetailRow>
                <DetailRow label="Method">
                  {METHOD_LABEL[paidBill.payment.payment_method]}
                </DetailRow>
                <DetailRow label="Reference">
                  <span className="font-mono">
                    {paidBill.payment.mock_reference}
                  </span>
                </DetailRow>
                <DetailRow label="Initiated">
                  {formatDateTime(paidBill.payment.initiated_at)}
                </DetailRow>
                <DetailRow label="Estimated completion">
                  {formatDate(
                    estimatedSettlementDate(
                      new Date(paidBill.payment.initiated_at),
                      paidBill.payment.payment_method,
                    ),
                  )}{" "}
                  ({settlementDescription(paidBill.payment.payment_method)})
                </DetailRow>
              </div>
            )}

            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch sm:space-x-0">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
              <button
                type="button"
                onClick={copyReference}
                className="inline-flex items-center justify-center gap-1.5 text-sm text-primary hover:underline"
                title={copied ? "Copied" : "Copy reference"}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy reference
                  </>
                )}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
