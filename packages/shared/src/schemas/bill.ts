import { z } from "zod";
import { BILL_STATUS_VALUES } from "../enums.js";
import {
  cuidSchema,
  isoDateStringSchema,
  isoDateTimeStringSchema,
  positiveMoneyCentsSchema,
} from "./common.js";

// ---- line items ----

export const billLineItemCreateSchema = z.object({
  description: z.string().min(1).max(200),
  amount_cents: positiveMoneyCentsSchema,
});
export type BillLineItemCreate = z.infer<typeof billLineItemCreateSchema>;

export const billLineItemDtoSchema = billLineItemCreateSchema.extend({
  id: cuidSchema,
  bill_id: cuidSchema,
  created_at: isoDateTimeStringSchema.optional(),
});
export type BillLineItemDTO = z.infer<typeof billLineItemDtoSchema>;

// ---- create / patch ----

// §6.5.4 POST /bills. Note the sum-equals-amount_cents invariant (§6.2.5 #1)
// is enforced at service time, not at schema time, because the error surface
// is more useful with a domain error code than a validation issue.
export const billCreateRequestSchema = z
  .object({
    vendor_id: cuidSchema,
    invoice_number: z.string().min(1).max(50),
    amount_cents: positiveMoneyCentsSchema,
    issue_date: isoDateStringSchema,
    due_date: isoDateStringSchema,
    line_items: z.array(billLineItemCreateSchema).min(1, "At least one line item"),
    attachment_id: cuidSchema.optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.due_date < val.issue_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["due_date"],
        message: "Must be >= issue_date",
      });
    }
  });
export type BillCreateRequest = z.infer<typeof billCreateRequestSchema>;

export const billPatchRequestSchema = z
  .object({
    vendor_id: cuidSchema.optional(),
    invoice_number: z.string().min(1).max(50).optional(),
    amount_cents: positiveMoneyCentsSchema.optional(),
    issue_date: isoDateStringSchema.optional(),
    due_date: isoDateStringSchema.optional(),
    line_items: z.array(billLineItemCreateSchema).min(1).optional(),
    attachment_id: cuidSchema.optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.issue_date && val.due_date && val.due_date < val.issue_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["due_date"],
        message: "Must be >= issue_date",
      });
    }
  });
export type BillPatchRequest = z.infer<typeof billPatchRequestSchema>;

// ---- bill query ----

export const billListQuerySchema = z.object({
  status: z.enum(BILL_STATUS_VALUES).optional(),
});
export type BillListQuery = z.infer<typeof billListQuerySchema>;

// ---- §6.10.3 — duplicate detection ----

// Embedded in the 409 POSSIBLE_DUPLICATE problem document and returned by
// GET /bills/check-duplicate. One row per matching bill (most recent first,
// capped at 5 server-side). The vendor name is denormalized so the UI can
// render the dialog without a second fetch.
export const possibleDuplicateMatchSchema = z.object({
  id: cuidSchema,
  invoice_number: z.string(),
  amount_cents: positiveMoneyCentsSchema,
  status: z.enum(BILL_STATUS_VALUES),
  issue_date: isoDateStringSchema,
  due_date: isoDateStringSchema,
  vendor_id: cuidSchema,
  vendor_name: z.string(),
  created_at: isoDateTimeStringSchema,
});
export type PossibleDuplicateMatch = z.infer<typeof possibleDuplicateMatchSchema>;

// GET /bills/check-duplicate?vendor_id=…&invoice_number=… — pre-flight for
// the create form so we can warn before submission. Body parameters mirror
// the create-bill fields that the duplicate query keys off.
export const checkDuplicateQuerySchema = z.object({
  vendor_id: cuidSchema,
  invoice_number: z.string().min(1).max(50),
});
export type CheckDuplicateQuery = z.infer<typeof checkDuplicateQuerySchema>;

export const checkDuplicateResponseSchema = z.object({
  matches: z.array(possibleDuplicateMatchSchema),
});
export type CheckDuplicateResponse = z.infer<typeof checkDuplicateResponseSchema>;
