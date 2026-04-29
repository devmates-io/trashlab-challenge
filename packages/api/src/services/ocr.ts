// §6.10.1 — invoice OCR via Anthropic Claude (with deterministic stub
// fallback when no API key is configured).
//
// We deliberately use raw `fetch` against the Anthropic /v1/messages
// endpoint instead of the @anthropic-ai/sdk package — the schema is small,
// the API is stable, and we'd rather not add another runtime dependency
// for one call site. If we grow more LLM use cases, swap in the SDK then.
//
// Model choice (claude-sonnet-4-5-20250929 by default) is overridable via
// the `ANTHROPIC_MODEL` env var so a future bump doesn't require a code
// change. The model receives a structured-extraction prompt with strict
// instructions to return JSON only — we then validate that JSON against
// `billExtractResponseSchema` shape (the .source field is server-set).

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  billExtractResponseSchema,
  type BillExtractResponse,
} from "@bill-pay/shared";
import { stagedUploads } from "../lib/upload-staging.js";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

interface ResolvedAttachment {
  storedFilename: string;
  mimeType: string;
}

// Resolves the on-disk file behind an `attachment_id`. The id can refer
// either to a row in the `attachments` table (a bill is already saved) OR
// a record in the in-memory `stagedUploads` map (the user just uploaded
// and is on the create-bill form). We check staging first because that's
// the more common path for the extraction flow — a fresh upload is the
// one most likely to be extracted from.
async function resolveAttachment(
  attachmentId: string,
): Promise<ResolvedAttachment> {
  const staged = stagedUploads.get(attachmentId);
  if (staged) {
    return {
      storedFilename: staged.storedFilename,
      mimeType: staged.mimeType,
    };
  }
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { storedFilename: true, mimeType: true },
  });
  if (row) return row;
  throw new HttpProblem({
    status: 404,
    code: "ATTACHMENT_NOT_FOUND",
    title: "Attachment not found",
    detail: "No upload or attachment with that id.",
  });
}

// The extraction prompt is intentionally surgical: tell the model what we
// want, what shape, and that it MUST output valid JSON only. We provide
// the cents convention up-front because $1,234.56 → 123456 is a common
// place for the model to get tripped up.
const EXTRACTION_PROMPT = `You are an accounts-payable invoice extractor. Extract the following fields from the attached invoice and return ONLY a single JSON object (no preamble, no code fences, no explanation):

- vendor_name: string (the issuing vendor / supplier)
- invoice_number: string (the vendor's invoice / reference number)
- amount_cents: integer (TOTAL amount due, in USD cents — multiply dollars by 100, drop fractional cents; do NOT include currency symbols or commas)
- issue_date: string (invoice issue date in ISO format YYYY-MM-DD)
- due_date: string (payment due date in ISO format YYYY-MM-DD; if not stated, use the same value as issue_date)
- line_items: array of { description: string, amount_cents: integer } (each line item; amounts must sum to the top-level amount_cents)
- confidence: number between 0 and 1 (your overall confidence in the extraction)

Omit any field you cannot identify with reasonable confidence. The response must parse as JSON.`;

// Strips common LLM JSON wrapping (markdown fences, leading prose). The
// extraction prompt already asks for "JSON only", but we belt-and-braces
// in case the model hedges with "Here's the extraction: { ... }".
function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  // ```json ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // First { ... last } — if the model added prose before/after.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

// Calls Anthropic /v1/messages with a document content block containing
// the invoice file. The Anthropic API accepts both PDFs (document type)
// and images (image type) as base64 — we branch on mime.
async function callAnthropic(
  apiKey: string,
  model: string,
  fileBytes: Buffer,
  mimeType: string,
): Promise<BillExtractResponse> {
  const base64 = fileBytes.toString("base64");

  // For PDFs the API expects the `document` content block; for images,
  // `image`. Both carry a base64 source. The model handles each kind.
  type ContentBlock =
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
    | {
        type: "document";
        source: { type: "base64"; media_type: string; data: string };
      };

  const fileBlock: ContentBlock =
    mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType as "image/png" | "image/jpeg",
            data: base64,
          },
        };

  const body = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user" as const,
        content: [fileBlock, { type: "text" as const, text: EXTRACTION_PROMPT }],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpProblem({
      status: 502,
      code: "OCR_PROVIDER_ERROR",
      title: "Extraction provider error",
      detail: `Anthropic API returned ${res.status}: ${text.slice(0, 200)}`,
    });
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new HttpProblem({
      status: 502,
      code: "OCR_EMPTY_RESPONSE",
      title: "Empty extraction response",
      detail: "The provider returned no text content.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(textBlock.text));
  } catch {
    throw new HttpProblem({
      status: 502,
      code: "OCR_PARSE_ERROR",
      title: "Could not parse extraction",
      detail: "The provider's response was not valid JSON.",
    });
  }

  // Run through the shared schema. We tag the source as "anthropic"; any
  // field the model emitted that doesn't match the schema is dropped by
  // .strip() (the schema is open by default — we filter manually).
  const result = billExtractResponseSchema.safeParse({
    ...(parsed as Record<string, unknown>),
    source: "anthropic",
  });
  if (!result.success) {
    throw new HttpProblem({
      status: 502,
      code: "OCR_SCHEMA_ERROR",
      title: "Extraction shape mismatch",
      detail:
        "The provider returned values that don't match the expected schema. Try again or fill the form manually.",
      fieldIssues: result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    });
  }
  return result.data;
}

// Deterministic stub for the no-API-key path. We don't try to "fake OCR"
// — the response clearly identifies itself as a stub via `source: "stub"`,
// and only fills the fields we can derive from the file metadata (a sample
// date today, a placeholder amount, etc.). The web client's "Stub
// extraction" badge tells the reviewer they need to set ANTHROPIC_API_KEY
// to see real OCR.
function stubExtraction(): BillExtractResponse {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const due = new Date(today);
  due.setDate(due.getDate() + 30);
  const dueIso = due.toISOString().slice(0, 10);
  return {
    vendor_name: undefined,
    invoice_number: `INV-STUB-${today.getTime().toString(36).slice(-6).toUpperCase()}`,
    amount_cents: 12500,
    issue_date: iso,
    due_date: dueIso,
    line_items: [{ description: "Stub line item (set ANTHROPIC_API_KEY for real OCR)", amount_cents: 12500 }],
    confidence: 0,
    source: "stub",
  };
}

export async function extractFromAttachment(
  attachmentId: string,
): Promise<BillExtractResponse> {
  const { storedFilename, mimeType } = await resolveAttachment(attachmentId);

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return stubExtraction();
  }

  const filePath = path.join(UPLOAD_DIR, storedFilename);
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch {
    throw new HttpProblem({
      status: 404,
      code: "ATTACHMENT_FILE_MISSING",
      title: "Attachment file missing",
      detail: "The upload exists but the file could not be read from disk.",
    });
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  return callAnthropic(apiKey, model, bytes, mimeType);
}
