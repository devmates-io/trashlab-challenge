import cors from "cors";
import express from "express";
import { currentUser } from "./middleware/current-user.js";
import { errorHandler } from "./middleware/error-handler.js";
import { approvalRulesRouter } from "./routes/approval-rules.js";
import { approvalsRouter } from "./routes/approvals.js";
import {
  authProtectedRouter,
  authPublicRouter,
} from "./routes/auth.js";
import { billsRouter } from "./routes/bills.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { healthRouter } from "./routes/health.js";
import { uploadsRouter } from "./routes/uploads.js";
import { usersRouter } from "./routes/users.js";
import { vendorsRouter } from "./routes/vendors.js";

const app = express();

// §6.5.1 — local-only demo, CORS is permissive.
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

// Health and the public auth surface (POST /auth/login) MUST be mounted
// before the currentUser middleware — the whole point of login is that
// the caller does not yet have a bearer token.
app.use(healthRouter);
app.use(authPublicRouter);

// All subsequent routes require a valid Authorization: Bearer <token>
// resolving to a non-expired Session row.
app.use(currentUser);

app.use(authProtectedRouter);
app.use(usersRouter);
app.use(vendorsRouter);
app.use(billsRouter);
app.use(approvalsRouter);
app.use(approvalRulesRouter);
app.use(uploadsRouter);
app.use(dashboardRouter);

// Error handler MUST be registered last.
app.use(errorHandler);

const port = Number.parseInt(process.env.API_PORT ?? "4000", 10);
app.listen(port, () => {
  console.log(`[api] listening on http://0.0.0.0:${port}`);
});
