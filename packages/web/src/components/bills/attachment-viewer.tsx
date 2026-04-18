import * as React from "react";
import { Download, FileIcon } from "lucide-react";
import type { AttachmentDTO } from "@/hooks/use-bills";
import { uploadUrl } from "@/hooks/use-bills";

// §6.6.6 attachment viewer:
// - PDF: inline iframe (600px min-height) + Download link above it.
// - PNG/JPEG: img (max-width 100%).
// - None: placeholder "No invoice attached."

export function AttachmentViewer({
  attachment,
}: {
  attachment: AttachmentDTO | null;
}): React.ReactElement {
  if (!attachment) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
        <FileIcon className="h-5 w-5" aria-hidden="true" />
        <span>No invoice attached.</span>
      </div>
    );
  }

  const url = uploadUrl(attachment.stored_filename);
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
        <a
          href={url}
          download={attachment.original_filename}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Download className="h-4 w-4" /> Download
        </a>
      </div>
      {isPdf ? (
        <iframe
          src={url}
          title={attachment.original_filename}
          className="w-full rounded-md border bg-white"
          style={{ minHeight: 600 }}
        />
      ) : isImage ? (
        <img
          src={url}
          alt={attachment.original_filename}
          className="max-w-full rounded-md border"
        />
      ) : (
        <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Cannot preview {attachment.mime_type}.{" "}
          <a href={url} className="underline" target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          .
        </div>
      )}
    </div>
  );
}
