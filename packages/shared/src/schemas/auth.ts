import { z } from "zod";
import { userDtoSchema } from "./user.js";
import { isoDateTimeStringSchema } from "./common.js";

// POST /auth/login — body. Email + plaintext password. The API verifies the
// password against the stored bcrypt hash and, on success, mints a Session
// row plus the `SessionDTO` response below.
export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// SessionDTO — payload returned by POST /auth/login and GET /auth/session.
//
// `token` is the opaque bearer the client sends in `Authorization: Bearer …`.
// `user` is the *real* authenticated user — the row whose password was
// verified at login.
// `impersonated_user` is set IFF the real user is an admin currently acting
// as another user via the "login as" flow. `null` (not absent) when the
// session is operating as the real user, so the field is unambiguously
// present on every payload.
export const sessionDtoSchema = z.object({
  token: z.string().min(1),
  expires_at: isoDateTimeStringSchema,
  user: userDtoSchema,
  impersonated_user: userDtoSchema.nullable(),
});
export type SessionDTO = z.infer<typeof sessionDtoSchema>;
