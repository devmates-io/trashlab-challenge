import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateUserRequest,
  SelfUpdateRequest,
  UpdateUserRequest,
  UserDTO,
} from "@bill-pay/shared";
import { ApiError, apiFetch } from "@/lib/api";
import { useUsers as useUsersFromCurrent } from "@/hooks/use-current-user";

// Single source of truth for the user-list cache key. We invalidate this on
// every mutation. The auth-session key is invalidated alongside any mutation
// that *might* affect the logged-in user (so role/limit/active changes show
// up immediately in the header / sidebar nav).
const USERS_LIST_KEY = ["users"] as const;
const SESSION_KEY = ["auth", "session"] as const;
const userDetailKey = (id: string) => ["users", id] as const;

// Re-export the existing list hook from `use-current-user.ts` (Package C) so
// callers can import everything user-related from a single module.
export const useUsers = useUsersFromCurrent;

// §6.5.4 — there is no `GET /users/:id` endpoint. The user list is small
// (≤ a handful of seeded users), so we fetch it whole and find by id.
// Each detail query has its own queryKey so a 404 (user removed from the
// list) becomes an `error` on this hook without affecting the list query
// shared by the page.
export function useUser(id: string | undefined): UseQueryResult<UserDTO> {
  return useQuery<UserDTO>({
    queryKey: id ? userDetailKey(id) : userDetailKey(""),
    queryFn: async () => {
      const users = await apiFetch<UserDTO[]>("/users");
      const found = users.find((u) => u.id === id);
      if (!found) {
        throw new ApiError({
          code: "NOT_FOUND",
          status: 404,
          detail: "User not found",
        });
      }
      return found;
    },
    enabled: Boolean(id),
  });
}

export function useCreateUser(): UseMutationResult<
  UserDTO,
  Error,
  CreateUserRequest
> {
  const qc = useQueryClient();
  return useMutation<UserDTO, Error, CreateUserRequest>({
    mutationFn: (body) =>
      apiFetch<UserDTO>("/users", { method: "POST", body }),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      qc.setQueryData(userDetailKey(user.id), user);
      // A newly-created user can never be the actor, so the session cache
      // is unaffected.
    },
  });
}

// PATCH /users/:id accepts either an admin body (full UpdateUserRequest) or
// a self body (restricted SelfUpdateRequest). The caller knows which is
// appropriate; the API enforces the privilege check server-side.
export function useUpdateUser(
  id: string,
): UseMutationResult<UserDTO, Error, UpdateUserRequest | SelfUpdateRequest> {
  const qc = useQueryClient();
  return useMutation<UserDTO, Error, UpdateUserRequest | SelfUpdateRequest>({
    mutationFn: (body) =>
      apiFetch<UserDTO>(`/users/${id}`, { method: "PATCH", body }),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      qc.setQueryData(userDetailKey(user.id), user);
      // The patched user could be the currently logged-in user — refresh the
      // session so the header / sidebar pick up role / limit / active changes.
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useDeactivateUser(): UseMutationResult<UserDTO, Error, string> {
  const qc = useQueryClient();
  return useMutation<UserDTO, Error, string>({
    mutationFn: (id) =>
      apiFetch<UserDTO>(`/users/${id}/deactivate`, { method: "POST" }),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      qc.setQueryData(userDetailKey(user.id), user);
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}

export function useActivateUser(): UseMutationResult<UserDTO, Error, string> {
  const qc = useQueryClient();
  return useMutation<UserDTO, Error, string>({
    mutationFn: (id) =>
      apiFetch<UserDTO>(`/users/${id}/activate`, { method: "POST" }),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
      qc.setQueryData(userDetailKey(user.id), user);
      qc.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}
