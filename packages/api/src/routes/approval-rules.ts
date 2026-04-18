import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  approvalRuleCreateRequestSchema,
  approvalRulePatchRequestSchema,
  cuidSchema,
  moneyCentsSchema,
  positiveMoneyCentsSchema,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import { ruleToDto, userToDto } from "../lib/dto.js";
import {
  assertDefaultRuleInvariant,
  computeEligiblePoolPreview,
  validateRuleAgainstV1toV5,
} from "../services/approval-engine.js";

// §6.5.3 — approval rules endpoints.
export const approvalRulesRouter = Router();

// GET /approval-rules — list (includes inactive) with qualified_approvers per
// rule so the UI can flag configuration issues.
approvalRulesRouter.get("/approval-rules", async (_req, res, next) => {
  try {
    const [rules, users] = await Promise.all([
      prisma.approvalRule.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.user.findMany(),
    ]);
    res.json(rules.map((r) => ruleToDto(r, users)));
  } catch (err) {
    next(err);
  }
});

// POST /approval-rules — create + V1–V5 validation.
approvalRulesRouter.post(
  "/approval-rules",
  validate(approvalRuleCreateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof approvalRuleCreateRequestSchema._output;
      const isActive = body.is_active ?? true;
      const created = await prisma.$transaction(async (tx) => {
        await validateRuleAgainstV1toV5(tx, {
          name: body.name,
          minAmountCents: body.min_amount_cents,
          approverUserIds: body.approver_user_ids,
          isActive,
        });
        const rule = await tx.approvalRule.create({
          data: {
            name: body.name,
            minAmountCents: body.min_amount_cents,
            approverUserIds: body.approver_user_ids,
            isActive,
          },
        });
        // V6 is specifically about not LEAVING zero active min=0 rules.
        // Creating can never trigger it, but we still check for safety.
        await assertDefaultRuleInvariant(tx);
        return rule;
      });
      const users = await prisma.user.findMany();
      res.status(201).json(ruleToDto(created, users));
    } catch (err) {
      next(err);
    }
  },
);

// POST /approval-rules/preview — no persistence.
//
// SPEC DEVIATION FLAG: the spec field name is `sample_bill_amount_cents`
// (optional, defaults to `min_amount_cents`). The shared zod schema uses
// `target_amount_cents` (required). We honor the spec wire contract here
// with a local schema; see summary for the flag.
const previewRequestSchema = z
  .object({
    min_amount_cents: moneyCentsSchema,
    approver_user_ids: z.array(cuidSchema).min(1),
    sample_bill_amount_cents: positiveMoneyCentsSchema.optional(),
  });

approvalRulesRouter.post(
  "/approval-rules/preview",
  validate(previewRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof previewRequestSchema>;
      const sampleAmount = body.sample_bill_amount_cents ?? body.min_amount_cents;
      const activeUsers = await prisma.user.findMany({
        where: { isActive: true },
      });
      const { regular, admin } = computeEligiblePoolPreview(
        body.approver_user_ids,
        sampleAmount,
        activeUsers,
      );
      const effective = new Set<string>([
        ...regular.map((u) => u.id),
        ...admin.map((u) => u.id),
      ]);
      const warnings: Array<{ code: string; message: string }> = [];
      if (regular.length === 0) {
        warnings.push({
          code: "NO_QUALIFIED_APPROVER",
          message:
            "No regular approver in approver_user_ids meets the sample amount; the rule would rely on admin override.",
        });
      }
      res.json({
        regular_approvers: regular.map(userToDto),
        admin_approvers: admin.map(userToDto),
        effective_eligible_user_ids: [...effective],
        warnings,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /approval-rules/:id — detail.
approvalRulesRouter.get("/approval-rules/:id", async (req, res, next) => {
  try {
    const rule = await prisma.approvalRule.findUnique({
      where: { id: req.params.id },
    });
    if (!rule) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Approval rule not found",
        detail: "No approval rule with that id.",
      });
    }
    const users = await prisma.user.findMany();
    res.json(ruleToDto(rule, users));
  } catch (err) {
    next(err);
  }
});

// PATCH /approval-rules/:id — partial; V1–V5 if affected fields are present,
// then post-mutation V6 default-rule invariant.
approvalRulesRouter.patch(
  "/approval-rules/:id",
  validate(approvalRulePatchRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof approvalRulePatchRequestSchema._output;
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.approvalRule.findUnique({
          where: { id: req.params.id },
        });
        if (!existing) {
          throw new HttpProblem({
            status: 404,
            code: "NOT_FOUND",
            title: "Approval rule not found",
            detail: "No approval rule with that id.",
          });
        }
        const merged = {
          name: body.name ?? existing.name,
          minAmountCents:
            body.min_amount_cents ?? existing.minAmountCents,
          approverUserIds:
            body.approver_user_ids ?? existing.approverUserIds,
          isActive: body.is_active ?? existing.isActive,
        };
        await validateRuleAgainstV1toV5(tx, merged);
        const data: Prisma.ApprovalRuleUpdateInput = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.min_amount_cents !== undefined) {
          data.minAmountCents = body.min_amount_cents;
        }
        if (body.approver_user_ids !== undefined) {
          data.approverUserIds = body.approver_user_ids;
        }
        if (body.is_active !== undefined) data.isActive = body.is_active;

        const rule = await tx.approvalRule.update({
          where: { id: existing.id },
          data,
        });
        // Post-mutation default-rule invariant (V6). If the update removed the
        // last active min=0 rule, this throws inside the txn → rollback.
        await assertDefaultRuleInvariant(tx);
        return rule;
      });
      const users = await prisma.user.findMany();
      res.json(ruleToDto(updated, users));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /approval-rules/:id — V7 (RULE_IN_USE) then V6 (DEFAULT_RULE_REQUIRED).
approvalRulesRouter.delete("/approval-rules/:id", async (req, res, next) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.approvalRule.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        throw new HttpProblem({
          status: 404,
          code: "NOT_FOUND",
          title: "Approval rule not found",
          detail: "No approval rule with that id.",
        });
      }
      const refs = await tx.billApproval.count({
        where: { ruleId: existing.id },
      });
      if (refs > 0) {
        throw new HttpProblem({
          status: 409,
          code: "RULE_IN_USE",
          title: "Rule in use",
          detail: `Cannot delete: ${refs} approval(s) reference this rule. Deactivate it instead (set is_active = false).`,
        });
      }
      await tx.approvalRule.delete({ where: { id: existing.id } });
      await assertDefaultRuleInvariant(tx);
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
