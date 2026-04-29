import { z } from "zod";
import { cuidSchema, isoDateStringSchema, positiveMoneyCentsSchema } from "./common.js";
import { billLineItemCreateSchema } from "./bill.js";

// §6.10.1 — POST /bills/extract request. The caller already uploaded the
// invoice via POST /uploads and now wants the structured fields back. We
// pass `attachment_id` rather than a file payload so the extraction is
// idempotent against the same upload (and so the LLM call doesn't have to
// re-read the bytes from the request body).
export const billExtractRequestSchema = z.object({
  attachment_id: cuidSchema,
});
export type BillExtractRequest = z.infer<typeof billExtractRequestSchema>;

// Every extracted field is optional — we never fabricate a value the model
// didn't confidently identify. The web form treats these as suggestions:
// each field can be edited or cleared before the bill is saved.
//
// `confidence` is a number in [0, 1] from the model's self-report; absent
// when the underlying call returned only structured fields. The UI uses
// it to badge low-confidence values rather than to block submission.
export const billExtractResponseSchema = z.object({
  vendor_name: z.string().min(1).max(200).optional(),
  invoice_number: z.string().min(1).max(50).optional(),
  amount_cents: positiveMoneyCentsSchema.optional(),
  issue_date: isoDateStringSchema.optional(),
  due_date: isoDateStringSchema.optional(),
  line_items: z.array(billLineItemCreateSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  // Identifies the underlying extraction backend so the UI can surface a
  // "stub" indicator when no API key is configured.
  source: z.enum(["anthropic", "stub"]),
});
export type BillExtractResponse = z.infer<typeof billExtractResponseSchema>;
