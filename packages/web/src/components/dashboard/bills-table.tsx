import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BillStatusBadge } from "@/components/dashboard/shared";
import type { BillSummaryDTO } from "@/hooks/use-dashboard";

// §6.6.3 dashboard overdue + upcoming tables share the same 5 columns. The
// only visual difference is the "due date in destructive color" highlight on
// the overdue variant.
export function DashboardBillsTable({
  bills,
  highlightOverdue = false,
  emptyState,
}: {
  bills: BillSummaryDTO[];
  highlightOverdue?: boolean;
  emptyState: React.ReactNode;
}): React.ReactElement {
  const navigate = useNavigate();

  if (bills.length === 0) {
    return <div className="rounded-md border bg-card p-8">{emptyState}</div>;
  }

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vendor</TableHead>
            <TableHead>Invoice #</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bills.map((bill) => (
            <TableRow
              key={bill.id}
              className="cursor-pointer"
              onClick={() => navigate(`/bills/${bill.id}`)}
            >
              <TableCell className="font-medium">{bill.vendor_name}</TableCell>
              <TableCell className="text-muted-foreground">
                {bill.invoice_number}
              </TableCell>
              <TableCell>{formatMoney(bill.amount_cents)}</TableCell>
              <TableCell
                className={cn(
                  highlightOverdue && "font-medium text-destructive",
                )}
              >
                {formatDate(bill.due_date)}
              </TableCell>
              <TableCell>
                <BillStatusBadge status={bill.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
