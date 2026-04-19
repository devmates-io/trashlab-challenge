import * as React from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { UserDTO } from "@bill-pay/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  usePreviewApprovalRule,
  type ApprovalRulePreviewResponse,
} from "@/hooks/use-approval-rules";

// Small debounce hook for previewing as the user types (§6.6.9 spec: 200ms).
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// §6.6.9 live preview panel. Fires POST /approval-rules/preview on every form
// change (debounced 200ms) and renders regular/admin eligibility.
export function RulePreview({
  minAmountCents,
  approverUserIds,
  candidateApprovers,
}: {
  minAmountCents: number;
  approverUserIds: string[];
  candidateApprovers: UserDTO[];
}): React.ReactElement {
  const debouncedMin = useDebouncedValue(minAmountCents, 200);
  const debouncedIds = useDebouncedValue(approverUserIds, 200);
  const idsKey = debouncedIds.slice().sort().join(",");

  const preview = usePreviewApprovalRule();
  const previewFn = preview.mutate;

  React.useEffect(() => {
    if (debouncedIds.length === 0) {
      // V3 (EMPTY_APPROVER_POOL) blocks preview server-side; skip to avoid a
      // guaranteed 400 for every keystroke before any approver is selected.
      return;
    }
    previewFn({
      min_amount_cents: debouncedMin,
      approver_user_ids: debouncedIds,
      // §6.5.4: sample_bill_amount_cents is optional and defaults server-side
      // to min_amount_cents. We omit it so the default applies; when the UI
      // gains a "preview at custom amount" affordance it can pass it through.
    });
    // We key on idsKey rather than the array identity for stability.
  }, [previewFn, debouncedMin, idsKey, debouncedIds]);

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold">Live preview</h3>
      {preview.isPending && !preview.data ? (
        <PreviewSkeleton />
      ) : approverUserIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Select at least one approver to see who qualifies at this threshold.
        </p>
      ) : preview.isError ? (
        <PreviewError error={preview.error} />
      ) : preview.data ? (
        <PreviewBody
          data={preview.data}
          minAmountCents={minAmountCents}
          approverUserIds={approverUserIds}
          candidateApprovers={candidateApprovers}
        />
      ) : null}
    </div>
  );
}

function PreviewSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

function PreviewError({ error }: { error: unknown }): React.ReactElement {
  const detail =
    error instanceof ApiError ? error.detail : "Unable to preview right now.";
  return (
    <p className="text-sm text-destructive">Preview failed: {detail}</p>
  );
}

function PreviewBody({
  data,
  minAmountCents,
  approverUserIds,
  candidateApprovers,
}: {
  data: ApprovalRulePreviewResponse;
  minAmountCents: number;
  approverUserIds: string[];
  candidateApprovers: UserDTO[];
}): React.ReactElement {
  // Picked-but-unqualified = approvers the user checked whose limits are below
  // the threshold. §6.6.9 wants these shown with a red ✗.
  const regularIds = new Set(data.regular_approvers.map((u) => u.id));
  const disqualified = approverUserIds
    .filter((id) => !regularIds.has(id))
    .map((id) => candidateApprovers.find((u) => u.id === id))
    .filter((u): u is UserDTO => Boolean(u));

  const effectiveNames = data.effective_eligible_user_ids
    .map((id) => {
      const regular = data.regular_approvers.find((u) => u.id === id);
      if (regular) return regular.name;
      const admin = data.admin_approvers.find((u) => u.id === id);
      if (admin) return admin.name;
      return null;
    })
    .filter((n): n is string => n !== null);

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">
          At this threshold ({formatMoney(minAmountCents)}), regular approvers:
        </p>
        {data.regular_approvers.length === 0 && disqualified.length === 0 ? (
          <p className="pl-1 text-muted-foreground">
            No approvers picked yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {data.regular_approvers.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <Check
                  className="h-4 w-4 text-green-600"
                  aria-hidden="true"
                />
                <span>
                  {u.name}{" "}
                  <span className="text-muted-foreground">
                    (limit {formatMoney(u.max_approval_amount_cents)})
                  </span>
                </span>
              </li>
            ))}
            {disqualified.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <X className="h-4 w-4 text-destructive" aria-hidden="true" />
                <span>
                  {u.name}{" "}
                  <span className="text-muted-foreground">
                    (limit {formatMoney(u.max_approval_amount_cents)} — below
                    threshold)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <p className="font-medium">Admins (always eligible):</p>
        {data.admin_approvers.length === 0 ? (
          <p className="pl-1 text-muted-foreground">
            No active admins configured.
          </p>
        ) : (
          <ul className="space-y-1">
            {data.admin_approvers.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <Check
                  className="h-4 w-4 text-green-600"
                  aria-hidden="true"
                />
                <span>{u.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-muted-foreground">
        <span className="font-medium text-foreground">
          Effective eligible set:
        </span>{" "}
        {effectiveNames.length > 0 ? effectiveNames.join(", ") : "none"}
      </div>

      {data.warnings.length > 0 ? (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>Warnings</span>
          </div>
          <ul className="list-disc pl-5">
            {data.warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
