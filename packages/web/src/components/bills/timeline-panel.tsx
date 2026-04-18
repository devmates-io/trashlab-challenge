import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  Banknote,
  Check,
  Circle,
  CornerDownLeft,
  Pencil,
  ShieldCheck,
  X,
} from "lucide-react";
import type { BillEventType } from "@bill-pay/shared";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { BillEventDTO } from "@/hooks/use-bills";

// Icon + default verb per event type (§6.6.6 + §6.3.7).
const ICONS: Record<
  BillEventType,
  React.ComponentType<{ className?: string }>
> = {
  created: Circle,
  submitted: ArrowUpRight,
  approved: Check,
  rejected: X,
  recalled: CornerDownLeft,
  paid: Banknote,
  edited: Pencil,
};

const VERBS: Record<BillEventType, string> = {
  created: "created",
  submitted: "submitted",
  approved: "approved",
  rejected: "rejected",
  recalled: "recalled",
  paid: "paid",
  edited: "edited",
};

function eventText(
  event: BillEventDTO,
  actorName: string,
): { verb: string; suffix?: string } {
  const payload = event.payload as Record<string, unknown>;
  if (event.event_type === "approved") {
    const ruleId = payload.rule_id;
    const approvalId = payload.approval_id;
    // Bill-level: both null (§6.3.7).
    if (ruleId == null && approvalId == null) {
      return { verb: "approved", suffix: "(bill fully approved)" };
    }
    // Per-approval.
    return { verb: "approved" };
  }
  if (event.event_type === "rejected") {
    const reason = payload.rejection_reason as string | null | undefined;
    return { verb: "rejected", suffix: reason ? `— "${reason}"` : undefined };
  }
  return { verb: VERBS[event.event_type] };
}

export function TimelinePanel({
  events,
  userNames,
}: {
  events: BillEventDTO[];
  userNames: Map<string, string>;
}): React.ReactElement {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No timeline events yet.</p>
    );
  }

  // Spec: "vertical list of BillEvent entries, newest first" (§6.6.6).
  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  return (
    <ol className="space-y-3">
      {sorted.map((e) => {
        const Icon = ICONS[e.event_type] ?? Circle;
        const actorName =
          userNames.get(e.actor_user_id) ?? e.actor_user_id;
        const { verb, suffix } = eventText(e, actorName);
        const payload = e.payload as Record<string, unknown>;
        const adminOverride = payload.admin_override === true;
        const absolute = formatDateTime(e.occurred_at);
        const relative = formatDistanceToNow(new Date(e.occurred_at), {
          addSuffix: true,
        });

        return (
          <li key={e.id} className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span>
                  <span className="font-medium">{actorName}</span>{" "}
                  <span>{verb} this bill</span>
                  {suffix && (
                    <span className="ml-1 text-muted-foreground">{suffix}</span>
                  )}
                </span>
                {adminOverride && (
                  <Badge
                    variant="outline"
                    className="border-violet-300 bg-violet-50 text-violet-800"
                  >
                    <ShieldCheck className="mr-1 h-3 w-3" />
                    Admin override
                  </Badge>
                )}
              </div>
              <time
                className="text-xs text-muted-foreground"
                title={absolute}
                dateTime={e.occurred_at}
              >
                {relative}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
