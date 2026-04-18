// RFC 7807 Problem Details envelope per §6.5.2. Every non-2xx response funnels
// through `HttpProblem` so the frontend can branch on `code`.

export interface FieldIssue {
  path: string;
  message: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  field_issues?: FieldIssue[];
}

export interface HttpProblemInit {
  status: number;
  code: string;
  title: string;
  detail: string;
  fieldIssues?: FieldIssue[];
}

export class HttpProblem extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly fieldIssues?: FieldIssue[];

  constructor(init: HttpProblemInit) {
    super(init.detail);
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.fieldIssues = init.fieldIssues;
  }

  toBody(instance?: string): ProblemBody {
    const body: ProblemBody = {
      type: `https://billpay.local/problems/${this.code
        .toLowerCase()
        .replace(/_/g, "-")}`,
      title: this.title,
      status: this.status,
      detail: this.detail,
      code: this.code,
    };
    if (instance) body.instance = instance;
    if (this.fieldIssues && this.fieldIssues.length > 0) {
      body.field_issues = this.fieldIssues;
    }
    return body;
  }
}

// Convenience factory for the 501 stubs that every route emits in Phase 1.
export function notImplemented(detail: string): HttpProblem {
  return new HttpProblem({
    status: 501,
    code: "NOT_IMPLEMENTED",
    title: "Not implemented",
    detail,
  });
}
