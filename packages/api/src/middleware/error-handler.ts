import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { HttpProblem, type FieldIssue } from "../lib/problem.js";

// Converts zod issues to the §6.5.2 `field_issues` shape.
function zodIssuesToFieldIssues(err: ZodError): FieldIssue[] {
  return err.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

// Express 4 passes errors here when `next(err)` is called. Every uncaught
// error is translated into the RFC 7807 envelope. Stack traces never leak
// to the client (§9.2 T-R5).
export const errorHandler: ErrorRequestHandler = (err, req: Request, res, _next) => {
  const instance = req.originalUrl;

  // 1) Known HttpProblem — pass through.
  if (err instanceof HttpProblem) {
    res
      .status(err.status)
      .type("application/problem+json")
      .json(err.toBody(instance));
    return;
  }

  // 2) Zod errors are always validation failures.
  if (err instanceof ZodError) {
    const problem = new HttpProblem({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Invalid request body",
      detail: "One or more fields failed validation. See field_issues.",
      fieldIssues: zodIssuesToFieldIssues(err),
    });
    res
      .status(problem.status)
      .type("application/problem+json")
      .json(problem.toBody(instance));
    return;
  }

  // 3) Unknown — log internally, return generic 500.
  console.error("[unhandled error]", err);
  const fallback = new HttpProblem({
    status: 500,
    code: "INTERNAL_ERROR",
    title: "Internal server error",
    detail: "An unexpected error occurred.",
  });
  res
    .status(fallback.status)
    .type("application/problem+json")
    .json(fallback.toBody(instance));
};
