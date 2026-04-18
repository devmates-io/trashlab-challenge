import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
  useDeleteApprovalRule,
  usePatchApprovalRule,
  type ApprovalRuleListItem,
} from "@/hooks/use-approval-rules";
import {
  toastApiError,
  toastSuccess,
} from "@/components/approval-rules/shared";

// §6.6.9 delete confirmation. Server may reject with V7 (RULE_IN_USE) or V6
// (DEFAULT_RULE_REQUIRED); we surface each with the appropriate toast + action.
export function DeleteRuleDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: ApprovalRuleListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {rule ? (
          <DeleteRuleBody rule={rule} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteRuleBody({
  rule,
  onClose,
}: {
  rule: ApprovalRuleListItem;
  onClose: () => void;
}): React.ReactElement {
  const del = useDeleteApprovalRule();
  const patch = usePatchApprovalRule();
  const isSubmitting = del.isPending || patch.isPending;

  const deactivateInstead = async () => {
    try {
      await patch.mutateAsync({
        id: rule.id,
        body: { is_active: false },
      });
      toastSuccess("Rule deactivated.");
    } catch (err) {
      toastApiError(err);
    }
  };

  const onConfirm = async () => {
    try {
      await del.mutateAsync(rule.id);
      toastSuccess("Rule deleted.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "RULE_IN_USE") {
        toast.error(
          "This rule cannot be deleted because it has pending approvals. Deactivate instead?",
          {
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Deactivate",
              onClick: () => {
                void deactivateInstead();
              },
            },
          },
        );
        onClose();
        return;
      }
      toastApiError(err);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete approval rule?</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &ldquo;{rule.name}&rdquo;? This
          cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          {del.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deleting…
            </>
          ) : (
            "Delete"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
