import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import {
  USER_ROLE_VALUES,
  type CreateUserRequest,
  type SelfUpdateRequest,
  type UpdateUserRequest,
  type UserDTO,
  type UserRole,
} from "@bill-pay/shared";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastApiError } from "@/components/vendors/shared";

// ---------------------------------------------------------------------------
// Form-local zod schema. Two ergonomic translations from the API contract:
//  - `password` is always a string in the form (we use "" to mean "no change"
//    in edit mode); converted to omit-from-body in the submit helpers.
//  - `max_approval_amount_cents` is presented to admins as a whole-dollar
//    string field with a "$" prefix; converted to integer cents on submit
//    (mirrors the approval-rules form pattern in §6.6.9).
// ---------------------------------------------------------------------------

// Generous ceiling — well beyond any realistic SMB approval limit, picked to
// catch obvious typos like an extra zero rather than to enforce policy.
const MAX_APPROVAL_DOLLARS = 1_000_000_000;

const dollarStringSchema = z
  .string()
  .min(1, "Required")
  .refine(
    (s) => {
      const n = Number(s);
      return (
        Number.isFinite(n) &&
        Number.isInteger(n) &&
        n >= 0 &&
        n <= MAX_APPROVAL_DOLLARS
      );
    },
    "Must be a whole-dollar amount of $0 or more",
  );

const ROLE_LABEL: Record<UserRole, string> = {
  submitter: "Submitter",
  approver: "Approver",
  admin: "Admin",
};

// Mode informs *only* the password rule. Field visibility is gated by
// `canEditAllFields` which is independent (an admin editing themselves still
// sees all fields with `canEditAllFields=true`, just with the active switch
// disabled).
type SchemaMode = "create" | "edit";

function buildSchema(mode: SchemaMode) {
  const passwordCreate = z
    .string()
    .min(8, "Must be at least 8 characters")
    .max(200, "Max 200 characters");
  // Edit mode: empty string == "keep existing"; a non-empty string is held
  // to the same min/max as create.
  const passwordEdit = z.union([
    z.literal(""),
    z
      .string()
      .min(8, "Must be at least 8 characters")
      .max(200, "Max 200 characters"),
  ]);
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, "Required")
      .max(100, "Max 100 characters"),
    email: z
      .string()
      .trim()
      .min(1, "Required")
      .email("Must be a valid email"),
    password: mode === "create" ? passwordCreate : passwordEdit,
    role: z.enum(USER_ROLE_VALUES),
    max_approval_dollars: dollarStringSchema,
    is_active: z.boolean(),
  });
}

export type UserFormValues = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  max_approval_dollars: string;
  is_active: boolean;
};

function dollarsToCents(s: string): number {
  // Schema guarantees the string is a non-negative integer.
  return Math.round(Number(s)) * 100;
}

function centsToDollarsString(cents: number): string {
  return Math.floor(cents / 100).toString();
}

function defaultsForCreate(): UserFormValues {
  return {
    name: "",
    email: "",
    password: "",
    role: "submitter",
    max_approval_dollars: "0",
    is_active: true,
  };
}

function valuesFromUser(user: UserDTO): UserFormValues {
  return {
    name: user.name,
    email: user.email,
    password: "",
    role: user.role,
    max_approval_dollars: centsToDollarsString(user.max_approval_amount_cents),
    is_active: user.is_active,
  };
}

// ---- API body builders (exported so pages can convert + dispatch) ----

export function toCreateUserRequest(values: UserFormValues): CreateUserRequest {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    password: values.password,
    role: values.role,
    max_approval_amount_cents: dollarsToCents(values.max_approval_dollars),
    is_active: values.is_active,
  };
}

// Admin editing any user: send all editable fields. `password` is omitted
// when blank so the existing bcrypt hash is preserved (§6.5.4).
export function toAdminUpdateRequest(values: UserFormValues): UpdateUserRequest {
  const body: UpdateUserRequest = {
    name: values.name.trim(),
    email: values.email.trim(),
    role: values.role,
    max_approval_amount_cents: dollarsToCents(values.max_approval_dollars),
    is_active: values.is_active,
  };
  if (values.password.length > 0) body.password = values.password;
  return body;
}

