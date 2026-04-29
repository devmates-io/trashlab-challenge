import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  RecurringRunDueResponse,
  RecurringTemplateCreateRequest,
  RecurringTemplateDTO,
  RecurringTemplateUpdateRequest,
} from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";

// §6.10.5 — recurring template hooks. Cache key conventions mirror
// use-bills.ts: a single list key for the index, per-id keys for the
// detail view. Mutations invalidate both so screens stay current after
// edits / pause / resume.

export const RECURRING_LIST_KEY = ["recurring"] as const;
export const recurringDetailKey = (id: string) => ["recurring", id] as const;
const BILLS_KEY = ["bills"] as const;
const DASHBOARD_KEY = ["dashboard"] as const;

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: RECURRING_LIST_KEY });
}

export function useRecurringTemplates(): UseQueryResult<RecurringTemplateDTO[]> {
  return useQuery<RecurringTemplateDTO[]>({
    queryKey: RECURRING_LIST_KEY,
    queryFn: () => apiFetch<RecurringTemplateDTO[]>("/recurring-templates"),
  });
}

export function useRecurringTemplate(
  id: string | undefined,
): UseQueryResult<RecurringTemplateDTO> {
  return useQuery<RecurringTemplateDTO>({
    queryKey: id ? recurringDetailKey(id) : recurringDetailKey(""),
    queryFn: () =>
      apiFetch<RecurringTemplateDTO>(`/recurring-templates/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateRecurringTemplate(): UseMutationResult<
  RecurringTemplateDTO,
  unknown,
  RecurringTemplateCreateRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecurringTemplateCreateRequest) =>
      apiFetch<RecurringTemplateDTO>("/recurring-templates", {
        method: "POST",
        body,
      }),
    onSuccess: (template) => {
      qc.setQueryData(recurringDetailKey(template.id), template);
      invalidateAll(qc);
    },
  });
}

export function useUpdateRecurringTemplate(
  id: string,
): UseMutationResult<
  RecurringTemplateDTO,
  unknown,
  RecurringTemplateUpdateRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecurringTemplateUpdateRequest) =>
      apiFetch<RecurringTemplateDTO>(`/recurring-templates/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (template) => {
      qc.setQueryData(recurringDetailKey(template.id), template);
      invalidateAll(qc);
    },
  });
}

export function usePauseRecurringTemplate(): UseMutationResult<
  RecurringTemplateDTO,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<RecurringTemplateDTO>(`/recurring-templates/${id}/pause`, {
        method: "POST",
      }),
    onSuccess: (template) => {
      qc.setQueryData(recurringDetailKey(template.id), template);
      invalidateAll(qc);
    },
  });
}

export function useResumeRecurringTemplate(): UseMutationResult<
  RecurringTemplateDTO,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<RecurringTemplateDTO>(`/recurring-templates/${id}/resume`, {
        method: "POST",
      }),
    onSuccess: (template) => {
      qc.setQueryData(recurringDetailKey(template.id), template);
      invalidateAll(qc);
    },
  });
}

export function useDeleteRecurringTemplate(): UseMutationResult<
  void,
  unknown,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/recurring-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc),
  });
}

// POST /recurring-templates/run-due — materialise every due template.
// Invalidates bills and dashboard caches because this creates new draft
// bills that should appear immediately in the bills list.
export function useRunDueTemplates(): UseMutationResult<
  RecurringRunDueResponse,
  unknown,
  void
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RecurringRunDueResponse>("/recurring-templates/run-due", {
        method: "POST",
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: RECURRING_LIST_KEY });
      qc.invalidateQueries({ queryKey: BILLS_KEY });
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
    },
  });
}
