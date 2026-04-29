import { z } from "zod";
import { cuidSchema, isoDateTimeStringSchema } from "./common.js";

// Mirror of the prisma `NotificationType` enum. Kept as a literal tuple so
// the web app can switch on it exhaustively.
export const NOTIFICATION_TYPE_VALUES = [
  "bill_submitted",
  "bill_approved",
  "bill_rejected",
  "bill_paid",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPE_VALUES)[number];

// §6.10.4 — notification DTO. The server attaches a denormalized
// `bill_summary` (vendor name + amount + status) so the bell dropdown can
// render a useful row without a second round-trip per notification.
export const notificationBillSummarySchema = z.object({
  id: cuidSchema,
  vendor_name: z.string(),
  amount_cents: z.number().int(),
  status: z.string(),
});
export type NotificationBillSummary = z.infer<typeof notificationBillSummarySchema>;

export const notificationDtoSchema = z.object({
  id: cuidSchema,
  type: z.enum(NOTIFICATION_TYPE_VALUES),
  bill_id: cuidSchema.nullable(),
  bill_summary: notificationBillSummarySchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  read_at: isoDateTimeStringSchema.nullable(),
  created_at: isoDateTimeStringSchema,
});
export type NotificationDTO = z.infer<typeof notificationDtoSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationDtoSchema),
  unread_count: z.number().int().min(0),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;
