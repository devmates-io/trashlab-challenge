import { useQuery } from "@tanstack/react-query";
import type { BillStatus } from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";

// §6.5.4 GET /dashboard — response shape. BillSummaryDTO carries just enough
// for the overdue/upcoming tables: vendor name, invoice, amount, due date,
// status, plus id for row-click navigation to /bills/:id (§6.6.3).
export interface BillSummaryDTO {
  id: string;
  vendor_id: string;
  vendor_name: string;
  invoice_number: string;
  amount_cents: number;
  issue_date: string;
  due_date: string;
  status: BillStatus;
}

export interface StatusTotal {
  count: number;
  sum_cents: number;
}

export interface DashboardResponse {
  totals_by_status: Record<BillStatus, StatusTotal>;
  overdue_bills: BillSummaryDTO[];
  upcoming_bills: BillSummaryDTO[];
  paid_last_30_days: StatusTotal;
}

export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardResponse>("/dashboard"),
  });
}
