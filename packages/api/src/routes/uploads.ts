import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { HttpProblem } from "../lib/problem.js";
import { stagedUploads } from "../lib/upload-staging.js";

export const uploadsRouter = Router();

// §6.2.3 Attachment constraints:
// - mime_type ∈ {application/pdf, image/png, image/jpeg}
// - size_bytes <= 10 MB
// All enforced here at the multer layer so downstream handler logic only has
// to persist metadata.

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";

// Best-effort directory creation. The Dockerfile already chowns this; this
// line is for local (non-docker) runs.
try {
  mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {
  // swallow — inability to create is surfaced at request time by multer
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const storedName = `${randomBytes(12).toString("hex")}${ext}`;
    cb(null, storedName);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(
        new HttpProblem({
          status: 400,
          code: "INVALID_MIME_TYPE",
          title: "Invalid file type",
          detail: `Only ${Array.from(ALLOWED_MIME_TYPES).join(", ")} are accepted.`,
        }),
      );
      return;
    }
    cb(null, true);
  },
});

// Translate multer's size-limit error into the canonical 413 FILE_TOO_LARGE.
function wrapMulter(handler: ReturnType<typeof uploadMiddleware.single>) {
  return (req: Parameters<typeof handler>[0], res: Parameters<typeof handler>[1], next: Parameters<typeof handler>[2]) => {
    handler(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        next(
          new HttpProblem({
            status: 413,
            code: "FILE_TOO_LARGE",
            title: "Payload too large",
            detail: `Upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`,
          }),
        );
        return;
      }
      next(err);
    });
  };
}

// CUID-ish id generator for the attachment staging map. We deliberately don't
// use Prisma's cuid helper here because the staged row is not yet a DB row —
// this is just a client-visible handle.
function generateAttachmentId(): string {
  return `att_${randomBytes(12).toString("hex")}`;
}

// POST /uploads — store file, stage metadata until the bill that will own it
// is created (§6.5.3). Response shape per §6.5.4.
uploadsRouter.post(
  "/uploads",
  wrapMulter(uploadMiddleware.single("file")),
  (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail: "Expected a multipart/form-data request with field 'file'.",
          fieldIssues: [{ path: "file", message: "Required" }],
        });
      }
      const id = generateAttachmentId();
      stagedUploads.set(id, {
        id,
        originalFilename: file.originalname,
        storedFilename: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByUserId: req.user!.id,
        uploadedAt: new Date(),
      });
      res.status(201).json({
        attachment_id: id,
        original_filename: file.originalname,
        stored_filename: file.filename,
        mime_type: file.mimetype,
        size_bytes: file.size,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /uploads/:stored_filename — serve the binary with the correct MIME
// based on the extension. 404 if missing. Any active user may read (§4.6).
uploadsRouter.get("/uploads/:stored_filename", (req, res, next) => {
  try {
    const raw = req.params.stored_filename;
    // Guard against path traversal; only accept the exact file name.
    if (raw.includes("/") || raw.includes("..") || raw.includes("\\")) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Not found",
        detail: "Upload not found.",
      });
    }
    const full = path.join(UPLOAD_DIR, raw);
    if (!existsSync(full) || !statSync(full).isFile()) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Not found",
        detail: "Upload not found.",
      });
    }
    const ext = path.extname(raw).toLowerCase();
    const mime =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "application/octet-stream";
    res.type(mime).sendFile(full);
  } catch (err) {
    next(err);
  }
});
