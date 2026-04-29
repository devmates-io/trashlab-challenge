import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useFieldArray, useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type {
  RecurringCadence,
  RecurringTemplateCreateRequest,
  RecurringTemplateDTO,
  RecurringTemplateUpdateRequest,
  VendorDTO,
} from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/bills/date-field";
import { useVendorsList } from "@/hooks/use-vendors";
import {
  useCreateRecurringTemplate,
  useUpdateRecurringTemplate,
} from "@/hooks/use-recurring";

// §6.10.5 — recurring template create/edit form. Reuses the same dollar-
// to-cents convention as bill-form.tsx so users have a single mental
// model for money entry across the app.

function parseDollars(s: string | undefined | null): number {
  if (!s) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

const amountDollarsSchema = z
  .string()
  .min(1, "Required")
  .refine(
    (s) => Number.isFinite(Number(s)) && parseDollars(s) > 0,
    "Must be greater than 0",
  );

const formSchema = z.object({
  name: z.string().min(1, "Required").max(100, "Max 100 characters"),
  vendor_id: z.string().min(1, "Pick a vendor"),
  cadence: z.enum(["monthly", "quarterly", "yearly"]),
  next_run_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date for the next run"),
  line_items: z
    .array(
      z.object({
        description: z.string().min(1, "Required").max(200),
        amount_dollars: amountDollarsSchema,
      }),
    )
    .min(1, "At least one line item"),
});
type FormValues = z.infer<typeof formSchema>;

const CADENCE_LABEL: Record<RecurringCadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function defaultValues(initial?: RecurringTemplateDTO): FormValues {
  if (initial) {
    return {
      name: initial.name,
      vendor_id: initial.vendor_id,
      cadence: initial.cadence,
      next_run_at: initial.next_run_at,
      line_items: initial.line_items.map((li) => ({
        description: li.description,
        amount_dollars: centsToDollars(li.amount_cents),
      })),
    };
  }
  return {
    name: "",
    vendor_id: "",
    cadence: "monthly",
    next_run_at: "",
    line_items: [{ description: "", amount_dollars: "" }],
  };
}

function toCreate(values: FormValues): RecurringTemplateCreateRequest {
  const line_items = values.line_items.map((li) => ({
    description: li.description,
    amount_cents: parseDollars(li.amount_dollars),
  }));
  const amount_cents = line_items.reduce(
    (acc, li) => acc + (Number.isFinite(li.amount_cents) ? li.amount_cents : 0),
    0,
  );
  return {
    name: values.name,
    vendor_id: values.vendor_id,
    amount_cents,
    cadence: values.cadence,
    next_run_at: values.next_run_at,
    line_items,
  };
}

export function RecurringTemplateForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: RecurringTemplateDTO;
}): React.ReactElement {
  const navigate = useNavigate();
  const vendorsQuery = useVendorsList();
  const create = useCreateRecurringTemplate();
  const update = useUpdateRecurringTemplate(initial?.id ?? "");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValues(initial),
    mode: "onBlur",
  });
  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "line_items",
  });
  const liveValues = watch();

  const lineItemsSum = (liveValues.line_items ?? []).reduce((acc, li) => {
    const c = parseDollars(li?.amount_dollars);
    return acc + (Number.isFinite(c) ? c : 0);
  }, 0);

  const vendors: VendorDTO[] = React.useMemo(
    () => (vendorsQuery.data ?? []).filter((v) => v.is_active),
    [vendorsQuery.data],
  );

  const isBusy = isSubmitting || create.isPending || update.isPending;

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    const create_payload = toCreate(values);
    try {
      if (mode === "create") {
        await create.mutateAsync(create_payload);
        toast.success("Recurring template created.");
      } else if (initial) {
        const patch: RecurringTemplateUpdateRequest = create_payload;
        await update.mutateAsync(patch);
        toast.success("Template updated.");
      }
      navigate("/recurring");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail : "Failed to save template.";
      toast.error(msg, { duration: Number.POSITIVE_INFINITY });
    }
  };

  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Template details</h2>
        <div className="grid gap-5">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g. Slack monthly"
              {...register("name")}
              className={cn(errors.name && "border-destructive")}
            />
            {errors.name && (
              <p className="text-sm font-medium text-destructive">
                {errors.name.message as string}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Select
              value={liveValues.vendor_id}
              onValueChange={(v) =>
                setValue("vendor_id", v, { shouldValidate: true })
              }
              disabled={isBusy || vendorsQuery.isLoading}
            >
              <SelectTrigger
                id="vendor"
                className={cn(errors.vendor_id && "border-destructive")}
              >
                <SelectValue
                  placeholder={
                    vendorsQuery.isLoading ? "Loading…" : "Select a vendor"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.vendor_id && (
              <p className="text-sm font-medium text-destructive">
                {errors.vendor_id.message as string}
              </p>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cadence">Cadence</Label>
              <Select
                value={liveValues.cadence}
                onValueChange={(v) =>
                  setValue("cadence", v as RecurringCadence, {
                    shouldValidate: true,
                  })
                }
                disabled={isBusy}
              >
                <SelectTrigger id="cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{CADENCE_LABEL.monthly}</SelectItem>
                  <SelectItem value="quarterly">
                    {CADENCE_LABEL.quarterly}
                  </SelectItem>
                  <SelectItem value="yearly">{CADENCE_LABEL.yearly}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="next_run_at">Next run on</Label>
              <DateField
                id="next_run_at"
                value={liveValues.next_run_at}
                onChange={(iso) =>
                  setValue("next_run_at", iso, { shouldValidate: true })
                }
                disabled={isBusy}
                invalid={Boolean(errors.next_run_at)}
              />
              {errors.next_run_at && (
                <p className="text-sm font-medium text-destructive">
                  {errors.next_run_at.message as string}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Line items</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ description: "", amount_dollars: "" })}
            disabled={isBusy}
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
        </div>
        <div className="space-y-2">
          {fields.map((field, idx) => {
            const descError = errors.line_items?.[idx]?.description;
            const amtError = errors.line_items?.[idx]?.amount_dollars;
            return (
              <div key={field.id} className="grid grid-cols-[1fr_8rem_2.5rem] gap-2">
                <Input
                  placeholder="Description"
                  {...register(`line_items.${idx}.description` as const)}
                  className={cn(descError && "border-destructive")}
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  {...register(`line_items.${idx}.amount_dollars` as const)}
                  className={cn(amtError && "border-destructive")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(idx)}
                  disabled={isBusy || fields.length === 1}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-semibold">
            {formatMoney(lineItemsSum)}
          </span>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => navigate("/recurring")}
          disabled={isBusy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit(onSubmit)}
          disabled={isBusy}
        >
          {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create template" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
