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
  BillExtractRequest,
  BillExtractResponse,
  BillLineItemDTO,
  BillPatchRequest,
  BillStatus,
  BulkBillsRequest,
  BulkBillsResponse,
  PaymentDTO,
  VendorDTO,
} from "@bill-pay/shared";
import * as React from "react";
import { apiFetch, apiFetchBlob } from "@/lib/api";
import type { BillSummary } from "@/hooks/use-vendors";

// ---------------------------------------------------------------------------
// Local DTO interfaces (the shared package does not yet export bill-detail
// response shapes — §6.5.4 GET /bills/:id). Mirrors the spec exactly.
// ---------------------------------------------------------------------------

// §6.6.4 adds `pending_approver_names` to the /bills list response. Kept
// optional so narrower consumers (dashboard, vendor detail) that don't request
// it still type-check. Dashboard overdue/upcoming tables don't render this
// column, so the backend doesn't populate it for those endpoints.
export interface BillSummaryDTO extends BillSummary {
  pending_approver_names?: string[];
}

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

// §6.10.3 — variables type accepts an optional `force` flag that maps to
// the server's `?force=true` duplicate-bypass query param. Default
// behavior (force=false / undefined) runs the duplicate check and returns
// 409 POSSIBLE_DUPLICATE when matches exist.
export interface CreateBillVars {
  body: BillCreateRequest;
  force?: boolean;
}

export function useCreateBill(): UseMutationResult<
  BillDetailDTO,
  unknown,
  CreateBillVars
> {
  const qc = useQueryClient();
  return useMutation<BillDetailDTO, unknown, CreateBillVars>({
    mutationFn: ({ body, force }) =>
      apiFetch<BillDetailDTO>(force ? "/bills?force=true" : "/bills", {
        method: "POST",
        body,
      }),
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

// §6.10.1 — POST /bills/extract. Server runs Claude over the uploaded file
// and returns suggested fields. The mutation is intentionally not cached
// (no react-query key) — every invocation is a fresh extraction request.
export function useExtractInvoice(): UseMutationResult<
  BillExtractResponse,
  unknown,
  BillExtractRequest
> {
  return useMutation<BillExtractResponse, unknown, BillExtractRequest>({
    mutationFn: (body) =>
      apiFetch<BillExtractResponse>("/bills/extract", {
        method: "POST",
        body,
      }),
  });
}

// §6.10.2 — bulk approve / bulk pay. Both endpoints share the same wire
// shape so we share a generic hook factory; success invalidation is the
// same too (every visible list of bills must re-fetch). Per-bill outcomes
// live in the `results` array — the caller decides how to surface them.
function useBulkBillsAction(
  pathname: "/bills/bulk-approve" | "/bills/bulk-pay",
): UseMutationResult<BulkBillsResponse, unknown, BulkBillsRequest> {
  const qc = useQueryClient();
  return useMutation<BulkBillsResponse, unknown, BulkBillsRequest>({
    mutationFn: (body) =>
      apiFetch<BulkBillsResponse>(pathname, { method: "POST", body }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: BILLS_LIST_KEY });
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}

export function useBulkApproveBills() {
  return useBulkBillsAction("/bills/bulk-approve");
}

export function useBulkPayBills() {
  return useBulkBillsAction("/bills/bulk-pay");
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

// Fetches GET /uploads/:stored_filename with the authenticated apiFetch wrapper
// and exposes the response as an object URL suitable for <iframe>/<img>/<a>.
// Browsers do not attach custom headers (X-User-Id) to native element loads,
// so we can't point elements directly at /uploads/* — we download via fetch
// and hand the viewer a blob: URL instead.
export function useAttachmentBlobUrl(storedFilename: string | null): {
  url: string | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [url, setUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(
    storedFilename !== null,
  );
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!storedFilename) {
      setUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setIsLoading(true);
    setError(null);

    apiFetchBlob(`/uploads/${storedFilename}`)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setUrl(createdUrl);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [storedFilename]);

  return { url, isLoading, error };
}
