import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/dashboard/stat-card";
import { DashboardBillsTable } from "@/components/dashboard/bills-table";
import { toastApiError } from "@/components/dashboard/shared";
import { useDashboard } from "@/hooks/use-dashboard";

// §6.6.3 dashboard. Stat-card row + overdue + upcoming tables. Data from
// GET /dashboard (§6.5.4).
export default function DashboardPage(): React.ReactElement {
  const { data, isLoading, isError, error } = useDashboard();

  React.useEffect(() => {
    if (isError) toastApiError(error);
  }, [isError, error]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const totals = data?.totals_by_status;
  const pendingApproval = totals?.pending_approval ?? emptyTotal;
  const approved = totals?.approved ?? emptyTotal;
  const paid30 = data?.paid_last_30_days ?? emptyTotal;
  const overdueBills = data?.overdue_bills ?? [];
  const upcomingBills = data?.upcoming_bills ?? [];

  // §6.6.3 overdue tile aggregates from the overdue_bills array (there is no
  // separate totals_by_status.overdue). Sum amounts defensively.
  const overdueSum = overdueBills.reduce(
    (acc, bill) => acc + bill.amount_cents,
    0,
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Pending approval"
            count={pendingApproval.count}
            sumCents={pendingApproval.sum_cents}
            to="/bills?status=pending_approval"
          />
          <StatCard
            label="Awaiting payment"
            count={approved.count}
            sumCents={approved.sum_cents}
            to="/bills?status=approved"
          />
          <StatCard
            label="Overdue"
            count={overdueBills.length}
            sumCents={overdueSum}
            to="/bills?overdue=1"
          />
          <StatCard
            label="Paid (30 days)"
            count={paid30.count}
            sumCents={paid30.sum_cents}
            to="/bills?status=paid"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Overdue bills</h2>
        <DashboardBillsTable
          bills={overdueBills}
          highlightOverdue
          emptyState={
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2
                className="h-5 w-5 text-green-600"
                aria-hidden="true"
              />
              <span>No overdue bills. You&apos;re all caught up.</span>
            </div>
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upcoming (next 7 days)</h2>
        <DashboardBillsTable
          bills={upcomingBills}
          emptyState={
            <div className="text-center text-sm text-muted-foreground">
              No bills due in the next 7 days.
            </div>
          }
        />
      </section>
    </div>
  );
}

const emptyTotal = { count: 0, sum_cents: 0 };

// §4.4 Q-9: loading skeleton matches the final layout shape to avoid layout
// shift. 4 stat cards + 2 tables of 5 rows each.
function DashboardSkeleton(): React.ReactElement {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[122px] w-full rounded-lg" />
        ))}
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="space-y-2 rounded-md border bg-card p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
