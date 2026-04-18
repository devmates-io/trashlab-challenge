// Enums per §6.2.2 — mirrored in prisma/schema.prisma.
// Each is exported as both a frozen string tuple (for runtime iteration and zod
// enums) and as a derived TypeScript union type.

export const USER_ROLE_VALUES = ["submitter", "approver", "admin"] as const;
export type UserRole = (typeof USER_ROLE_VALUES)[number];

export const PAYMENT_METHOD_VALUES = ["ach", "check", "wire", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD_VALUES)[number];

export const BILL_STATUS_VALUES = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
] as const;
export type BillStatus = (typeof BILL_STATUS_VALUES)[number];

export const APPROVAL_STATUS_VALUES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS_VALUES)[number];

export const PAYMENT_STATUS_VALUES = ["completed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export const BILL_EVENT_TYPE_VALUES = [
  "created",
  "submitted",
  "approved",
  "rejected",
  "recalled",
  "paid",
  "edited",
] as const;
export type BillEventType = (typeof BILL_EVENT_TYPE_VALUES)[number];
