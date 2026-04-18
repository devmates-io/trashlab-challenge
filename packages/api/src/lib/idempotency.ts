// Idempotency-Key support for POST /bills/:id/pay per §6.5.1.
// In-memory map is sufficient for the demo (§4.6: "no redis, no in-memory
// store beyond Postgres" is about user data; this is a process-local cache
// that gets rebuilt on restart and is acceptable per §6.5.1 Q60 resolution).
//
// The downstream engineer implementing /pay is responsible for the read /
// write dance; this file just provides the store.

export const idempotencyKeyStore = new Map<string, string>();
