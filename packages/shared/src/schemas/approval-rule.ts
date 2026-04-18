import { z } from "zod";
import {
  cuidSchema,
  isoDateTimeStringSchema,
  moneyCentsSchema,
  positiveMoneyCentsSchema,
} from "./common.js";

// §6.5.4 POST /approval-rules.
export const approvalRuleCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  min_amount_cents: moneyCentsSchema,
  approver_user_ids: z
    .array(cuidSchema)
    .min(1, "At least one approver is required"),
  is_active: z.boolean().optional(),
});
export type ApprovalRuleCreateRequest = z.infer<
  typeof approvalRuleCreateRequestSchema
>;

// PATCH /approval-rules/:id — partial. Business rule §6.4.4 (must keep ≥1
// active rule with min_amount_cents = 0) is enforced server-side with
// DEFAULT_RULE_REQUIRED.
export const approvalRulePatchRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  min_amount_cents: moneyCentsSchema.optional(),
  approver_user_ids: z.array(cuidSchema).min(1).optional(),
  is_active: z.boolean().optional(),
});
export type ApprovalRulePatchRequest = z.infer<
  typeof approvalRulePatchRequestSchema
>;

// POST /approval-rules/preview — given a candidate rule + bill amount, API
// returns the eligible approvers under those conditions without persisting.
export const approvalRulePreviewRequestSchema = z.object({
  min_amount_cents: moneyCentsSchema,
  approver_user_ids: z.array(cuidSchema).min(1),
  target_amount_cents: positiveMoneyCentsSchema,
});
export type ApprovalRulePreviewRequest = z.infer<
  typeof approvalRulePreviewRequestSchema
>;

export const approvalRuleDtoSchema = z.object({
  id: cuidSchema,
  name: z.string(),
  min_amount_cents: moneyCentsSchema,
  approver_user_ids: z.array(cuidSchema),
  is_active: z.boolean(),
  created_at: isoDateTimeStringSchema.optional(),
  updated_at: isoDateTimeStringSchema.optional(),
});
export type ApprovalRuleDTO = z.infer<typeof approvalRuleDtoSchema>;
