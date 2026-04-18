import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  ApprovalStatus,
  BillCreateRequest,
  BillEventType,
  BillLineItemDTO,
  BillPatchRequest,
  BillStatus,
  PaymentDTO,
  VendorDTO,
} from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";
import type { BillSummary } from "@/hooks/use-vendors";

// ---------------------------------------------------------------------------
// Local DTO interfaces (the shared package does not yet export bill-detail
// response shapes — §6.5.4 GET /bills/:id). Mirrors the spec exactly.
// ---------------------------------------------------------------------------

export type BillSummaryDTO = BillSummary;

export interface AttachmentDTO {
  id: string;
  bill_id?: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_user_id: string;
  uploaded_at: string;
}

export interface BillApprovalDTO {
  id: string;
  bill_id: string;
  rule_id: string;
  rule_name_snapshot: string;
  eligible_approver_user_ids: string[];
  status: ApprovalStatus;
  decided_by_user_id: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  created_at?: string;
}

export interface BillEventDTO {
  id: string;
  bill_id: string;
  event_type: BillEventType;
  actor_user_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface BillDetailDTO extends BillSummaryDTO {
  vendor: VendorDTO;
  line_items: BillLineItemDTO[];
  attachment: AttachmentDTO | null;
  approvals: BillApprovalDTO[];
  events: BillEventDTO[];
  payment: PaymentDTO | null;
  rejection_reason: string | null;
}

export interface UploadResponseDTO {
  attachment_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
}

// ---------------------------------------------------------------------------
// Query keys — aligned with use-vendors.ts (BILLS_LIST_KEY = ["bills"]).
// ---------------------------------------------------------------------------

export const BILLS_LIST_KEY = ["bills"] as const;
export const billDetailKey = (id: string) => ["bill", id] as const;
export const DASHBOARD_KEY = ["dashboard"] as const;

function invalidateBillScoped(
  qc: ReturnType<typeof useQueryClient>,
  billId?: string,
) {
  qc.invalidateQueries({ queryKey: BILLS_LIST_KEY });
  qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
  if (billId) qc.invalidateQueries({ queryKey: billDetailKey(billId) });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useBills(
  status?: BillStatus,
): UseQueryResult<BillSummaryDTO[]> {
  const qs = status ? `?status=${status}` : "";
  return useQuery<BillSummaryDTO[]>({
    queryKey: status ? (["bills", { status }] as const) : BILLS_LIST_KEY,
    queryFn: () => apiFetch<BillSummaryDTO[]>(`/bills${qs}`),
  });
}

export function useBill(id: string | undefined): UseQueryResult<BillDetailDTO> {
  return useQuery<BillDetailDTO>({
    queryKey: id ? billDetailKey(id) : (["bill", "missing"] as const),
    queryFn: () => apiFetch<BillDetailDTO>(`/bills/${id}`),
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// Mutations — §6.5.4
// ---------------------------------------------------------------------------

export function useCreateBill(): UseMutationResult<
  BillDetailDTO,
  unknown,
  BillCreateRequest
> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, BillCreateRequest>({
    mutationFn: (body) =>
      apiFetch<BillDetailDTO>("/bills", { method: "POST", body }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc);
    },
  });
}

export function useUpdateBill(
  id: string,
): UseMutationResult<BillDetailDTO, unknown, BillPatchRequest> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, BillPatchRequest>({
    mutationFn: (body) =>
      apiFetch<BillDetailDTO>(`/bills/${id}`, { method: "PATCH", body }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function useDeleteBill(): UseMutationResult<void, unknown, string> {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => apiFetch<void>(`/bills/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: billDetailKey(id) });
      invalidateBillScoped(qc);
    },
  });
}

export function useSubmitBill(
  id: string,
): UseMutationResult<BillDetailDTO, unknown, void> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, void>({
    mutationFn: () =>
      apiFetch<BillDetailDTO>(`/bills/${id}/submit`, { method: "POST" }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

// `useSubmitBill` requires the bill id at hook construction time, which makes
// the "create then immediately submit" flow awkward (new bill's id is only
// known after POST /bills resolves). This variant takes the id as the
// mutation argument instead.
export function useSubmitBillById(): UseMutationResult<
  BillDetailDTO,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, string>({
    mutationFn: (billId) =>
      apiFetch<BillDetailDTO>(`/bills/${billId}/submit`, { method: "POST" }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function useApproveBill(
  id: string,
): UseMutationResult<BillDetailDTO, unknown, void> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, void>({
    mutationFn: () =>
      apiFetch<BillDetailDTO>(`/bills/${id}/approve`, { method: "POST" }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function useRejectApproval(billId: string): UseMutationResult<
  BillDetailDTO,
  unknown,
  { approval_id: string; reason: string | null }
> {
  const qc = useQueryClient();
  return useMutation<
    BillDetailDTO,
    unknown,
    { approval_id: string; reason: string | null }
  >({
    mutationFn: ({ approval_id, reason }) =>
      apiFetch<BillDetailDTO>(`/approvals/${approval_id}/reject`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, billId);
    },
  });
}

export function useRecallBill(
  id: string,
): UseMutationResult<BillDetailDTO, unknown, void> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, void>({
    mutationFn: () =>
      apiFetch<BillDetailDTO>(`/bills/${id}/recall`, { method: "POST" }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function usePayBill(id: string): UseMutationResult<
  BillDetailDTO,
  unknown,
  { idempotencyKey: string }
> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, { idempotencyKey: string }>({
    mutationFn: ({ idempotencyKey }) =>
      apiFetch<BillDetailDTO>(`/bills/${id}/pay`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function useCloneBill(): UseMutationResult<
  BillDetailDTO,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, string>({
    mutationFn: (id) =>
      apiFetch<BillDetailDTO>(`/bills/${id}/clone`, { method: "POST" }),
    onSuccess: (bill) => {
      qc.setQueryData(billDetailKey(bill.id), bill);
      invalidateBillScoped(qc, bill.id);
    },
  });
}

export function useUploadAttachment(): UseMutationResult<
  UploadResponseDTO,
  unknown,
  File
> {
  return useMutation<UploadResponseDTO, unknown, File>({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiFetch<UploadResponseDTO>("/uploads", {
        method: "POST",
        body: fd,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Upload URL helper — §6.5.4 GET /uploads/:stored_filename. format.ts does
// not expose one today, so we inline the same BASE_URL resolution.
// ---------------------------------------------------------------------------

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:4000";

export function uploadUrl(storedFilename: string): string {
  return `${API_BASE_URL}/uploads/${storedFilename}`;
}
