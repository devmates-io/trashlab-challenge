import { Router } from "express";
import { notImplemented } from "../lib/problem.js";

// §6.5.3 — approval rules endpoints.
export const approvalRulesRouter = Router();

approvalRulesRouter.get("/approval-rules", (_req, _res, next) => {
  next(notImplemented("GET /approval-rules is not implemented yet."));
});

approvalRulesRouter.post("/approval-rules", (_req, _res, next) => {
  next(notImplemented("POST /approval-rules is not implemented yet."));
});

// Preview endpoint lives under /approval-rules/preview; it must be declared
// before the :id route so Express doesn't treat "preview" as an id.
approvalRulesRouter.post("/approval-rules/preview", (_req, _res, next) => {
  next(notImplemented("POST /approval-rules/preview is not implemented yet."));
});

approvalRulesRouter.get("/approval-rules/:id", (_req, _res, next) => {
  next(notImplemented("GET /approval-rules/:id is not implemented yet."));
});

approvalRulesRouter.patch("/approval-rules/:id", (_req, _res, next) => {
  next(notImplemented("PATCH /approval-rules/:id is not implemented yet."));
});

approvalRulesRouter.delete("/approval-rules/:id", (_req, _res, next) => {
  next(notImplemented("DELETE /approval-rules/:id is not implemented yet."));
});
