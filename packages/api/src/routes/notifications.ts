import { Router } from "express";
import type { Notification, Bill, Vendor } from "@prisma/client";
import type {
  NotificationDTO,
  NotificationListResponse,
  NotificationType,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";

// §6.10.4 — notifications endpoints.
//
// All endpoints scope to `req.user.id` (the acting identity). When an admin
// is impersonating, they see the impersonated user's notifications — same
// principle as every other auth-gated read in the system.

export const notificationsRouter = Router();

// Cap returned rows so the bell dropdown stays bounded. The notifications
// page calls the same endpoint and accepts the same cap; pagination would
// be useful for high-volume accounts but isn't justified for the MVP.
const MAX_NOTIFICATIONS = 50;

type NotificationWithBill = Notification & {
  bill: (Bill & { vendor: Pick<Vendor, "name"> }) | null;
};

function toDto(n: NotificationWithBill): NotificationDTO {
  // Denormalised summary so the dropdown can render without a second
  // round-trip per row. When the bill is gone (cascade-deleted), the
  // summary becomes null but the notification stays so the user can see
  // their inbox history. (Not currently reachable — we never delete bills
  // — but the shape forward-tolerates it.)
  const summary = n.bill
    ? {
        id: n.bill.id,
        vendor_name: n.bill.vendor.name,
        amount_cents: n.bill.amountCents,
        status: n.bill.status,
      }
    : null;
  return {
    id: n.id,
    type: n.type as NotificationType,
    bill_id: n.billId,
    bill_summary: summary,
    payload: (n.payload ?? {}) as Record<string, unknown>,
    read_at: n.readAt ? n.readAt.toISOString() : null,
    created_at: n.createdAt.toISOString(),
  };
}

// GET /notifications — list current user's notifications, newest first.
// Returns a single payload with a denormalised `unread_count` so the
// bell-icon badge can render off the same query (no second endpoint).
notificationsRouter.get("/notifications", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: "desc" },
        take: MAX_NOTIFICATIONS,
        include: { bill: { include: { vendor: { select: { name: true } } } } },
      }),
      prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ]);
    const body: NotificationListResponse = {
      notifications: rows.map(toDto),
      unread_count: unreadCount,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// POST /notifications/:id/read — idempotent. Marks a single notification
// as read; if it's already read or doesn't belong to the caller we 404
// rather than reveal whether it exists at all (cross-user enumeration
// guard, even though the demo is single-tenant).
notificationsRouter.post("/notifications/:id/read", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const found = await prisma.notification.findFirst({
      where: { id: req.params.id, recipientId: userId },
      select: { id: true },
    });
    if (!found) {
      throw new HttpProblem({
        status: 404,
        code: "NOTIFICATION_NOT_FOUND",
        title: "Notification not found",
        detail: "No notification with that id for this user.",
      });
    }
    const updated = await prisma.notification.update({
      where: { id: found.id },
      data: { readAt: new Date() },
      include: { bill: { include: { vendor: { select: { name: true } } } } },
    });
    res.json(toDto(updated));
  } catch (err) {
    next(err);
  }
});

// POST /notifications/read-all — mark every unread notification for the
// caller as read in a single update. Returns 204 to avoid sending the
// (potentially long) post-update list back; the client invalidates the
// notifications query and re-fetches.
notificationsRouter.post("/notifications/read-all", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
