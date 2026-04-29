import { z } from "zod";
import { cuidSchema } from "./common.js";

// §6.10.2 — bulk operations on bills.
//
// Same request shape for approve and pay: an array of bill IDs. We cap at
// 100 to keep the per-request transaction bounded. Larger batches should be
// chunked client-side; we'd rather fail fast than have one slow batch lock
// out other approvers.
const BULK_MAX = 100;

export const bulkBillsRequestSchema = z.object({
  bill_ids: z
    .array(cuidSchema)
    .min(1, "At least one bill required")
    .max(BULK_MAX, `Max ${BULK_MAX} bills per call`),
});
export type BulkBillsRequest = z.infer<typeof bulkBillsRequestSchema>;

// Per-bill outcome envelope. We keep the wire shape uniform across approve
// and pay: each entry is either { bill_id, ok: true } or
// { bill_id, ok: false, code, detail } so the UI can render a per-row toast
// after a partial success without dispatching on operation type.
export const bulkBillResultSchema = z.discriminatedUnion("ok", [
  z.object({
    bill_id: cuidSchema,
    ok: z.literal(true),
  }),
  z.object({
    bill_id: cuidSchema,
    ok: z.literal(false),
    code: z.string().min(1),
    detail: z.string().min(1),
  }),
]);
export type BulkBillResult = z.infer<typeof bulkBillResultSchema>;

export const bulkBillsResponseSchema = z.object({
  results: z.array(bulkBillResultSchema),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type BulkBillsResponse = z.infer<typeof bulkBillsResponseSchema>;
