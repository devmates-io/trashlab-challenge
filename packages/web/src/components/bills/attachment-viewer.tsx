import * as React from "react";
import { Download, FileIcon, Loader2 } from "lucide-react";
import type { AttachmentDTO } from "@/hooks/use-bills";
import { useAttachmentBlobUrl } from "@/hooks/use-bills";

// §6.6.6 attachment viewer:
// - PDF: inline iframe (600px min-height) + Download link above it.
// - PNG/JPEG: img (max-width 100%).
// - None: placeholder "No invoice attached."
//
// The /uploads/:stored_filename endpoint is authenticated (requires X-User-Id),
// and browsers don't attach custom headers to <iframe>/<img>/<a> loads. We
// therefore fetch the file via the auth'd api wrapper and render it from a
// blob: URL. The URL is revoked on unmount / attachment change.

export function AttachmentViewer({
  attachment,
}: {
  attachment: AttachmentDTO | null;
}): React.ReactElement {
  const { url, isLoading, error } = useAttachmentBlobUrl(
    attachment?.stored_filename ?? null,
  );

  if (!attachment) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
        <FileIcon className="h-5 w-5" aria-hidden="true" />
        <span>No invoice attached.</span>
      </div>
    );
  }

  const isPdf = attachment.mime_type === "application/pdf";
  const isImage =
    attachment.mime_type === "image/png" ||
    attachment.mime_type === "image/jpeg";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-sm text-muted-foreground">
          {attachment.original_filename}
        </span>
        {url ? (
          <a
            href={url}
            download={attachment.original_filename}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Download className="h-4 w-4" aria-hidden="true" /> Download
          </span>
        )}
      </div>
      <AttachmentBody
        url={url}
        isLoading={isLoading}
        error={error}
        attachment={attachment}
        isPdf={isPdf}
        isImage={isImage}
      />
    </div>
  );
}

function AttachmentBody({
  url,
  isLoading,
  error,
  attachment,
  isPdf,
  isImage,
}: {
  url: string | null;
  isLoading: boolean;
  error: Error | null;
  attachment: AttachmentDTO;
  isPdf: boolean;
  isImage: boolean;
}): React.ReactElement {
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive"
      >
        Failed to load attachment: {error.message}
      </div>
    );
  }

  if (isLoading || !url) {
    return (
      <div
        className="flex items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground"
        style={{ minHeight: isPdf ? 600 : 200 }}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading attachment…
      </div>
    );
  }

  if (isPdf) {
    return (
      <iframe
        src={url}
        title={attachment.original_filename}
        className="w-full rounded-md border bg-white"
        style={{ minHeight: 600 }}
      />
    );
  }

  if (isImage) {
    return (
      <img
        src={url}
        alt={attachment.original_filename}
        className="max-w-full rounded-md border"
      />
    );
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      Cannot preview {attachment.mime_type}.{" "}
      <a href={url} className="underline" target="_blank" rel="noreferrer">
        Open in new tab
      </a>
      .
    </div>
  );
}
