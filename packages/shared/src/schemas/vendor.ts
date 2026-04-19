import { z } from "zod";
import { PAYMENT_METHOD_VALUES } from "../enums.js";
import { cuidSchema, isoDateTimeStringSchema } from "./common.js";

// §6.2.6 — Vendor.payment_details is a discriminated union keyed on
// `payment_method`. These are the per-method payload shapes.

// US ZIP (5 digits, optional ZIP+4).
const usZipRegex = /^\d{5}(-\d{4})?$/;
// US state two-letter codes.
const usStateRegex = /^[A-Z]{2}$/;

export const achPaymentDetailsSchema = z.object({
  method: z.literal("ach"),
  routing_number: z.string().regex(/^\d{9}$/, "Must be exactly 9 digits"),
  account_number: z.string().regex(/^\d{4,17}$/, "Must be 4–17 digits"),
  account_holder_name: z.string().min(1).max(100),
});

export const checkPaymentDetailsSchema = z.object({
  method: z.literal("check"),
  address_line1: z.string().min(1).max(100),
  address_line2: z.string().max(100).optional().nullable(),
  city: z.string().min(1).max(50),
  state: z.string().regex(usStateRegex, "Must be a 2-letter US state code"),
  postal_code: z.string().regex(usZipRegex, "Must be a valid US ZIP"),
});

export const wirePaymentDetailsSchema = z.object({
  method: z.literal("wire"),
  bank_name: z.string().min(1).max(100),
  swift_code: z
    .string()
    .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "Must be 8 or 11 characters"),
  iban: z
    .string()
    .regex(/^[A-Z0-9]{15,34}$/, "Must be 15–34 characters"),
  account_holder_name: z.string().min(1).max(100),
});

export const cardPaymentDetailsSchema = z.object({
  method: z.literal("card"),
  card_brand: z.enum(["visa", "mastercard", "amex", "discover"]),
  last_four: z.string().regex(/^\d{4}$/, "Must be exactly 4 digits"),
});

// Discriminated union over every supported payment method. Used for both
// storage / API-response shapes and for API-request bodies — all four methods
// (ach, check, wire, card) are first-class and user-selectable per §6.2.6.
export const paymentDetailsStoredSchema = z.discriminatedUnion("method", [
  achPaymentDetailsSchema,
  checkPaymentDetailsSchema,
  wirePaymentDetailsSchema,
  cardPaymentDetailsSchema,
]);
export type PaymentDetailsStored = z.infer<typeof paymentDetailsStoredSchema>;

// Alias retained for backward-compatibility with existing imports; the
// request-side and stored-side shapes are identical now that card is
// accepted on create/edit.
export const paymentDetailsRequestSchema = paymentDetailsStoredSchema;
export type PaymentDetailsRequest = z.infer<typeof paymentDetailsRequestSchema>;

// ---- DTO and mutation schemas ----

export const vendorDtoSchema = z.object({
  id: cuidSchema,
  name: z.string().min(1).max(100),
  contact_email: z.string().email().nullable().optional(),
  payment_method: z.enum(PAYMENT_METHOD_VALUES),
  payment_details: paymentDetailsStoredSchema,
  is_active: z.boolean(),
  created_at: isoDateTimeStringSchema.optional(),
  updated_at: isoDateTimeStringSchema.optional(),
});
export type VendorDTO = z.infer<typeof vendorDtoSchema>;

// POST /vendors: payment_method and payment_details must agree on the
// `method` discriminator (validated via superRefine). All four methods are
// accepted per §6.2.6.
export const vendorCreateRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    contact_email: z.string().email().optional().nullable(),
    payment_method: z.enum(PAYMENT_METHOD_VALUES),
    payment_details: paymentDetailsRequestSchema,
  })
  .superRefine((val, ctx) => {
    if (val.payment_method !== val.payment_details.method) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_details", "method"],
        message:
          "payment_details.method must match payment_method on the vendor",
      });
    }
  });
export type VendorCreateRequest = z.infer<typeof vendorCreateRequestSchema>;

// PATCH /vendors/:id: per §6.5.4, a partial of the create body, BUT if
// payment_method changes, payment_details must also be provided with the new
// shape. superRefine catches the mismatch. All four methods are accepted.
export const vendorPatchRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    contact_email: z.string().email().optional().nullable(),
    payment_method: z.enum(PAYMENT_METHOD_VALUES).optional(),
    payment_details: paymentDetailsRequestSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payment_method && !val.payment_details) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_details"],
        message:
          "payment_details is required when payment_method is changed",
      });
    }
    if (
      val.payment_method &&
      val.payment_details &&
      val.payment_method !== val.payment_details.method
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_details", "method"],
        message:
          "payment_details.method must match the new payment_method",
      });
    }
  });
export type VendorPatchRequest = z.infer<typeof vendorPatchRequestSchema>;
