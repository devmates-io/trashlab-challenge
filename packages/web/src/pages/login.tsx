import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { loginRequestSchema, type LoginRequest } from "@bill-pay/shared";
import { ApiError, getSessionToken } from "@/lib/api";
import { useLogin } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// Demo users seeded in packages/api/prisma/seed.ts (§6.8.2). Listed here so
// reviewers can sign in without consulting the seed source. All four share
// the same password (demo1234) — a deliberate choice for the walkthrough.
const DEMO_CREDENTIALS = [
  { email: "alice@acmewidgets.demo", role: "Submitter" },
  { email: "bob@acmewidgets.demo", role: "Approver L1" },
  { email: "carol@acmewidgets.demo", role: "Approver L2" },
  { email: "dana@acmewidgets.demo", role: "Admin" },
] as const;

const DEMO_PASSWORD = "demo1234";

export default function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const login = useLogin();

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  // Server-side login error (INVALID_CREDENTIALS = 401). Held here rather
  // than as a toast so the message sits inline near the form, which is
  // both less startling than a corner toast and easier to find on a page
  // that's just two fields.
  const [serverError, setServerError] = React.useState<string | null>(null);

  // If a token is already present, this page should never be visible —
  // bounce straight to the dashboard. Avoids the awkward case where a
  // logged-in user navigates to /login by hand. Returning Navigate after
  // the hooks above keeps the hooks order stable across renders.
  if (getSessionToken() !== null) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(values: LoginRequest) {
    setServerError(null);
    try {
      await login.mutateAsync(values);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "INVALID_CREDENTIALS") {
          setServerError("Incorrect email or password.");
          return;
        }
        setServerError(err.detail);
        return;
      }
      setServerError("Something went wrong. Please try again.");
    }
  }

  function fillDemo(email: string) {
    form.setValue("email", email, { shouldValidate: true, shouldDirty: true });
    form.setValue("password", DEMO_PASSWORD, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setServerError(null);
  }

  const isSubmitting = login.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Bill Pay</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage vendors, bills, and approvals.
          </p>
        </div>

        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use your team email and password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-5"
                noValidate
              >
                <fieldset disabled={isSubmitting} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {serverError && (
                    <div
                      role="alert"
                      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive"
                    >
                      {serverError}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>
                </fieldset>
              </form>
            </Form>
          </CardContent>
        </Card>

        <DemoCredentialsPanel onFill={fillDemo} />
      </div>
    </div>
  );
}

function DemoCredentialsPanel({
  onFill,
}: {
  onFill: (email: string) => void;
}) {
  return (
    <Card className="border-dashed bg-card/60">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-base">Demo credentials</CardTitle>
        <CardDescription>
          All seeded users share the password{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
            {DEMO_PASSWORD}
          </code>
          . Click an entry to autofill.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y rounded-md border">
          {DEMO_CREDENTIALS.map((u) => (
            <li key={u.email}>
              <button
                type="button"
                onClick={() => onFill(u.email)}
                className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="font-mono text-xs sm:text-sm">{u.email}</span>
                <span className="text-xs text-muted-foreground">{u.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
