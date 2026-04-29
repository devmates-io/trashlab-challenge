import { Router } from "express";
import type { Prisma, User } from "@prisma/client";
import {
  createUserRequestSchema,
  selfUpdateRequestSchema,
  updateUserRequestSchema,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import { userToDto } from "../lib/dto.js";
import { hashPassword } from "../lib/auth.js";

// §6.5.3 — users endpoints. List + me are read-only and available to any
// authenticated session. Create / patch / activate / deactivate are admin
// (or admin-or-self for PATCH).
//
// Authorization rule of thumb: admin-gated endpoints check `req.user.role`,
// NOT `req.realUser.role`. When an admin impersonates a non-admin and tries
// to create a user, that should fail — impersonation downgrades privileges,
// which is the whole point of the feature (preview the world as the target
// sees it).

export const usersRouter = Router();

function adminOnly(actor: User): void {
  if (actor.role !== "admin") {
    throw new HttpProblem({
      status: 403,
      code: "FORBIDDEN",
      title: "Forbidden",
      detail: "Admin role required for this operation.",
    });
  }
}

function userNotFound(): HttpProblem {
  return new HttpProblem({
    status: 404,
    code: "USER_NOT_FOUND",
    title: "User not found",
    detail: "No user with that id.",
  });
}

// Translates a Prisma P2002 (unique constraint) on the `email` column into
// the canonical 409 EMAIL_TAKEN. Other unique-constraint errors (none on
// User today) bubble up unchanged.
function emailTaken(): HttpProblem {
  return new HttpProblem({
    status: 409,
    code: "EMAIL_TAKEN",
    title: "Email already in use",
    detail: "A user with that email already exists.",
  });
}

async function assertEmailNotTaken(email: string, excludeUserId?: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw emailTaken();
}

usersRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
    });
    res.json(users.map(userToDto));
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/users/me", (req, res) => {
  // current-user middleware guarantees req.user is set.
  res.json(userToDto(req.user!));
});

// POST /users — admin-only. Creates a user with a bcrypt-hashed password.
usersRouter.post(
  "/users",
  validate(createUserRequestSchema),
  async (req, res, next) => {
    try {
      adminOnly(req.user!);
      const body = req.body as typeof createUserRequestSchema._output;

      await assertEmailNotTaken(body.email);
      const passwordHash = await hashPassword(body.password);
      const user = await prisma.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash,
          role: body.role,
          maxApprovalAmountCents: body.max_approval_amount_cents,
          isActive: body.is_active ?? true,
        },
      });

      res.status(201).json(userToDto(user));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /users/:id — admin-or-self.
