import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import type { User } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// §6.1.6 / §6.5.1 — reads X-User-Id and attaches the user.
// 401 UNAUTHORIZED if header missing or user not found.
// 403 USER_INACTIVE if user exists but `is_active = false`.
// GET /health is exempt; mount this middleware AFTER the health route.
export async function currentUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = req.header("X-User-Id");
    const headerValue = Array.isArray(raw) ? raw[0] : raw;
    if (!headerValue || headerValue.trim() === "") {
      throw new HttpProblem({
        status: 401,
        code: "UNAUTHORIZED",
        title: "Unauthorized",
        detail: "X-User-Id header is required.",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: headerValue } });
    if (!user) {
      throw new HttpProblem({
        status: 401,
        code: "UNAUTHORIZED",
        title: "Unauthorized",
        detail: "X-User-Id does not match a known user.",
      });
    }

    if (!user.isActive) {
      throw new HttpProblem({
        status: 403,
        code: "USER_INACTIVE",
        title: "User inactive",
        detail: "This user is deactivated and cannot make API calls.",
      });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
