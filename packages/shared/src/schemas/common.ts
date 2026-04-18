import { z } from "zod";

// CUIDs are what Prisma generates by default. We don't verify the exact shape
// (Prisma can swap cuid vs cuid2 depending on version); we just require a
// non-empty string. Kept unbranded so DTO outputs from Prisma compose cleanly.
export const cuidSchema = z.string().min(1, "Required");
export type Cuid = z.infer<typeof cuidSchema>;

// ISO 8601 calendar date (YYYY-MM-DD). `issue_date` and `due_date` wire this.
export const isoDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date string (YYYY-MM-DD)");

// ISO 8601 datetime. Accepts Z or timezone offset.
export const isoDateTimeStringSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO 8601 datetime" });

// Integer cents, non-negative. Per §3.3: USD only, integer cents.
export const moneyCentsSchema = z
  .number()
  .int("Must be a whole number of cents")
  .min(0, "Must be >= 0");

// Integer cents, strictly positive. Used for bill amounts and line items.
export const positiveMoneyCentsSchema = z
  .number()
  .int("Must be a whole number of cents")
  .min(1, "Must be > 0");
