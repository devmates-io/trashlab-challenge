import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { billDetailToDto } from "../lib/dto.js";
import { rejectApproval } from "../services/bill-state.js";

// §6.5.3 — POST /approvals/:id/reject (T7).
export const approvalsRouter = Router();

const rejectBodySchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

approvalsRouter.post(
  "/approvals/:id/reject",
  validate(rejectBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof rejectBodySchema>;
      const reason = body.reason ?? null;
      const bill = await rejectApproval(req.user!, req.params.id, reason);
      res.json(billDetailToDto(bill));
    } catch (err) {
      next(err);
    }
  },
);
