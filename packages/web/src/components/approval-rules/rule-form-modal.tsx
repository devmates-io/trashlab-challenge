import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import type { UserDTO } from "@bill-pay/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, type FieldIssue } from "@/lib/api";
import {
  useCreateApprovalRule,
  usePatchApprovalRule,
  useUsersForRules,
  type ApprovalRuleListItem,
} from "@/hooks/use-approval-rules";
import { RulePreview } from "@/components/approval-rules/rule-preview";
import {
  toastApiError,
  toastSuccess,
} from "@/components/approval-rules/shared";

// Form shape — UI uses whole-dollar input for threshold; we convert to cents
// on submit. Approver list is only the non-admin picks; admins are always
// eligible via override (§6.4.3 / §6.6.9).
const ruleFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Max 100 chars"),
  min_amount_dollars: z.coerce
    .number({ invalid_type_error: "Must be a number" })
    .int("Must be a whole dollar amount")
    .min(0, "Must be $0 or more"),
  approver_user_ids: z
    .array(z.string())
    .min(1, "Select at least one approver"),
});
type RuleFormValues = z.infer<typeof ruleFormSchema>;

export type RuleFormMode =
  | { kind: "create" }
  | { kind: "edit"; rule: ApprovalRuleListItem };

export function RuleFormModal({
  open,
  mode,
  onOpenChange,
}: {
  open: boolean;
  mode: RuleFormMode | null;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  // Controlled-open Dialog: when mode is null the parent will pass open=false.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {mode ? (
          <RuleFormBody mode={mode} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RuleFormBody({
  mode,
  onClose,
}: {
  mode: RuleFormMode;
  onClose: () => void;
}): React.ReactElement {
  const usersQuery = useUsersForRules();
  const candidateApprovers = React.useMemo<UserDTO[]>(() => {
    const users = usersQuery.data ?? [];
    // §6.6.9: the approver checklist shows users with role "approver" only —
    // admins are always eligible and hidden to avoid confusion.
    return users.filter((u) => u.role === "approver" && u.is_active);
  }, [usersQuery.data]);

  const create = useCreateApprovalRule();
  const patch = usePatchApprovalRule();

  const defaultValues = React.useMemo<RuleFormValues>(() => {
    if (mode.kind === "edit") {
      return {
        name: mode.rule.name,
        min_amount_dollars: Math.floor(mode.rule.min_amount_cents / 100),
        approver_user_ids: [...mode.rule.approver_user_ids],
      };
    }
    return { name: "", min_amount_dollars: 0, approver_user_ids: [] };
  }, [mode]);

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues,
  });

  // Reset when switching between create/edit modes while the dialog stays
  // mounted (we unmount in the parent anyway, but belt-and-suspenders).
  React.useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const isSubmitting = create.isPending || patch.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name.trim(),
      min_amount_cents: values.min_amount_dollars * 100,
      approver_user_ids: values.approver_user_ids,
    };
    try {
      if (mode.kind === "create") {
        await create.mutateAsync(body);
      } else {
        await patch.mutateAsync({ id: mode.rule.id, body });
      }
      toastSuccess("Rule saved.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldIssues.length > 0) {
        applyFieldIssues(form, err.fieldIssues);
      }
      toastApiError(err);
    }
  });

  const watched = form.watch();
  const watchedMinCents = (watched.min_amount_dollars || 0) * 100;
  const watchedIds = watched.approver_user_ids;

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "create" ? "New approval rule" : "Edit approval rule"}
          </DialogTitle>
          <DialogDescription>
            Rules apply to new submissions only. In-flight bills keep their
            original approvers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. Bills ≥ $10,000"
                    {...field}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="min_amount_dollars"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount threshold (bills &ge; this)</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      className="pl-7"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="approver_user_ids"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Approvers</FormLabel>
                <FormControl>
                  <ApproverChecklist
                    users={candidateApprovers}
                    loading={usersQuery.isLoading}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <RulePreview
          minAmountCents={watchedMinCents}
          approverUserIds={watchedIds}
          candidateApprovers={candidateApprovers}
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function ApproverChecklist({
  users,
  loading,
  value,
  onChange,
  disabled,
}: {
  users: UserDTO[];
  loading: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="space-y-2 rounded-md border p-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-32" />
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        No active approvers in the system.
      </p>
    );
  }
  const selected = new Set(value);
  return (
    <ul className="space-y-2 rounded-md border p-3">
      {users.map((u) => {
        const isChecked = selected.has(u.id);
        const toggle = (checked: boolean) => {
          if (checked) {
            onChange([...value, u.id]);
          } else {
            onChange(value.filter((id) => id !== u.id));
          }
        };
        return (
          <li key={u.id} className="flex items-center gap-3">
            <Checkbox
              id={`approver-${u.id}`}
              checked={isChecked}
              onCheckedChange={(v) => toggle(v === true)}
              disabled={disabled}
            />
            <label
              htmlFor={`approver-${u.id}`}
              className="flex w-full cursor-pointer items-center justify-between text-sm"
            >
              <span>{u.name}</span>
              <span className="text-xs text-muted-foreground">
                limit ${(u.max_approval_amount_cents / 100).toLocaleString()}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// Map RFC 7807 field_issues back to form fields. Supports both `name` and
// `min_amount_cents` API paths; the latter is remapped to min_amount_dollars.
function applyFieldIssues(
  form: ReturnType<typeof useForm<RuleFormValues>>,
  issues: FieldIssue[],
): void {
  for (const issue of issues) {
    const path = issue.path.replace(/^\//, "").split("/")[0] ?? issue.path;
    switch (path) {
      case "name":
        form.setError("name", { message: issue.message });
        break;
      case "min_amount_cents":
      case "min_amount_dollars":
        form.setError("min_amount_dollars", { message: issue.message });
        break;
      case "approver_user_ids":
        form.setError("approver_user_ids", { message: issue.message });
        break;
      default:
        break;
    }
  }
}
