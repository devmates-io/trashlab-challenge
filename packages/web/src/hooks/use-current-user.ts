import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { LoginRequest, SessionDTO, UserDTO } from "@bill-pay/shared";
import {
  apiFetch,
  getSessionToken,
  SESSION_TOKEN_CHANGED_EVENT,
  setSessionToken,
} from "@/lib/api";

// Auth + identity hooks. The single source of truth for "who am I right
// now?" is the SessionDTO returned by GET /auth/session. All identity hooks
// are derivations of that one query so the cache stays consistent and a
// successful login / impersonate / stop-impersonate immediately flows to
// every consumer.
//
// Storage key — exported for tests and any future tooling.
export { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api";

const SESSION_QUERY_KEY = ["auth", "session"] as const;
const USERS_QUERY_KEY = ["users"] as const;

// Reactive read of "is there a stored bearer token?". Subscribes to both
// the cross-tab `storage` event and our in-tab custom event dispatched by
// `setSessionToken`, so any login / logout / 401-clear from anywhere in
// the app immediately updates components that gate on token presence.
function useHasSessionToken(): boolean {
  const [hasToken, setHasToken] = React.useState<boolean>(
    () => getSessionToken() !== null,
  );
  React.useEffect(() => {
    function sync() {
      setHasToken(getSessionToken() !== null);
    }
    window.addEventListener("storage", sync);
    window.addEventListener(SESSION_TOKEN_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SESSION_TOKEN_CHANGED_EVENT, sync);
    };
  }, []);
  return hasToken;
}

// ---- raw session query -----------------------------------------------------

// Fetch GET /auth/session. Disabled (does not run) when the user has no
// stored bearer token — that's the cold-start case where the auth guard
// will redirect to /login. When a request fails with 401 the apiFetch
// wrapper clears the token, our token-changed event fires, `enabled`
// flips to false, and the auth guard redirects on the next render.
export function useSession(): UseQueryResult<SessionDTO> {
  const hasToken = useHasSessionToken();
  return useQuery<SessionDTO>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<SessionDTO>("/auth/session"),
    enabled: hasToken,
    // Do not retry 401s — apiFetch has already cleared the token, and a
    // retry would just produce a second 401 against an empty Authorization
    // header.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

// ---- derived identity hooks -----------------------------------------------

// Returns the *acting* user — i.e. the impersonated user when an admin is
// "logged in as" someone, otherwise the real authenticated user. This is
// the identity every page should display and every action should be
// performed under (the API uses the same convention via §6.6.1 actor rules).
//
// The shape matches the prior hook (UseQueryResult<UserDTO>) so consumers
// that already pattern-match `.data` / `.isLoading` / `.isError` keep
// working without changes.
export function useCurrentUser(): UseQueryResult<UserDTO> {
  const hasToken = useHasSessionToken();
  return useQuery<SessionDTO, Error, UserDTO>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<SessionDTO>("/auth/session"),
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (s) => s.impersonated_user ?? s.user,
  });
}

// Returns the real authenticated user (the row whose password was verified
// at login). Used for "is the real user an admin?" checks where
// impersonation must NOT mask the underlying privileges.
export function useRealUser(): UseQueryResult<UserDTO> {
  const hasToken = useHasSessionToken();
  return useQuery<SessionDTO, Error, UserDTO>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<SessionDTO>("/auth/session"),
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (s) => s.user,
  });
}

// True iff the session is currently impersonating. Returns `false` while
// the session loads / errors so impersonation UI does not flash.
export function useIsImpersonating(): boolean {
  const hasToken = useHasSessionToken();
  const q = useQuery<SessionDTO, Error, boolean>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => apiFetch<SessionDTO>("/auth/session"),
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60 * 1000,
    select: (s) => s.impersonated_user !== null,
  });
  return q.data ?? false;
}

// Backwards-compatibility — historically other components asked "what's
// the current user id?" off localStorage. The token is now opaque, so we
// expose the acting user's id from the session instead. Returns null when
// the session is not yet loaded.
export function useCurrentUserId(): string | null {
  const current = useCurrentUser();
  return current.data?.id ?? null;
}

// ---- users list (admin + impersonation picker + reference data) ----------

// GET /users. Used by the admin user-management pages (Package D) and by
// the admin impersonation dropdown. The bills detail page also reads it
// for `created_by` name lookups. Same `["users"]` query key as the rules
// editor's `useUsersForRules`, so they share the cache entry.
export function useUsers(): UseQueryResult<UserDTO[]> {
  const hasToken = useHasSessionToken();
  return useQuery<UserDTO[]>({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => apiFetch<UserDTO[]>("/users"),
    // Disabled until logged in. /users is auth-required; firing it before
    // a session exists would just produce a 401 and a token-clear loop.
    enabled: hasToken,
  });
}

// ---- mutations: login / logout / impersonate / stop-impersonate ----------

export function useLogin(): UseMutationResult<SessionDTO, Error, LoginRequest> {
  const qc = useQueryClient();
  return useMutation<SessionDTO, Error, LoginRequest>({
    mutationFn: (body) =>
      apiFetch<SessionDTO>("/auth/login", { method: "POST", body }),
    onSuccess: (session) => {
      // Persist the bearer first so any in-flight queries kicked off by
      // the cache invalidate below carry the right Authorization header.
      setSessionToken(session.token);
      qc.setQueryData(SESSION_QUERY_KEY, session);
      // Drop every other cached query so screens repopulate from the new
      // identity. We don't invalidate the session itself — we just primed it.
      qc.invalidateQueries({
        predicate: (q) =>
          !(
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "auth" &&
            q.queryKey[1] === "session"
          ),
      });
    },
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    // Whether the server call succeeded or failed (e.g. token already
    // expired), client-side we always end up signed out — clear local
    // state and force the auth guard to push to /login.
    onSettled: () => {
      setSessionToken(null);
      qc.clear();
    },
  });
}

export function useImpersonate(): UseMutationResult<SessionDTO, Error, string> {
  const qc = useQueryClient();
  return useMutation<SessionDTO, Error, string>({
    mutationFn: (userId) =>
      apiFetch<SessionDTO>(
        `/auth/impersonate/${encodeURIComponent(userId)}`,
        { method: "POST" },
      ),
    onSuccess: (session) => {
      // Defensively persist the token from the response. The API may
      // re-issue a token at impersonation time (e.g. to embed an
      // impersonation flag in the opaque value); writing it back here
      // ensures subsequent requests use whatever the server said is
      // current. If the token is unchanged this is a no-op.
      setSessionToken(session.token);
      qc.setQueryData(SESSION_QUERY_KEY, session);
      // Re-fetch every other view under the new (impersonated) identity.
      qc.invalidateQueries({
        predicate: (q) =>
          !(
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "auth" &&
            q.queryKey[1] === "session"
          ),
      });
    },
  });
}

export function useStopImpersonating(): UseMutationResult<
  SessionDTO,
  Error,
  void
> {
  const qc = useQueryClient();
  return useMutation<SessionDTO, Error, void>({
    mutationFn: () =>
      apiFetch<SessionDTO>("/auth/stop-impersonating", { method: "POST" }),
    onSuccess: (session) => {
      setSessionToken(session.token);
      qc.setQueryData(SESSION_QUERY_KEY, session);
      qc.invalidateQueries({
        predicate: (q) =>
          !(
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "auth" &&
            q.queryKey[1] === "session"
          ),
      });
    },
  });
}
