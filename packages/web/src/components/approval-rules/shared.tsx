import { toast } from "sonner";
import { ApiError } from "@/lib/api";

// §6.6.11 toast patterns — identical policy to dashboard scope, kept local to
// avoid cross-file coupling with other engineers' scopes.
export function toastSuccess(message: string): void {
  toast.success(message, { duration: 4000 });
}

export function toastApiError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      toast.error("Something went wrong. Please try again.", {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }
    toast.error(err.detail, { duration: Number.POSITIVE_INFINITY });
    return;
  }
  toast.error("Something went wrong. Please try again.", {
    duration: Number.POSITIVE_INFINITY,
  });
}
