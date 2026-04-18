import { z } from "zod";
import { PAYMENT_METHOD_VALUES, PAYMENT_STATUS_VALUES } from "../enums.js";
import {
  cuidSchema,
  isoDateTimeStringSchema,
  positiveMoneyCentsSchema,
} from "./common.js";
import { paymentDetailsStoredSchema } from "./vendor.js";

// §6.5.4 PaymentDTO. Snapshotted fields live on the Payment row itself
// (§6.2.8) — the DTO mirrors that.
export const paymentDtoSchema = z.object({
  id: cuidSchema,
  bill_id: cuidSchema,
  amount_cents: positiveMoneyCentsSchema,
  payment_method: z.enum(PAYMENT_METHOD_VALUES),
  payment_details_snapshot: paymentDetailsStoredSchema,
  status: z.enum(PAYMENT_STATUS_VALUES),
  mock_reference: z.string().min(1),
  initiated_by_user_id: cuidSchema,
  initiated_at: isoDateTimeStringSchema,
});
export type PaymentDTO = z.infer<typeof paymentDtoSchema>;
