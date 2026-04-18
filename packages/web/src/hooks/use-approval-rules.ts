import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalRuleCreateRequest,
  ApprovalRuleDTO,
  ApprovalRulePatchRequest,
  ApprovalRulePreviewRequest,
  UserDTO,
} from "@bill-pay/shared";
import { apiFetch } from "@/lib/api";

// §6.5.4 — approval rule response extends the shared DTO with a
// `qualified_approvers` array (per-user V5 qualification flag). The shared zod
// schema doesn't yet include this optional field, so we extend the type here.
export interface QualifiedApprover {
  user_id: string;
  user_name: string;
  qualifies_at_threshold: boolean;
}

export interface ApprovalRuleListItem extends ApprovalRuleDTO {
  qualified_approvers?: QualifiedApprover[];
}

// §6.5.4 POST /approval-rules/preview response.
export interface ApprovalRulePreviewWarning {
  code: string;
  message: string;
}

export interface ApprovalRulePreviewResponse {
  regular_approvers: UserDTO[];
  admin_approvers: UserDTO[];
  effective_eligible_user_ids: string[];
  warnings: ApprovalRulePreviewWarning[];
}

const APPROVAL_RULES_KEY = ["approval-rules"] as const;

export function useApprovalRules() {
  return useQuery<ApprovalRuleListItem[]>({
    queryKey: APPROVAL_RULES_KEY,
    queryFn: () => apiFetch<ApprovalRuleListItem[]>("/approval-rules"),
  });
}

export function useCreateApprovalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApprovalRuleCreateRequest) =>
      apiFetch<ApprovalRuleDTO>("/approval-rules", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPROVAL_RULES_KEY });
    },
  });
}

export function usePatchApprovalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApprovalRulePatchRequest }) =>
      apiFetch<ApprovalRuleDTO>(`/approval-rules/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPROVAL_RULES_KEY });
    },
  });
}

export function useDeleteApprovalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/approval-rules/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPROVAL_RULES_KEY });
    },
  });
}

// Preview is a POST so we use a mutation rather than a query — the hook below
// wraps the call site's debouncing concerns (see RulePreview component).
export function usePreviewApprovalRule() {
  return useMutation({
    mutationFn: (body: ApprovalRulePreviewRequest) =>
      apiFetch<ApprovalRulePreviewResponse>("/approval-rules/preview", {
        method: "POST",
        body,
      }),
  });
}

// Users feed the rule editor's approver picker and the rules table's approver
// name lookup. Filtered to `role === "approver" && is_active` per §6.6.9 (the
// admin role is hidden from the picker because admins are always eligible).
export function useUsersForRules() {
  return useQuery<UserDTO[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserDTO[]>("/users"),
  });
}
