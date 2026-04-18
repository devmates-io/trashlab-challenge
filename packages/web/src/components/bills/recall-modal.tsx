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
import { useRecallBill } from "@/hooks/use-bills";
import { ApiError } from "@/lib/api";

export function RecallModal({
  open,
  onOpenChange,
  billId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billId: string;
}): React.ReactElement {
  const recall = useRecallBill(billId);

  async function onConfirm() {
    try {
      await recall.mutateAsync();
      toast.success("Bill recalled back to draft.");
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to recall bill.";
      toast.error(msg, { duration: Infinity });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recall this bill?</DialogTitle>
          <DialogDescription>
            Recall this bill back to draft? All pending approvals will be
            cancelled.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={recall.isPending}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={recall.isPending}>
            {recall.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Yes, recall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
