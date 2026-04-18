// Process-local store for uploaded-but-not-yet-linked attachments.
//
// Per §6.5.3 / §6.5.4 the upload flow is: client POSTs /uploads and receives
// an `attachment_id`; later they POST/PATCH /bills with that id. However, the
// Prisma schema requires `Attachment.bill_id` NOT NULL, which means we cannot
// persist a "truly unlinked" Attachment row. We stage the uploaded file
// metadata in-memory keyed by a generated id; `POST /bills` consumes the
// staged entry and creates the Attachment row atomically in the bill txn.
//
// SCHEMA GAP FLAG (see services/README.md): making `bill_id` nullable on
// Attachment would remove this staging layer. Kept in-memory for now per the
// task instructions.

export interface StagedUpload {
  id: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedAt: Date;
}

export const stagedUploads = new Map<string, StagedUpload>();
