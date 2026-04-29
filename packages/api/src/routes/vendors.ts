import { Router } from "express";
import type { Prisma } from "@prisma/client";
import {
  vendorCreateRequestSchema,
  vendorPatchRequestSchema,
  paymentDetailsStoredSchema,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import { vendorToDto } from "../lib/dto.js";

// §6.5.3 — vendors endpoints.
export const vendorsRouter = Router();

// GET /vendors — list all, including inactive (§7 V-AC-3).
vendorsRouter.get("/vendors", async (_req, res, next) => {
  try {
    const rows = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
    res.json(rows.map(vendorToDto));
  } catch (err) {
    next(err);
  }
});

// POST /vendors — create. Zod validates `payment_method` against all four
// supported values (ach / check / wire / card) per §6.2.6.
vendorsRouter.post(
  "/vendors",
  validate(vendorCreateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof vendorCreateRequestSchema._output;

      const name = body.name.trim();
      if (name.length === 0) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail: "One or more fields failed validation. See field_issues.",
          fieldIssues: [{ path: "name", message: "Name cannot be blank" }],
        });
      }

      const detailsResult = paymentDetailsStoredSchema.safeParse(body.payment_details);
      if (!detailsResult.success) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail: "One or more fields failed validation. See field_issues.",
          fieldIssues: detailsResult.error.issues.map((issue) => ({
            path: issue.path.length > 0
              ? `payment_details.${issue.path.join(".")}`
              : "payment_details",
            message: issue.message,
          })),
        });
      }

      const v = await prisma.vendor.create({
        data: {
          name,
          contactEmail: body.contact_email ?? null,
          paymentMethod: body.payment_method,
          paymentDetails: detailsResult.data as unknown as Prisma.InputJsonValue,
          isActive: true,
        },
      });
      res.status(201).json(vendorToDto(v));
    } catch (err) {
      next(err);
    }
  },
);

// GET /vendors/:id — detail. Plain VendorDTO — UI fetches bills separately.
vendorsRouter.get("/vendors/:id", async (req, res, next) => {
  try {
    const v = await prisma.vendor.findUnique({
      where: { id: req.params.id },
    });
    if (!v) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Vendor not found",
        detail: "No vendor with that id.",
      });
    }
    res.json(vendorToDto(v));
  } catch (err) {
    next(err);
  }
});

// PATCH /vendors/:id — partial. If payment_method changes the zod schema
// requires payment_details of the new shape.
vendorsRouter.patch(
  "/vendors/:id",
  validate(vendorPatchRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof vendorPatchRequestSchema._output;
      const existing = await prisma.vendor.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        throw new HttpProblem({
          status: 404,
          code: "NOT_FOUND",
          title: "Vendor not found",
          detail: "No vendor with that id.",
        });
      }

      const data: Prisma.VendorUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.contact_email !== undefined) {
        data.contactEmail = body.contact_email ?? null;
      }
      if (body.payment_method !== undefined) {
        data.paymentMethod = body.payment_method;
      }
      if (body.payment_details !== undefined) {
        data.paymentDetails = body.payment_details as unknown as Prisma.InputJsonValue;
      }

      const updated = await prisma.vendor.update({
        where: { id: existing.id },
        data,
      });
      res.json(vendorToDto(updated));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /vendors/:id — 204 on success; 409 VENDOR_HAS_BILLS if any bill
// references it (§6.2.7 / §7 V-AC-6).
vendorsRouter.delete("/vendors/:id", async (req, res, next) => {
  try {
    const existing = await prisma.vendor.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Vendor not found",
        detail: "No vendor with that id.",
      });
    }
    const billCount = await prisma.bill.count({
      where: { vendorId: existing.id },
    });
    if (billCount > 0) {
      throw new HttpProblem({
        status: 409,
        code: "VENDOR_HAS_BILLS",
        title: "Vendor has bills",
        detail: `Cannot delete: ${billCount} bill(s) reference this vendor. Deactivate instead.`,
      });
    }
    await prisma.vendor.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
