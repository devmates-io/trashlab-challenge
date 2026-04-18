import { Router } from "express";
import { BILL_STATUS_VALUES } from "@bill-pay/shared";
import { prisma } from "../db.js";
import { billSummaryToDto, toDateString } from "../lib/dto.js";

// §6.5.3 — GET /dashboard. Status totals + overdue + upcoming + paid-last-30.
export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (_req, res, next) => {
  try {
    // --- totals_by_status ---
    const grouped = await prisma.bill.groupBy({
      by: ["status"],
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    const totals_by_status: Record<string, { count: number; sum_cents: number }> = {};
    for (const s of BILL_STATUS_VALUES) {
      totals_by_status[s] = { count: 0, sum_cents: 0 };
    }
    for (const row of grouped) {
      totals_by_status[row.status] = {
        count: row._count._all,
        sum_cents: row._sum.amountCents ?? 0,
      };
    }

    // --- overdue / upcoming computation ---
    // "today" per §6.5.4 is UTC midnight boundary (the wire is date-only, no
    // tz). Treat due_date < today (non-paid) as overdue; today <= due_date <=
    // today + 7d as upcoming. Both exclude `paid`.
    const nowUtc = new Date();
    const todayStr = toDateString(nowUtc);
    const today = new Date(`${todayStr}T00:00:00.000Z`);
    const sevenDaysOut = new Date(today.getTime() + 7 * 86400 * 1000);

    const includeForSummary = {
      vendor: { select: { name: true } },
      creator: { select: { name: true } },
      approvals: { select: { status: true } },
      attachment: { select: { id: true } },
    } as const;

    const [overdueRows, upcomingRows, paidRecent] = await Promise.all([
      prisma.bill.findMany({
        where: {
          status: { not: "paid" },
          dueDate: { lt: today },
        },
        orderBy: { dueDate: "asc" },
        include: includeForSummary,
      }),
      prisma.bill.findMany({
        where: {
          status: { not: "paid" },
          dueDate: { gte: today, lte: sevenDaysOut },
        },
        orderBy: { dueDate: "asc" },
        include: includeForSummary,
      }),
      prisma.payment.aggregate({
        where: {
          initiatedAt: { gte: new Date(nowUtc.getTime() - 30 * 86400 * 1000) },
        },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
    ]);

    res.json({
      totals_by_status,
      overdue_bills: overdueRows.map(billSummaryToDto),
      upcoming_bills: upcomingRows.map(billSummaryToDto),
      paid_last_30_days: {
        count: paidRecent._count._all,
        sum_cents: paidRecent._sum.amountCents ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});
