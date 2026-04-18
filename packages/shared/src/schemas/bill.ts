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
