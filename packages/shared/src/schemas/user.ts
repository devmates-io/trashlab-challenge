import { z } from "zod";
import { USER_ROLE_VALUES } from "../enums.js";
import { cuidSchema, isoDateTimeStringSchema, moneyCentsSchema } from "./common.js";

// Demo-grade minimum. Long enough to discourage `12345` but no complexity
// rules — this is not a production password policy.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

// UserDTO matches GET /users and GET /users/me response (§6.5.4).
//
// `email` is required (the login identifier; non-nullable on the DB column).
// `password_hash` is intentionally absent — passwords never leave the server.
export const userDtoSchema = z.object({
  id: cuidSchema,
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(USER_ROLE_VALUES),
  max_approval_amount_cents: moneyCentsSchema,
  is_active: z.boolean(),
  created_at: isoDateTimeStringSchema.optional(),
  updated_at: isoDateTimeStringSchema.optional(),
});

export type UserDTO = z.infer<typeof userDtoSchema>;

// POST /users — admin-only. The plaintext `password` is hashed server-side
// (bcrypt) before persistence and is never echoed back. `is_active` defaults
// to true server-side when omitted.
export const createUserRequestSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(USER_ROLE_VALUES),
  max_approval_amount_cents: moneyCentsSchema,
  password: passwordSchema,
  is_active: z.boolean().optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

// PATCH /users/:id when the actor is an admin. Every field is optional;
// supplying `password` rotates the bcrypt hash.
export const updateUserRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(USER_ROLE_VALUES).optional(),
  max_approval_amount_cents: moneyCentsSchema.optional(),
  is_active: z.boolean().optional(),
  password: passwordSchema.optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

// PATCH /users/:id when the actor is editing themselves AND is NOT an admin.
// Restricted to identity / credential fields — the API enforces that role,
// max_approval_amount_cents, and is_active are forbidden in this surface
// (privilege escalation prevention).
export const selfUpdateRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
});
export type SelfUpdateRequest = z.infer<typeof selfUpdateRequestSchema>;
