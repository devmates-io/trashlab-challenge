import { z } from "zod";
import {
  cuidSchema,
  isoDateStringSchema,
  isoDateTimeStringSchema,
  positiveMoneyCentsSchema,
} from "./common.js";
import { billLineItemCreateSchema } from "./bill.js";

// Mirror of the prisma `RecurringCadence` enum.
export const RECURRING_CADENCE_VALUES = ["monthly", "quarterly", "yearly"] as const;
export type RecurringCadence = (typeof RECURRING_CADENCE_VALUES)[number];

// §6.10.5 — recurring template DTO. Mirrors the storage row but converts
// dates to wire format. `next_run_at` is the date the next materialization
// would happen (ISO date, no time component on the wire); the model stores
// it as DateTime UTC midnight.
export const recurringTemplateDtoSchema = z.object({
  id: cuidSchema,
  name: z.string().min(1).max(100),
  vendor_id: cuidSchema,
  vendor_name: z.string(),
  amount_cents: positiveMoneyCentsSchema,
  cadence: z.enum(RECURRING_CADENCE_VALUES),
  next_run_at: isoDateStringSchema,
  last_run_at: isoDateStringSchema.nullable(),
  line_items: z.array(billLineItemCreateSchema),
  paused_at: isoDateTimeStringSchema.nullable(),
  is_active: z.boolean(),
  created_by_user_id: cuidSchema,
  created_at: isoDateTimeStringSchema,
  updated_at: isoDateTimeStringSchema,
});
export type RecurringTemplateDTO = z.infer<typeof recurringTemplateDtoSchema>;

// POST /recurring-templates — create. The line items must sum to amount
// (same invariant as Bill, enforced server-side, not at schema level).
export const recurringTemplateCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  vendor_id: cuidSchema,
  amount_cents: positiveMoneyCentsSchema,
  cadence: z.enum(RECURRING_CADENCE_VALUES),
  next_run_at: isoDateStringSchema,
  line_items: z.array(billLineItemCreateSchema).min(1),
});
export type RecurringTemplateCreateRequest = z.infer<
  typeof recurringTemplateCreateRequestSchema
>;

// PATCH /recurring-templates/:id — partial update. Cadence change applies
// from the next materialization onward; existing materialized bills are
// unaffected.
export const recurringTemplateUpdateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  vendor_id: cuidSchema.optional(),
  amount_cents: positiveMoneyCentsSchema.optional(),
  cadence: z.enum(RECURRING_CADENCE_VALUES).optional(),
  next_run_at: isoDateStringSchema.optional(),
  line_items: z.array(billLineItemCreateSchema).min(1).optional(),
});
export type RecurringTemplateUpdateRequest = z.infer<
  typeof recurringTemplateUpdateRequestSchema
>;

// POST /recurring-templates/run-due — response. Lists which templates ran
// and the bills they produced (so the UI can deep-link to each new draft).
export const recurringRunDueResponseSchema = z.object({
  ran: z.array(
    z.object({
      template_id: cuidSchema,
      template_name: z.string(),
      bill_id: cuidSchema,
      next_run_at: isoDateStringSchema,
    }),
  ),
});
export type RecurringRunDueResponse = z.infer<typeof recurringRunDueResponseSchema>;
