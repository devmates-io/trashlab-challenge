// Fetch wrapper for the api (§6.5.1 / §6.5.2).
// - Prepends VITE_API_URL
// - Injects `Authorization: Bearer <token>` from localStorage
// - Parses application/problem+json on error and throws a typed ApiError
// - On 401 responses, clears the stored token so subsequent requests stop
//   sending stale credentials. Does NOT redirect — the auth guard at the
//   Layout level reacts to the resulting query error and navigates to /login.

export const SESSION_TOKEN_STORAGE_KEY = "bill-pay.session-token";

// Custom event fired whenever the stored session token is set or cleared
// from within this tab. The native `storage` event only fires for *other*
// tabs, so we need this in-tab notification to drive React re-renders when
// apiFetch clears the token on 401, when login persists the new token, and
// when logout wipes it.
export const SESSION_TOKEN_CHANGED_EVENT = "bill-pay:session-token-changed";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    } else {
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // localStorage may be unavailable (private mode); fail silently
  }
  try {
    window.dispatchEvent(new Event(SESSION_TOKEN_CHANGED_EVENT));
  } catch {
    // window may not exist (SSR / tests)
  }
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail: string;
  public readonly fieldIssues: FieldIssue[];
  public readonly type?: string;
  public readonly instance?: string;
  // The raw RFC 7807 problem document body. Feature-specific error codes
  // (e.g. POSSIBLE_DUPLICATE carries a `matches` array) can pull their
  // custom fields off this without us having to enumerate them in ApiError.
  public readonly body?: Record<string, unknown>;

  constructor(opts: {
    code: string;
    status: number;
    detail: string;
    fieldIssues?: FieldIssue[];
    type?: string;
    instance?: string;
    body?: Record<string, unknown>;
  }) {
    super(opts.detail);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.detail = opts.detail;
    this.fieldIssues = opts.fieldIssues ?? [];
    this.type = opts.type;
    this.instance = opts.instance;
    this.body = opts.body;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

// Codes that indicate the stored bearer is no longer usable. We clear the
// token on these so the auth guard's "no token? → /login" branch fires on
// the next render. INVALID_CREDENTIALS only ever comes from POST /auth/login,
// where there is no token to clear, but listing it here is harmless.
const TOKEN_INVALIDATING_CODES = new Set(["UNAUTHORIZED", "INVALID_CREDENTIALS"]);

function clearTokenOnAuthFailure(status: number, code: string): void {
  if (status !== 401) return;
  if (!TOKEN_INVALIDATING_CODES.has(code)) return;
  setSessionToken(null);
}

export async function apiFetch<T = unknown>(
  pathname: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { body, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  const token = getSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let finalBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      finalBody = body;
    } else {
      headers.set("Content-Type", "application/json");
      finalBody = JSON.stringify(body);
    }
  }

  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...rest,
    headers,
    body: finalBody,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    if (
      contentType.includes("application/problem+json") ||
      contentType.includes("application/json")
    ) {
      const payload = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & {
            code?: string;
            status?: number;
            detail?: string;
            title?: string;
            field_issues?: FieldIssue[];
            type?: string;
            instance?: string;
          })
        | null;
      const code = payload?.code ?? "UNKNOWN_ERROR";
      const status = payload?.status ?? res.status;
      clearTokenOnAuthFailure(status, code);
      throw new ApiError({
        code,
        status,
        detail: payload?.detail ?? payload?.title ?? res.statusText,
        fieldIssues: payload?.field_issues,
        type: payload?.type,
        instance: payload?.instance,
        body: payload ?? undefined,
      });
    }
    clearTokenOnAuthFailure(res.status, "UNKNOWN_ERROR");
    throw new ApiError({
      code: "UNKNOWN_ERROR",
      status: res.status,
      detail: res.statusText || "Request failed",
    });
  }

  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

// Same auth + problem-JSON handling as apiFetch, but returns a Blob for
// endpoints that serve binary content (e.g. GET /uploads/:stored_filename).
// Use this when you need to display an authenticated file in <img>/<iframe>,
// which cannot carry custom headers themselves — convert the Blob to an
// object URL with URL.createObjectURL and revoke it on cleanup.
export async function apiFetchBlob(
  pathname: string,
  init: Omit<ApiRequestInit, "body"> = {},
): Promise<Blob> {
  const { headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  const token = getSessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE_URL}${pathname}`, { ...rest, headers });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/problem+json") ||
      contentType.includes("application/json")
    ) {
      const payload = (await res.json().catch(() => null)) as
        | {
            code?: string;
            status?: number;
            detail?: string;
            title?: string;
            field_issues?: FieldIssue[];
            type?: string;
            instance?: string;
          }
        | null;
      const code = payload?.code ?? "UNKNOWN_ERROR";
      const status = payload?.status ?? res.status;
      clearTokenOnAuthFailure(status, code);
      throw new ApiError({
        code,
        status,
        detail: payload?.detail ?? payload?.title ?? res.statusText,
        fieldIssues: payload?.field_issues,
        type: payload?.type,
        instance: payload?.instance,
      });
    }
    clearTokenOnAuthFailure(res.status, "UNKNOWN_ERROR");
    throw new ApiError({
      code: "UNKNOWN_ERROR",
      status: res.status,
      detail: res.statusText || "Request failed",
    });
  }

  return res.blob();
}
