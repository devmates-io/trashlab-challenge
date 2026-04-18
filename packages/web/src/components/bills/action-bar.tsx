import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Banknote,
  Check,
  Copy as CopyIcon,
  CornerDownLeft,
  Loader2,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { UserDTO } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import {
  useCloneBill,
  useDeleteBill,
  useSubmitBill,
  type BillDetailDTO,
} from "@/hooks/use-bills";
import { ApproveModal } from "@/components/bills/approve-modal";
import { RejectModal } from "@/components/bills/reject-modal";
import { PayModal } from "@/components/bills/pay-modal";
import { RecallModal } from "@/components/bills/recall-modal";
import { DeleteDraftModal } from "@/components/bills/delete-draft-modal";

export function ActionBar({
  bill,
  currentUser,
}: {
  bill: BillDetailDTO;
  currentUser: UserDTO;
}): React.ReactElement {
  const navigate = useNavigate();
  const submitBill = useSubmitBill(bill.id);
  const deleteBill = useDeleteBill();
  const cloneBill = useCloneBill();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [recallOpen, setRecallOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const isCreator = currentUser.id === bill.created_by_user_id;
  const isAdmin = currentUser.role === "admin";

  const pendingApprovals = bill.approvals.filter((a) => a.status === "pending");
  const eligibleForUser = pendingApprovals.filter((a) =>
    a.eligible_approver_user_ids.includes(currentUser.id),
  );

  const canSubmitDraft = bill.status === "draft" && isCreator;
  const canEditOrDelete = bill.status === "draft" && isCreator;

  const canRecall =
    bill.status === "pending_approval" &&
    isCreator &&
    bill.approvals.every((a) => a.status === "pending");

  // Admins are pre-baked into eligible_approver_user_ids at submission (§6.3.4.1).
  // So `eligibleForUser.length > 0` naturally handles the admin-override case
  // for bills submitted while the current user was admin.
  const canDecide =
    bill.status === "pending_approval" &&
    eligibleForUser.length > 0 &&
    (!isCreator || isAdmin);

  // Ineligible-user path: show disabled Approve with tooltip.
  const showDisabledApprove =
    bill.status === "pending_approval" &&
    !canDecide &&
    !isCreator &&
    // If bill.amount_cents is known, build the richer tooltip; else generic.
    true;

  const canPay =
    bill.status === "approved" &&
    (isAdmin ||
      currentUser.max_approval_amount_cents >= bill.amount_cents);

  // §6.3.6 INSUFFICIENT_PAY_AUTHORITY — disabled Pay with tooltip for the
  // pay-under-limit case.
  const showDisabledPay =
    bill.status === "approved" && !canPay;

  const canClone = bill.status === "rejected";

  // Reject target: if the user is eligible for one or more pending
  // approvals, target the first. For admins outside the pool, fall back to
  // the first pending approval. §6.4.5.
  const rejectTargetApprovalId =
    eligibleForUser[0]?.id ??
    (isAdmin ? pendingApprovals[0]?.id ?? null : null);

  // Approvals that will be flipped on a single Approve click, for the modal
  // body text. §6.4.5 flips every eligible slot in one transaction.
  const approveEligible =
    eligibleForUser.length > 0
      ? eligibleForUser
      : isAdmin
        ? pendingApprovals
        : [];

  async function onSubmitDraft() {
    try {
      await submitBill.mutateAsync();
      toast.success("Bill submitted for approval.");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : "Failed to submit bill for approval.";
      toast.error(msg, { duration: Infinity });
    }
  }

  async function onClone() {
    try {
      const cloned = await cloneBill.mutateAsync(bill.id);
      toast.success("Draft created from rejected bill.");
      navigate(`/bills/${cloned.id}/edit`);
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to clone bill.";
      toast.error(msg, { duration: Infinity });
    }
  }

  const nothingToDo =
    !canEditOrDelete &&
    !canSubmitDraft &&
    !canRecall &&
    !canDecide &&
    !showDisabledApprove &&
    !canPay &&
    !showDisabledPay &&
    !canClone;

  const anyPending =
    submitBill.isPending ||
    deleteBill.isPending ||
    cloneBill.isPending;

  if (nothingToDo) {
    return (
      <p className="text-sm text-muted-foreground">
        No actions available for this bill in its current state.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {canEditOrDelete && (
        <Button
          variant="outline"
          disabled={anyPending}
          onClick={() => navigate(`/bills/${bill.id}/edit`)}
        >
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </Button>
      )}
      {canSubmitDraft && (
        <Button disabled={anyPending} onClick={onSubmitDraft}>
          {submitBill.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit for approval
        </Button>
      )}
      {canEditOrDelete && (
        <Button
          variant="outline"
          disabled={anyPending}
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete draft
        </Button>
      )}

      {canRecall && (
        <Button
          variant="outline"
          disabled={anyPending}
          onClick={() => setRecallOpen(true)}
        >
          <CornerDownLeft className="mr-2 h-4 w-4" /> Recall
        </Button>
      )}

      {canDecide && (
        <>
          <Button
            disabled={anyPending}
            onClick={() => setApproveOpen(true)}
          >
            <Check className="mr-2 h-4 w-4" /> Approve
          </Button>
          <Button
            variant="outline"
            disabled={anyPending || !rejectTargetApprovalId}
            onClick={() => setRejectOpen(true)}
            className="text-destructive hover:text-destructive"
          >
            <X className="mr-2 h-4 w-4" /> Reject
          </Button>
        </>
      )}

      {showDisabledApprove && !canDecide && (
        <Button
          variant="outline"
          disabled
          title={`Your approval limit is ${formatMoney(
            currentUser.max_approval_amount_cents,
          )}. This bill requires ${formatMoney(bill.amount_cents)}.`}
        >
          <Check className="mr-2 h-4 w-4" /> Approve
        </Button>
      )}

      {canPay && (
        <Button disabled={anyPending} onClick={() => setPayOpen(true)}>
          <Banknote className="mr-2 h-4 w-4" /> Pay
        </Button>
      )}

      {showDisabledPay && !canPay && (
        <Button
          disabled
          title={`Your payment limit is ${formatMoney(
            currentUser.max_approval_amount_cents,
          )}. This bill requires ${formatMoney(bill.amount_cents)}.`}
        >
          <Banknote className="mr-2 h-4 w-4" /> Pay
        </Button>
      )}

      {canClone && (
        <Button onClick={onClone} disabled={anyPending}>
          {cloneBill.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CopyIcon className="mr-2 h-4 w-4" />
          )}
          Clone as new draft
        </Button>
      )}

      {/* Modals */}
      <ApproveModal
        open={approveOpen}
        onOpenChange={setApproveOpen}
        billId={bill.id}
        eligibleApprovals={approveEligible}
      />
      <RejectModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        billId={bill.id}
        approvalId={rejectTargetApprovalId}
      />
      <PayModal open={payOpen} onOpenChange={setPayOpen} bill={bill} />
      <RecallModal
        open={recallOpen}
        onOpenChange={setRecallOpen}
        billId={bill.id}
      />
      <DeleteDraftModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        pending={deleteBill.isPending}
        onConfirm={async () => {
          try {
            await deleteBill.mutateAsync(bill.id);
            toast.success("Draft deleted.");
            navigate("/bills");
          } catch (err) {
            const msg =
              err instanceof ApiError ? err.detail : "Failed to delete draft.";
            toast.error(msg, { duration: Infinity });
          }
        }}
      />
    </div>
  );
}
