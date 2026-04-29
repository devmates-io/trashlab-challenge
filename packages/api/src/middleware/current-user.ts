import type { NextFunction, Request, Response } from "express";
import type { Session, User } from "@prisma/client";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { extractBearerToken } from "../lib/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // The "acting" identity: the impersonated user when impersonation is
      // active, otherwise the authenticated user. Existing routes that key
      // off `req.user` (bill creation, approvals, etc.) get the right
      // behaviour automatically — impersonation downgrades to the target's
      // privileges.
      user?: User;
      // The real session owner (the user whose password unlocked this
      // session). Equal to `user` when not impersonating. Routes that gate
      // on admin power for impersonation, or that need to record the real
      // admin in audit-log payloads, read this.
      realUser?: User;
      // Raw session row — handy for /auth/logout (delete by token) and
      // /auth/impersonate (mutate impersonatedUserId in place).
      session?: Session;
    }
  }
}

function unauthorized(detail: string): HttpProblem {
  return new HttpProblem({
    status: 401,
    code: "UNAUTHORIZED",
    title: "Unauthorized",
    detail,
  });
}

// §6.5.1 — bearer-token / server-side-session auth.
//
// Wire-format: `Authorization: Bearer <token>` where `<token>` is the row PK
// in the `sessions` table. We resolve two distinct identities:
//   • realUser    = session.user               (the password-verified owner)
//   • actingUser  = session.impersonatedUser ?? session.user
// Both are attached to the request. `req.user` aliases `actingUser` so
// pre-auth-overhaul routes (bills, approvals, etc.) keep working unchanged.
//
// 401 UNAUTHORIZED for any header / lookup / expiry failure. Single error
// code so callers can distinguish "do a fresh login" from authorisation
// failures (which use 403 codes).
//
// 403 USER_INACTIVE if either identity is `is_active = false`. Deactivating
// a user (§6.5.3 POST /users/:id/deactivate) also revokes their sessions, so
// in practice we'll only see this branch on a race or the impersonation
// target being deactivated mid-session.
//
// `/health` is exempt by virtue of being mounted before this middleware in
// `index.ts` — same as `/auth/login`.
export async function currentUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawHeader = req.header("Authorization");
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const token = extractBearerToken(headerValue);
    if (!token) {
      throw unauthorized(
        "Authorization header missing or malformed; expected 'Bearer <token>'.",
      );
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true, impersonatedUser: true },
    });
    if (!session) {
      throw unauthorized("Session token does not match a known session.");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      // Best-effort cleanup so expired tokens don't pile up. Don't await on
      // the failure path — if this throws, the user still gets the same 401.
      await prisma.session.delete({ where: { token } }).catch(() => {});
      throw unauthorized("Session has expired; please log in again.");
    }

    const realUser = session.user;
    const actingUser = session.impersonatedUser ?? session.user;

    if (!realUser.isActive || !actingUser.isActive) {
      throw new HttpProblem({
        status: 403,
        code: "USER_INACTIVE",
        title: "User inactive",
        detail: "This user is deactivated and cannot make API calls.",
      });
    }

    req.session = {
      token: session.token,
      userId: session.userId,
      impersonatedUserId: session.impersonatedUserId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    };
    req.realUser = realUser;
    req.user = actingUser;
    next();
  } catch (err) {
    next(err);
  }
}
