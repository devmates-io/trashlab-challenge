import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";
import { HttpProblem } from "../lib/problem.js";

type Target = "body" | "query" | "params";

const TARGET_TITLES: Record<Target, string> = {
  body: "Invalid request body",
  query: "Invalid query parameters",
  params: "Invalid path parameters",
};

// `validate(schema)` parses req.body and replaces it with the parsed value.
// Use `.in('query')` / `.in('params')` overrides for those targets. Failures
// bubble to the error handler as a 400 VALIDATION_ERROR with field_issues.
export function validate<S extends ZodTypeAny>(
  schema: S,
  target: Target = "body",
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req[target]);
      if (!result.success) {
        const problem = new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: TARGET_TITLES[target],
          detail: "One or more fields failed validation. See field_issues.",
          fieldIssues: result.error.issues.map((issue) => ({
            path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
            message: issue.message,
          })),
        });
        next(problem);
        return;
      }
      (req[target] as unknown) = result.data;
      next();
    } catch (err) {
      next(err);
    }
  };
}
