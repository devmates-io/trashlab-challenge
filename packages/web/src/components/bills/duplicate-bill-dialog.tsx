import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { PossibleDuplicateMatch } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BillStatusBadge } from "@/components/bills/status-badge";
import { formatDate, formatMoney } from "@/lib/format";

// §6.10.3 — confirmation surface for the POSSIBLE_DUPLICATE 409. Listing
// every match with a deep link lets the user verify before retrying with
// `force=true`. We deliberately do NOT auto-bypass on retry — the user
// must click "Create anyway" each time, so a fat-fingered second click
// can't accidentally bypass.
export function DuplicateBillDialog({
  open,
  matches,
  onCancel,
  onConfirm,
  isConfirming,
}: {
  open: boolean;
  matches: PossibleDuplicateMatch[];
  onCancel: () => void;
  onConfirm: () => void;
  isConfirming: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isConfirming) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Possible duplicate bill
          </DialogTitle>
          <DialogDescription>
            We found {matches.length === 1 ? "another bill" : `${matches.length} other bills`}{" "}
            with the same invoice number for this vendor in the last year. Open
            an existing one to confirm — or create anyway if this is a new
            invoice.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-md border">
          {matches.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {m.invoice_number}
                  </span>
                  <BillStatusBadge status={m.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {m.vendor_name} · {formatMoney(m.amount_cents)} · due{" "}
                  {formatDate(m.due_date)}
                </p>
              </div>
              <Button
                asChild
                variant="ghost"
                size="sm"
                onClick={onCancel}
                title="Open the existing bill"
              >
                <Link to={`/bills/${m.id}`}>
                  Open <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isConfirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isConfirming ? "Creating…" : "Create anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