// Non-admin editing themselves: restricted shape. Server rejects role /
// limit / is_active in this surface for privilege-escalation prevention.
export function toSelfUpdateRequest(values: UserFormValues): SelfUpdateRequest {
  const body: SelfUpdateRequest = {
    name: values.name.trim(),
    email: values.email.trim(),
  };
  if (values.password.length > 0) body.password = values.password;
  return body;
}

// ---- Component ----

export type UserFormProps =
  | {
      mode: "create";
      isSubmitting: boolean;
      onSubmit: (values: UserFormValues) => Promise<void> | void;
      onCancel: () => void;
    }
  | {
      mode: "edit";
      user: UserDTO;
      // True when the current actor is an admin (whether editing themselves
      // or someone else). When false, the form hides role / limit / active.
      canEditAllFields: boolean;
      // True iff the user being edited *is* the current logged-in user.
      // Drives the "active" switch disable so admins can't accidentally
      // deactivate themselves through the form.
      isSelfEdit: boolean;
      isSubmitting: boolean;
      onSubmit: (values: UserFormValues) => Promise<void> | void;
      onCancel: () => void;
    };

export function UserForm(props: UserFormProps): React.ReactElement {
  const isEdit = props.mode === "edit";
  const canEditAllFields = props.mode === "edit" ? props.canEditAllFields : true;
  const isSelfEdit = props.mode === "edit" ? props.isSelfEdit : false;

  // Memoize so resolver identity is stable across renders (avoids
  // unnecessary re-validation churn).
  const schema = React.useMemo(
    () => buildSchema(props.mode),
    [props.mode],
  );

  const initial: UserFormValues =
    props.mode === "edit" ? valuesFromUser(props.user) : defaultsForCreate();

  const form = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  async function handleValid(values: UserFormValues) {
    try {
      await props.onSubmit(values);
    } catch (err) {
      // §6.5 — 409 EMAIL_TAKEN is the dominant inline-surfaced error for this
      // form. Show as a field-level error (per spec) and skip the toast so
      // the user isn't double-notified.
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
        form.setError("email", {
          type: "server",
          message: err.detail || "This email is already in use.",
        });
        return;
      }
      // Validation errors with field paths (rare for this form, but possible
      // if the API tightens password / email rules) are projected to the
      // matching form fields too.
      if (err instanceof ApiError && err.fieldIssues.length > 0) {
        for (const issue of err.fieldIssues) {
          const path = issue.path
            .replace(/^\//, "")
            .replaceAll("/", ".");
          form.setError(path as never, {
            type: "server",
            message: issue.message,
          });
        }
      }
      toastApiError(err);
    }
  }

  const submitLabel = props.mode === "create" ? "Create user" : "Save changes";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleValid)} className="space-y-8">
        <fieldset disabled={props.isSubmitting} className="space-y-8">
          <section className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold">Profile</h2>
              <p className="text-sm text-muted-foreground">
                Identity and login credentials for this user.
              </p>
            </div>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={100}
                      placeholder="Alice Anderson"
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                      placeholder="alice@example.com"
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
                  <FormLabel>
                    {isEdit ? "New password" : "Password"}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        isEdit ? "••••••••" : "At least 8 characters"
                      }
                      {...field}
                    />
                  </FormControl>
                  {isEdit && (
                    <FormDescription>
                      Leave blank to keep current password.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {canEditAllFields && (
            <section className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
              <div>
                <h2 className="text-lg font-semibold">Permissions</h2>
                <p className="text-sm text-muted-foreground">
                  Role drives admin override; the approval limit caps the
                  bill amount this user can sign off on without one.
                </p>
              </div>
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={props.isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {USER_ROLE_VALUES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="max_approval_dollars"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Approval limit</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          className="pl-7"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Whole-dollar maximum bill amount this user can approve.
                      Use $0 to revoke approval authority.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex items-start justify-between gap-4 rounded-md border p-4">
                    <div className="space-y-1">
                      <FormLabel className="text-base">Active</FormLabel>
                      <FormDescription>
                        Inactive users cannot log in or be assigned to new
                        approvals.
                        {isEdit && isSelfEdit && (
                          <> You cannot deactivate yourself.</>
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isEdit && isSelfEdit}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </section>
          )}
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={props.isSubmitting}>
            {props.isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              submitLabel
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={props.onCancel}
            disabled={props.isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
