import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { HttpProblem, notImplemented } from "../lib/problem.js";

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

// Stub handler — downstream engineer wires persistence.
uploadsRouter.post(
  "/uploads",
  wrapMulter(uploadMiddleware.single("file")),
  (_req, _res, next) => {
    next(notImplemented("POST /uploads is not implemented yet."));
  },
);

uploadsRouter.get("/uploads/:stored_filename", (_req, _res, next) => {
  next(notImplemented("GET /uploads/:stored_filename is not implemented yet."));
});
