import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { useApproveBill, type BillApprovalDTO } from "@/hooks/use-bills";

export function ApproveModal({
  open,
  onOpenChange,
  billId,
  eligibleApprovals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billId: string;
  eligibleApprovals: BillApprovalDTO[];
}): React.ReactElement {
  const approve = useApproveBill(billId);
  const count = eligibleApprovals.length;
  const ruleNames = eligibleApprovals
    .map((a) => a.rule_name_snapshot)
    .join(", ");

  async function onConfirm() {
    try {
      const bill = await approve.mutateAsync();
      const fullyApproved = bill.status === "approved";
      toast.success(
        fullyApproved ? "Bill approved." : "Approval recorded.",
      );
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to approve bill.";
      toast.error(msg, { duration: Infinity });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve this bill?</DialogTitle>
          <DialogDescription>
            This will record {count} approval{count === 1 ? "" : "s"}
            {ruleNames ? <>: {ruleNames}.</> : "."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={approve.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={approve.isPending}>
            {approve.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Yes, approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
