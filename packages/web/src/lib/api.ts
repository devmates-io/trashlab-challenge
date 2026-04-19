// Fetch wrapper for the api (§6.5.1 / §6.5.2).
// - Prepends VITE_API_URL
// - Injects X-User-Id from localStorage
// - Parses application/problem+json on error and throws a typed ApiError

export const CURRENT_USER_STORAGE_KEY = "bill-pay.current-user-id";

export function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem(CURRENT_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setCurrentUserId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    } else {
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, id);
    }
  } catch {
    // localStorage may be unavailable (private mode); fail silently
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

  constructor(opts: {
    code: string;
    status: number;
    detail: string;
    fieldIssues?: FieldIssue[];
    type?: string;
    instance?: string;
  }) {
    super(opts.detail);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.detail = opts.detail;
    this.fieldIssues = opts.fieldIssues ?? [];
    this.type = opts.type;
    this.instance = opts.instance;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiFetch<T = unknown>(
  pathname: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const { body, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  const userId = getCurrentUserId();
  if (userId) headers.set("X-User-Id", userId);
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
    if (contentType.includes("application/problem+json") || contentType.includes("application/json")) {
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
      throw new ApiError({
        code: payload?.code ?? "UNKNOWN_ERROR",
        status: payload?.status ?? res.status,
        detail: payload?.detail ?? payload?.title ?? res.statusText,
        fieldIssues: payload?.field_issues,
        type: payload?.type,
        instance: payload?.instance,
      });
    }
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
  const userId = getCurrentUserId();
  if (userId) headers.set("X-User-Id", userId);

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
      throw new ApiError({
        code: payload?.code ?? "UNKNOWN_ERROR",
        status: payload?.status ?? res.status,
        detail: payload?.detail ?? payload?.title ?? res.statusText,
        fieldIssues: payload?.field_issues,
        type: payload?.type,
        instance: payload?.instance,
      });
    }
    throw new ApiError({
      code: "UNKNOWN_ERROR",
      status: res.status,
      detail: res.statusText || "Request failed",
    });
  }

  return res.blob();
}
