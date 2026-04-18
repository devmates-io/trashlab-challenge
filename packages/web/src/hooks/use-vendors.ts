import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  BillStatus,
  VendorCreateRequest,
  VendorDTO,
  VendorPatchRequest,
} from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";

// §6.5.4 — GET /bills returns an array of BillSummaryDTO; the shared package
// does not export a schema/type for it so we declare what we need here.
export interface BillSummary {
  id: string;
  vendor_id: string;
  vendor_name: string;
  invoice_number: string;
  amount_cents: number;
  status: BillStatus;
  due_date: string;
  issue_date: string;
  created_by_user_id: string;
  created_by_user_name: string;
  submitted_at?: string | null;
  pending_approval_count: number;
  has_attachment: boolean;
}

const VENDORS_LIST_KEY = ["vendors"] as const;
const vendorDetailKey = (id: string) => ["vendors", id] as const;
const BILLS_LIST_KEY = ["bills"] as const;

export function useVendorsList(): UseQueryResult<VendorDTO[]> {
  return useQuery<VendorDTO[]>({
    queryKey: VENDORS_LIST_KEY,
    queryFn: () => apiFetch<VendorDTO[]>("/vendors"),
  });
}

export function useVendor(id: string | undefined): UseQueryResult<VendorDTO> {
  return useQuery<VendorDTO>({
    queryKey: ["vendors", id ?? ""],
    queryFn: () => apiFetch<VendorDTO>(`/vendors/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateVendor(): UseMutationResult<
  VendorDTO,
  Error,
  VendorCreateRequest
> {
  const qc = useQueryClient();
  return useMutation<VendorDTO, Error, VendorCreateRequest>({
    mutationFn: (body) =>
      apiFetch<VendorDTO>("/vendors", { method: "POST", body }),
    onSuccess: (vendor) => {
      qc.invalidateQueries({ queryKey: VENDORS_LIST_KEY });
      qc.setQueryData(vendorDetailKey(vendor.id), vendor);
    },
  });
}

export function useUpdateVendor(
  id: string,
): UseMutationResult<VendorDTO, Error, VendorPatchRequest> {
  const qc = useQueryClient();
  return useMutation<VendorDTO, Error, VendorPatchRequest>({
    mutationFn: (body) =>
      apiFetch<VendorDTO>(`/vendors/${id}`, { method: "PATCH", body }),
    onSuccess: (vendor) => {
      qc.invalidateQueries({ queryKey: VENDORS_LIST_KEY });
      qc.setQueryData(vendorDetailKey(vendor.id), vendor);
    },
  });
}

export function useDeleteVendor(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/vendors/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: VENDORS_LIST_KEY });
      qc.removeQueries({ queryKey: vendorDetailKey(id) });
    },
  });
}

// §6.6.7 — the vendor-detail screen shows bills for a vendor. The `/bills`
// endpoint does not accept a vendor filter (§6.5.4), so we fetch the full
// list and filter client-side. Data is bounded at ~20 bills (§4.6).
export function useBillsForVendor(
  vendorId: string | undefined,
): UseQueryResult<BillSummary[]> {
  return useQuery<BillSummary[], Error, BillSummary[]>({
    queryKey: BILLS_LIST_KEY,
    queryFn: () => apiFetch<BillSummary[]>("/bills"),
    enabled: Boolean(vendorId),
    select: (bills) =>
      bills
        .filter((b) => b.vendor_id === vendorId)
        .slice()
        .sort((a, b) =>
          a.due_date < b.due_date ? 1 : a.due_date > b.due_date ? -1 : 0,
        ),
  });
}
