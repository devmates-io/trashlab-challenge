import { addDays, format } from "date-fns";
import type { PaymentMethod } from "@bill-pay/shared";

// §4.4 Q-4/Q-5: consistent money + date formatting across the app.
const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

// Date-only ISO strings (`YYYY-MM-DD`) must not be coerced through UTC —
// `new Date("2026-04-04")` parses as midnight UTC, which in any negative
// UTC offset shifts to the previous calendar day. Detect the date-only
// shape and construct a local-midnight Date instead so `formatDate` always
// returns the same calendar day the backend stored.
const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

function toLocalDate(d: Date | string): Date {
  if (typeof d !== "string") return d;
  if (dateOnlyRegex.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return new Date(d);
}

export function formatDate(d: Date | string): string {
  return format(toLocalDate(d), "MMM d, yyyy");
}

export function formatDateTime(d: Date | string): string {
  return format(toLocalDate(d), "MMM d, yyyy · h:mm a");
}

// §6.7.3 — estimated settlement date by method.
// - ach:   +2 business days (skip Sat/Sun)
// - check: +7 calendar days
// - wire:  same day
// - card:  same day
export function estimatedSettlementDate(
  initiatedAt: Date,
  method: PaymentMethod,
): Date {
  if (method === "wire" || method === "card") {
    return initiatedAt;
  }
  if (method === "check") {
    return addDays(initiatedAt, 7);
  }
  // ach: skip Sat (6) and Sun (0).
  let remaining = 2;
  let cursor = initiatedAt;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return cursor;
}
