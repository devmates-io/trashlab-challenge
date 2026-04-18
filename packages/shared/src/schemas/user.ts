import { z } from "zod";
import { USER_ROLE_VALUES } from "../enums.js";
import { cuidSchema, isoDateTimeStringSchema, moneyCentsSchema } from "./common.js";

// UserDTO matches GET /users and GET /users/me response (§6.5.4).
export const userDtoSchema = z.object({
  id: cuidSchema,
  name: z.string().min(1).max(100),
  email: z.string().email().nullable().optional(),
  role: z.enum(USER_ROLE_VALUES),
  max_approval_amount_cents: moneyCentsSchema,
  is_active: z.boolean(),
  created_at: isoDateTimeStringSchema.optional(),
  updated_at: isoDateTimeStringSchema.optional(),
});

export type UserDTO = z.infer<typeof userDtoSchema>;
