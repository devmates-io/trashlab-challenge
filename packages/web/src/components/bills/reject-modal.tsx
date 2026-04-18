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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useRejectApproval } from "@/hooks/use-bills";

export function RejectModal({
  open,
  onOpenChange,
  billId,
  approvalId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billId: string;
  approvalId: string | null;
}): React.ReactElement {
  const reject = useRejectApproval(billId);
  const [reason, setReason] = React.useState("");

  // Reset textarea contents when the modal closes.
  React.useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  async function onConfirm() {
    if (!approvalId) {
      toast.error("No eligible approval to reject.", { duration: Infinity });
      return;
    }
    try {
      await reject.mutateAsync({
        approval_id: approvalId,
        reason: reason.trim() ? reason.trim() : null,
      });
      toast.success("Bill rejected.");
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to reject bill.";
      toast.error(msg, { duration: Infinity });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject bill?</DialogTitle>
          <DialogDescription>
            Why are you rejecting this bill? (Optional — max 500 characters.)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">Reason</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            disabled={reject.isPending}
          />
          <p className="text-xs text-muted-foreground">
            {reason.length}/500
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={reject.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={reject.isPending || !approvalId}
          >
            {reject.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Reject bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
