import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Single confirmation modal that handles both directions of the active /
// inactive toggle. Activation is reversible and harmless; we still gate it
// behind a confirm because the row's "Activate" button is the symmetric
// counterpart of "Deactivate" and consistency is more valuable here than
// shaving one click. Mirrors `delete-vendor-dialog.tsx`.
type Props = {
  open: boolean;
  action: "deactivate" | "activate";
  userName: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeactivateUserDialog({
  open,
  action,
  userName,
  isPending,
  onCancel,
  onConfirm,
}: Props) {
  const isDeactivate = action === "deactivate";
  const title = isDeactivate ? "Deactivate user" : "Activate user";
  const description = isDeactivate ? (
    <>
      Are you sure you want to deactivate <strong>{userName}</strong>? They
      will no longer be able to log in or appear in new approval pools.
      Existing approvals are unaffected. This can be reversed at any time.
    </>
  ) : (
    <>
      Re-enable <strong>{userName}</strong>? They will be able to log in
      again immediately.
    </>
  );
  const confirmLabel = isDeactivate ? "Deactivate" : "Activate";
  const pendingLabel = isDeactivate ? "Deactivating…" : "Activating…";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isPending) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={isDeactivate ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
