import { Router } from "express";
import { notImplemented } from "../lib/problem.js";

// §6.5.3 — POST /approvals/:id/reject (T7).
export const approvalsRouter = Router();

approvalsRouter.post("/approvals/:id/reject", (_req, _res, next) => {
  next(notImplemented("POST /approvals/:id/reject is not implemented yet."));
});
