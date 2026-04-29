import { Router } from "express";
import type { Session, User } from "@prisma/client";
import { loginRequestSchema } from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import { userToDto } from "../lib/dto.js";
import {
  generateSessionToken,
  newSessionExpiry,
  verifyPassword,
} from "../lib/auth.js";

// §6.5.3 — auth endpoints. The router is split in two: `authPublicRouter`
// is mounted BEFORE the currentUser middleware so unauthenticated clients
// can call `/auth/login`; `authProtectedRouter` is mounted AFTER so the
// middleware enforces a valid bearer token and populates `req.user` /
// `req.realUser` / `req.session`.

export const authPublicRouter = Router();
export const authProtectedRouter = Router();

// Builds the §6.5.4 SessionDTO. `user` always reflects the REAL session
// owner (the password-verified identity); `impersonated_user` is null
// unless the admin is currently acting as someone else. Matches
// `sessionDtoSchema` from @bill-pay/shared exactly.
function toSessionDto(
  session: Pick<Session, "token" | "expiresAt">,
  realUser: User,
  impersonatedUser: User | null,
) {
  return {
    token: session.token,
    expires_at: session.expiresAt.toISOString(),
    user: userToDto(realUser),
    impersonated_user: impersonatedUser ? userToDto(impersonatedUser) : null,
  };
}

// Single uniform 401 for any failed login. Critical: the same error code
// fires for "no such email", "user inactive", and "password mismatch", so
// the response body cannot be used to enumerate accounts.
function invalidCredentials(): HttpProblem {
  return new HttpProblem({
    status: 401,
    code: "INVALID_CREDENTIALS",
    title: "Invalid credentials",
    detail: "Email or password is incorrect.",
  });
}

// POST /auth/login — public. Verify password, mint session.
authPublicRouter.post(
  "/auth/login",
  validate(loginRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof loginRequestSchema._output;

      // Case-insensitive email match: the demo seed uses lowercased emails
      // and the UI doesn't normalise input, so this avoids "alice@…" vs
      // "Alice@…" surprises without changing the storage representation.
      const user = await prisma.user.findFirst({
        where: { email: { equals: body.email, mode: "insensitive" } },
      });
      if (!user || !user.isActive) {
        throw invalidCredentials();
      }

      const passwordOk = await verifyPassword(body.password, user.passwordHash);
      if (!passwordOk) {
        throw invalidCredentials();
      }

      const session = await prisma.session.create({
        data: {
          token: generateSessionToken(),
          userId: user.id,
          impersonatedUserId: null,
          expiresAt: newSessionExpiry(),
        },
      });

      res.status(200).json(toSessionDto(session, user, null));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/logout — authenticated. Delete the session row keyed by the
// caller's bearer token. 204 on success. We trust the middleware-resolved
// `req.session.token` rather than re-parsing the header.
authProtectedRouter.post("/auth/logout", async (req, res, next) => {
  try {
    await prisma.session.delete({
      where: { token: req.session!.token },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /auth/session — authenticated. Returns the current SessionDTO. Used
// by the web app on hard refresh to rehydrate its in-memory auth state.
authProtectedRouter.get("/auth/session", async (req, res, next) => {
  try {
    const session = await prisma.session.findUniqueOrThrow({
      where: { token: req.session!.token },
      include: { user: true, impersonatedUser: true },
    });
    res.json(
      toSessionDto(session, session.user, session.impersonatedUser),
    );
  } catch (err) {
    next(err);
  }
});

// POST /auth/impersonate/:userId — authenticated, admin-only.
//
// Authorization gates on `req.realUser` (the actual session owner), NOT
// `req.user` (the acting identity). A non-admin who somehow already had
// `impersonatedUserId` set should not be able to bounce to a different
// target — but in practice impersonation can only START from an admin
// session anyway, so this is just defence-in-depth.
//
// Forbidden cases (each its own descriptive code so the UI can branch):
//   • CANNOT_IMPERSONATE_SELF      — target is the real admin themselves
//   • CANNOT_IMPERSONATE_ADMIN     — target has role = admin
//   • CANNOT_IMPERSONATE_INACTIVE  — target user is_active = false
//
// Idempotent: calling again with a different `userId` while already
// impersonating just swaps the target on the same session row.
authProtectedRouter.post(
  "/auth/impersonate/:userId",
  async (req, res, next) => {
    try {
      const realUser = req.realUser!;
      if (realUser.role !== "admin") {
        throw new HttpProblem({
          status: 403,
          code: "FORBIDDEN",
          title: "Forbidden",
          detail: "Only admins may impersonate other users.",
        });
      }

      const targetId = req.params.userId;
      if (targetId === realUser.id) {
        throw new HttpProblem({
          status: 403,
          code: "CANNOT_IMPERSONATE_SELF",
          title: "Cannot impersonate self",
          detail:
            "You are already this user; stop impersonation instead of re-targeting yourself.",
        });
      }

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) {
        throw new HttpProblem({
          status: 404,
          code: "USER_NOT_FOUND",
          title: "User not found",
          detail: "No user with that id.",
        });
      }
      if (target.role === "admin") {
        throw new HttpProblem({
          status: 403,
          code: "CANNOT_IMPERSONATE_ADMIN",
          title: "Cannot impersonate admin",
          detail:
            "Admins cannot impersonate other admins; this keeps the audit trail unambiguous.",
        });
      }
      if (!target.isActive) {
        throw new HttpProblem({
          status: 403,
          code: "CANNOT_IMPERSONATE_INACTIVE",
          title: "Cannot impersonate inactive user",
          detail:
            "Activate the user first if you need to act on their behalf.",
        });
      }

      const updated = await prisma.session.update({
        where: { token: req.session!.token },
        data: { impersonatedUserId: target.id },
      });

      res.json(toSessionDto(updated, realUser, target));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/stop-impersonating — authenticated.
//
// Sets `impersonatedUserId = null` on the current session. Returns 200
// with the refreshed SessionDTO. Returns 409 NOT_IMPERSONATING when the
// session isn't currently in impersonation mode — chosen over an idempotent
// 200 so a stale browser-tab "stop" click after another tab already stopped
// surfaces visibly instead of silently no-op'ing.
authProtectedRouter.post("/auth/stop-impersonating", async (req, res, next) => {
  try {
    const session = req.session!;
    if (!session.impersonatedUserId) {
      throw new HttpProblem({
        status: 409,
        code: "NOT_IMPERSONATING",
        title: "Not impersonating",
        detail: "This session is not currently impersonating any user.",
      });
    }

    const updated = await prisma.session.update({
      where: { token: session.token },
      data: { impersonatedUserId: null },
    });

    res.json(toSessionDto(updated, req.realUser!, null));
  } catch (err) {
    next(err);
  }
});
