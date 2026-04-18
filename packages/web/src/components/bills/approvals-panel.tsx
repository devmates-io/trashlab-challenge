import * as React from "react";
import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import type { ApprovalStatus } from "@bill-pay/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type {
  BillApprovalDTO,
  BillDetailDTO,
  BillEventDTO,
} from "@/hooks/use-bills";

const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const APPROVAL_STATUS_CLASS: Record<ApprovalStatus, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  approved: "bg-emerald-100 text-emerald-900 border-emerald-300",
  rejected: "bg-rose-100 text-rose-900 border-rose-300",
  cancelled: "bg-slate-200 text-slate-700 border-slate-300",
};

function ApprovalStatusPill({ status }: { status: ApprovalStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        APPROVAL_STATUS_CLASS[status],
      )}
    >
      {APPROVAL_STATUS_LABEL[status]}
    </span>
  );
}

function resolveNames(ids: string[], users: Map<string, string>): string {
  if (ids.length === 0) return "—";
  return ids.map((id) => users.get(id) ?? id).join(", ");
}

// Find the event matching this approval decision — used to surface the
// admin_override flag from the event payload (§6.3.7).
function findDecisionEvent(
  events: BillEventDTO[],
  approval: BillApprovalDTO,
): BillEventDTO | undefined {
  if (approval.status !== "approved" && approval.status !== "rejected") {
    return undefined;
  }
  return events.find(
    (e) =>
      e.event_type === approval.status &&
      (e.payload as Record<string, unknown>).approval_id === approval.id,
  );
}

function ApprovalItem({
  approval,
  userNames,
  events,
}: {
  approval: BillApprovalDTO;
  userNames: Map<string, string>;
  events: BillEventDTO[];
}) {
  const [open, setOpen] = React.useState(
    approval.status === "pending" || approval.status === "rejected",
  );
  const decisionEvent = findDecisionEvent(events, approval);
  const adminOverride =
    (decisionEvent?.payload as Record<string, unknown> | undefined)?.admin_override === true;
  const deciderName = approval.decided_by_user_id
    ? (userNames.get(approval.decided_by_user_id) ?? approval.decided_by_user_id)
    : null;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span>{approval.rule_name_snapshot}</span>
        </span>
        <ApprovalStatusPill status={approval.status} />
      </button>
      {open && (
        <div className="space-y-2 border-t bg-muted/20 px-3 py-3 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Eligible
            </span>
            <div>
              {resolveNames(approval.eligible_approver_user_ids, userNames)}
            </div>
          </div>
          {approval.status !== "pending" && deciderName && (
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Decided by
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {deciderName}
                  {approval.decided_at
                    ? ` on ${formatDateTime(approval.decided_at)}`
                    : ""}
                </span>
                {adminOverride && (
                  <Badge
                    variant="outline"
                    className="border-violet-300 bg-violet-50 text-violet-800"
                  >
                    <ShieldCheck className="mr-1 h-3 w-3" /> Admin override
                  </Badge>
                )}
              </div>
            </div>
          )}
          {approval.status === "rejected" && approval.rejection_reason && (
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Rejection reason
              </span>
              <div>{approval.rejection_reason}</div>
            </div>
          )}
          {approval.status === "cancelled" && (
            <p className="text-xs text-muted-foreground">
              Cancelled because the bill was rejected or recalled.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ApprovalsPanel({
  bill,
  userNames,
}: {
  bill: BillDetailDTO;
  userNames: Map<string, string>;
}): React.ReactElement {
  if (bill.approvals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No approvals recorded yet.</p>
    );
  }
  return (
    <div className="space-y-2">
      {bill.approvals.map((a) => (
        <ApprovalItem
          key={a.id}
          approval={a}
          userNames={userNames}
          events={bill.events}
        />
      ))}
    </div>
  );
}