//
// Self-edit is restricted to identity / credential fields (the
// selfUpdateRequestSchema subset) — privilege escalation prevention.
// Admin edits use the full updateUserRequestSchema.
//
// Side effects on admin-driven patches:
//   • If `is_active` flips from true → false, all of that user's sessions
//     are deleted (forced logout). Same as POST /users/:id/deactivate but
//     only when the boolean is actually being changed away from true.
//   • If `role` is demoted away from `admin`, any sessions where that
//     user is the REAL session owner AND currently impersonating someone
//     are wiped. Sessions without active impersonation are left alone —
//     a plain "your role changed" doesn't require an immediate logout, but
//     an in-flight impersonation should not survive the privilege change.
//
// We don't bother with a transaction here: the side effects are best-effort
// audit hygiene and can run after the user.update commits without correctness
// impact (worst case: a stale impersonating session lives a few hundred ms
// longer before the next request fails).
usersRouter.patch("/users/:id", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const actor = req.user!;
    const isSelf = actor.id === targetId;
    const isAdmin = actor.role === "admin";

    if (!isSelf && !isAdmin) {
      throw new HttpProblem({
        status: 403,
        code: "FORBIDDEN",
        title: "Forbidden",
        detail: "You may only edit your own user, unless you are an admin.",
      });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw userNotFound();

    // Pick schema based on actor identity. An admin editing themselves
    // gets the admin surface (so they can change their own
    // max_approval_amount_cents, role, etc.) — that matches the more
    // permissive of the two schemas.
    const schema = isAdmin ? updateUserRequestSchema : selfUpdateRequestSchema;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpProblem({
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Invalid request body",
        detail: "One or more fields failed validation. See field_issues.",
        fieldIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
          message: issue.message,
        })),
      });
    }
    const body = parsed.data;

    if (body.email !== undefined) {
      await assertEmailNotTaken(body.email, target.id);
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.email !== undefined) data.email = body.email;
    if (body.password !== undefined) {
      data.passwordHash = await hashPassword(body.password);
    }
    // The admin-only fields. selfUpdateRequestSchema would have already
    // rejected these for a non-admin self-edit, so the type narrowing is
    // safe — but we still gate at the assignment level to avoid relying
    // on schema choice for security.
    if (isAdmin) {
      const adminBody = body as typeof updateUserRequestSchema._output;
      if (adminBody.role !== undefined) data.role = adminBody.role;
      if (adminBody.max_approval_amount_cents !== undefined) {
        data.maxApprovalAmountCents = adminBody.max_approval_amount_cents;
      }
      if (adminBody.is_active !== undefined) data.isActive = adminBody.is_active;
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data,
    });

    // Session side effects (admin-driven only — non-admins can't change
    // these fields).
    if (isAdmin) {
      const adminBody = body as typeof updateUserRequestSchema._output;
      if (
        adminBody.is_active === false &&
        target.isActive === true
      ) {
        // Force logout: blow away every session owned by or impersonating
        // this user. Impersonation FK uses ON DELETE RESTRICT, so we have
        // to delete impersonating sessions explicitly first.
        await prisma.session.deleteMany({
          where: {
            OR: [{ userId: target.id }, { impersonatedUserId: target.id }],
          },
        });
      }
      if (
        adminBody.role !== undefined &&
        adminBody.role !== "admin" &&
        target.role === "admin"
      ) {
        // Demoted-from-admin: any in-flight impersonation by this user
        // is now illegitimate. Drop those specific sessions; leave plain
        // (non-impersonating) sessions alone so they get a fresh role on
        // their next request without forcing a re-login.
        await prisma.session.deleteMany({
          where: { userId: target.id, impersonatedUserId: { not: null } },
        });
      }
    }

    res.json(userToDto(updated));
  } catch (err) {
    next(err);
  }
});

// POST /users/:id/deactivate — admin-only. Cannot deactivate self (a
// foot-gun: the admin would lock themselves out and there's no recovery
// flow in this demo). Sets is_active = false and revokes all sessions for
// that user.
usersRouter.post("/users/:id/deactivate", async (req, res, next) => {
  try {
    adminOnly(req.user!);
    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      throw new HttpProblem({
        status: 409,
        code: "CANNOT_DEACTIVATE_SELF",
        title: "Cannot deactivate self",
        detail:
          "Admins cannot deactivate their own account. Ask another admin to do it.",
      });
    }
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw userNotFound();

    // Drop sessions BEFORE flipping is_active so currentUser doesn't get a
    // race window where the user is inactive but sessions still resolve.
    // Order also matters for the impersonation FK (ON DELETE RESTRICT).
    await prisma.session.deleteMany({
      where: {
        OR: [{ userId: target.id }, { impersonatedUserId: target.id }],
      },
    });
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: false },
    });
    res.json(userToDto(updated));
  } catch (err) {
    next(err);
  }
});

// POST /users/:id/activate — admin-only. Sets is_active = true. Idempotent
// against an already-active user (no error) — the result reflects the
// post-state regardless.
usersRouter.post("/users/:id/activate", async (req, res, next) => {
  try {
    adminOnly(req.user!);
    const targetId = req.params.id;
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw userNotFound();

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: true },
    });
    res.json(userToDto(updated));
  } catch (err) {
    next(err);
  }
});
