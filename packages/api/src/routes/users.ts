import { Router } from "express";
import type { UserDTO } from "@bill-pay/shared";
import type { User } from "@prisma/client";
import { prisma } from "../db.js";

// §6.5.3 — GET /users (C-U1), GET /users/me (C-U3).
//
// These two are the only non-stub endpoints in Phase 1 because the frontend
// layout chrome (§6.6.1 user switcher) cannot function without them.
// Downstream engineers replace everything else in Phase 2+.

export const usersRouter = Router();

function toDto(u: User): UserDTO {
  return {
    id: u.id,
    name: u.name,
    email: u.email ?? null,
    role: u.role,
    max_approval_amount_cents: u.maxApprovalAmountCents,
    is_active: u.isActive,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

usersRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
    });
    res.json(users.map(toDto));
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/users/me", (req, res) => {
  // current-user middleware guarantees req.user is set.
  res.json(toDto(req.user!));
});
