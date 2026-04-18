// §6.7.2 — Mock payment reference generation.
// Per §6.7.2 notes, the check counter is process-local starting at 100000 and
// persists only for the process lifetime. Format strings are method-specific
// to feel realistic at a glance.

import { randomBytes } from "node:crypto";
import type { PaymentMethod } from "@bill-pay/shared";

let checkSequence = 100000;

function yyyymmddUtc(date: Date = new Date()): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

function randomBase36(len: number): string {
  // 5 random bytes -> 8 base36 chars is approximate; use rejection in a loop
  // and truncate/pad to the exact length to avoid short strings.
  const out: string[] = [];
  while (out.join("").length < len) {
    const chunk = randomBytes(8).readBigUInt64BE().toString(36);
    out.push(chunk);
  }
  return out.join("").slice(0, len);
}

function randomHex(len: number): string {
  // Each byte -> 2 hex chars. Round up.
  const bytes = Math.ceil(len / 2);
  return randomBytes(bytes).toString("hex").slice(0, len);
}

function randomDigits(len: number): string {
  let out = "";
  while (out.length < len) {
    // One byte yields a value 0..255; % 10 gives a digit, biased but fine for
    // a non-cryptographic mock reference.
    const b = randomBytes(1)[0] as number;
    out += (b % 10).toString();
  }
  return out.slice(0, len);
}

// §6.7.2 pseudocode, literal translation.
export function generateMockReference(method: PaymentMethod): string {
  switch (method) {
    case "ach":
      return `ACH-${yyyymmddUtc()}-${randomBase36(8)}`;
    case "check": {
      const seq = checkSequence++;
      return `CHK-${seq.toString().padStart(6, "0")}`;
    }
    case "wire":
      return `WIRE-${randomHex(16)}`;
    case "card":
      return `CARD-${randomDigits(4)}-${randomBase36(8)}`;
  }
}
