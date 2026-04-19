import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { BillStatus } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useBills, type BillSummaryDTO } from "@/hooks/use-bills";
import { BillStatusBadge } from "@/components/bills/status-badge";

// Status filter bar — §6.6.4. "All" clears the filter.
const FILTERS: { label: string; value: BillStatus | null }[] = [
  { label: "All", value: null },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending_approval" },
  { label: "Approved", value: "approved" },
  { label: "Paid", value: "paid" },
  { label: "Rejected", value: "rejected" },
];

function parseStatus(value: string | null): BillStatus | null {
  const match = FILTERS.find((f) => f.value === value);
  return match?.value ?? null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isOverdue(bill: BillSummaryDTO, today: string): boolean {
  return bill.due_date < today && bill.status !== "paid";
}

function PendingApproversCell({ bill }: { bill: BillSummaryDTO }) {
  if (bill.status !== "pending_approval") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (bill.pending_approval_count === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  // §6.6.4: render the union of pending-approval eligible approver names.
  // Fall back to the count if an older API response omits the field.
  const names = bill.pending_approver_names ?? [];
  if (names.length === 0) {
    return (
      <span className="text-sm">
        {bill.pending_approval_count} approval
        {bill.pending_approval_count === 1 ? "" : "s"} pending
      </span>
    );
  }
  const joined = names.join(", ");
  return (
    <span className="block max-w-[18rem] truncate text-sm" title={joined}>
      {joined}
    </span>
  );
}

function TableLoading({ rows = 5 }: { rows?: number }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

export default function BillsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseStatus(searchParams.get("status"));
  const [overdueOnly, setOverdueOnly] = React.useState(false);

  const billsQuery = useBills(status ?? undefined);

  function setStatus(next: BillStatus | null) {
    const sp = new URLSearchParams(searchParams);
    if (next == null) sp.delete("status");
    else sp.set("status", next);
    setSearchParams(sp, { replace: true });
  }

  const today = React.useMemo(() => todayIso(), []);
  const rows: BillSummaryDTO[] = React.useMemo(() => {
    const list = billsQuery.data ?? [];
    return overdueOnly ? list.filter((b) => isOverdue(b, today)) : list;
  }, [billsQuery.data, overdueOnly, today]);

  const totalBills = billsQuery.data?.length ?? 0;
  const error = billsQuery.error as ApiError | null | undefined;

  return (
    <div className="space-y-6">
      {/* Header row: title is rendered by Layout; here we align the action */}
      <div className="flex items-center justify-end">
        <Button asChild>
          <Link to="/bills/new">
            <Plus className="mr-2 h-4 w-4" /> New bill
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = status === f.value;
            return (
              <Button
                key={f.label}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => setStatus(f.value)}
                aria-pressed={active}
              >
                {f.label}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="overdue-only"
            checked={overdueOnly}
            onCheckedChange={setOverdueOnly}
          />
          <Label htmlFor="overdue-only" className="text-sm font-normal">
            Overdue only
          </Label>
        </div>
      </div>

      {/* Error banner */}
      {billsQuery.isError && (
        <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">
            Couldn't load bills{error?.detail ? ` — ${error.detail}` : ""}.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => billsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pending approvers</TableHead>
            </TableRow>
          </TableHeader>

          {billsQuery.isLoading ? (
            <TableLoading />
          ) : rows.length === 0 ? (
            <TableBody>
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  {totalBills === 0 && !overdueOnly && status == null ? (
                    <div className="space-y-3">
                      <p className="text-muted-foreground">
                        No bills yet. Create your first bill to get started.
                      </p>
                      <Button asChild>
                        <Link to="/bills/new">
                          <Plus className="mr-2 h-4 w-4" /> New bill
                        </Link>
                      </Button>
                    </div>
                  ) : overdueOnly ? (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">
                        No overdue bills right now.
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setOverdueOnly(false)}
                      >
                        Clear overdue filter
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">
                        No{" "}
                        {FILTERS.find((f) => f.value === status)?.label.toLowerCase()}{" "}
                        bills right now.
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setStatus(null)}
                      >
                        Clear filter
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          ) : (
            <TableBody>
              {rows.map((b) => {
                const overdue = isOverdue(b, today);
                return (
                  <TableRow
                    key={b.id}
                    onClick={() => navigate(`/bills/${b.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium">
                      {b.vendor_name}
                    </TableCell>
                    <TableCell>{b.invoice_number}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(b.amount_cents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        overdue && "font-semibold text-destructive",
                      )}
                    >
                      {formatDate(b.due_date)}
                    </TableCell>
                    <TableCell>
                      <BillStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell>
                      <PendingApproversCell bill={b} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          )}
        </Table>
      </div>
    </div>
  );
}
