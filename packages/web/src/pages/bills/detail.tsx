import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useBill, type BillDetailDTO } from "@/hooks/use-bills";
import { useCurrentUser, useUsers } from "@/hooks/use-current-user";
import { BillStatusBadge } from "@/components/bills/status-badge";
import { AttachmentViewer } from "@/components/bills/attachment-viewer";
import { ApprovalsPanel } from "@/components/bills/approvals-panel";
import { TimelinePanel } from "@/components/bills/timeline-panel";
import { ActionBar } from "@/components/bills/action-bar";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-2/3" />
      <div className="grid gap-6 lg:grid-cols-[65%_35%]">
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

function BillNotFound() {
  return (
    <div className="rounded-lg border bg-card p-12 text-center">
      <h2 className="text-lg font-semibold">Bill not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        It may have been deleted.
      </p>
      <div className="mt-4">
        <Link to="/bills" className="text-sm text-primary hover:underline">
          Back to bills
        </Link>
      </div>
    </div>
  );
}

function BillBody({ bill }: { bill: BillDetailDTO }) {
  const currentUserQuery = useCurrentUser();
  const usersQuery = useUsers();

  const userNames = React.useMemo(() => {
    const map = new Map<string, string>();
    (usersQuery.data ?? []).forEach((u) => map.set(u.id, u.name));
    return map;
  }, [usersQuery.data]);

  const vendorName = bill.vendor?.name ?? bill.vendor_name;
  const submitterName = userNames.get(bill.created_by_user_id) ?? bill.created_by_user_name;

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Bill {bill.invoice_number}
            <span className="mx-3 text-muted-foreground">—</span>
            <Link
              to={`/vendors/${bill.vendor_id}`}
              className="text-foreground hover:underline"
            >
              {vendorName}
            </Link>
          </h1>
        </div>
        <BillStatusBadge status={bill.status} size="md" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[65fr_35fr]">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Details</h2>
            <dl>
              <DetailRow label="Amount">
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(bill.amount_cents)}
                </span>
              </DetailRow>
              <DetailRow label="Invoice #">{bill.invoice_number}</DetailRow>
              <DetailRow label="Issue date">
                {formatDate(bill.issue_date)}
              </DetailRow>
              <DetailRow label="Due date">
                {formatDate(bill.due_date)}
              </DetailRow>
              <DetailRow label="Submitted by">{submitterName}</DetailRow>
              {bill.submitted_at && (
                <DetailRow label="Submitted at">
                  {formatDateTime(bill.submitted_at)}
                </DetailRow>
              )}
              {bill.status === "rejected" && bill.rejection_reason && (
                <DetailRow label="Rejection reason">
                  <span className="text-destructive">
                    {bill.rejection_reason}
                  </span>
                </DetailRow>
              )}
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Line items</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.line_items.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>{li.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(li.amount_cents)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(bill.amount_cents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          <section className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Invoice attachment</h2>
            <AttachmentViewer attachment={bill.attachment} />
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Approvals</h2>
            <ApprovalsPanel bill={bill} userNames={userNames} />
          </section>

          {currentUserQuery.data && (
            <section className="rounded-lg border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold">Actions</h2>
              <ActionBar bill={bill} currentUser={currentUserQuery.data} />
            </section>
          )}

          <section className="rounded-lg border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold">Timeline</h2>
            <TimelinePanel events={bill.events} userNames={userNames} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default function BillDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const billQuery = useBill(id);

  if (billQuery.isLoading) return <LoadingSkeleton />;

  if (billQuery.isError) {
    const err = billQuery.error as ApiError | undefined;
    if (err instanceof ApiError && err.status === 404) {
      return <BillNotFound />;
    }
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Couldn't load bill</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {err?.detail ?? "An unexpected error occurred."}
        </p>
        <button
          onClick={() => billQuery.refetch()}
          className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Loader2 className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (!billQuery.data) return <BillNotFound />;
  return <BillBody bill={billQuery.data} />;
}
