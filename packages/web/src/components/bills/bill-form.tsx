import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useFieldArray, useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import type {
  BillCreateRequest,
  BillPatchRequest,
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
import {
  useCreateBill,
  useDeleteBill,
  useSubmitBillById,
  useUpdateBill,
  useUploadAttachment,
  type BillDetailDTO,
  type UploadResponseDTO,
} from "@/hooks/use-bills";
import { useVendorsList } from "@/hooks/use-vendors";
import { DateField } from "@/components/bills/date-field";
import { DeleteDraftModal } from "@/components/bills/delete-draft-modal";

// ---------------------------------------------------------------------------
// Form-local zod schema. Money is handled as dollar strings in the form and
// converted to integer cents on submit (§6.5.4). We use superRefine to mirror
// the spec constraints: due_date >= issue_date; sum(line_items) == total.
// ---------------------------------------------------------------------------

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

const billFormSchema = z
  .object({
    vendor_id: z.string().min(1, "Pick a vendor"),
    invoice_number: z
      .string()
      .min(1, "Required")
      .max(50, "Max 50 characters"),
    issue_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an issue date"),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date"),
    line_items: z
      .array(
        z.object({
          description: z
            .string()
            .min(1, "Required")
            .max(200, "Max 200 characters"),
          amount_dollars: amountDollarsSchema,
        }),
      )
      .min(1, "At least one line item"),
    amount_dollars: amountDollarsSchema,
    attachment_id: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.issue_date && val.due_date && val.due_date < val.issue_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["due_date"],
        message: "Must be on or after the issue date",
      });
    }
    const lineSum = val.line_items.reduce((acc, li) => {
      const c = parseDollars(li.amount_dollars);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
    const total = parseDollars(val.amount_dollars);
    if (Number.isFinite(total) && total > 0 && total !== lineSum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount_dollars"],
        message: `Line items sum to ${formatMoney(lineSum)}; total is ${formatMoney(total)}`,
      });
    }
  });

type BillFormValues = z.infer<typeof billFormSchema>;

// Used by the New Bill page when the URL has ?vendor_id=...
function defaultValues(initial?: BillDetailDTO, vendorIdHint?: string): BillFormValues {
  if (initial) {
    return {
      vendor_id: initial.vendor_id,
      invoice_number: initial.invoice_number,
      issue_date: initial.issue_date,
      due_date: initial.due_date,
      line_items: initial.line_items.map((li) => ({
        description: li.description,
        amount_dollars: centsToDollars(li.amount_cents),
      })),
      amount_dollars: centsToDollars(initial.amount_cents),
      attachment_id: initial.attachment?.id ?? null,
    };
  }
  return {
    vendor_id: vendorIdHint ?? "",
    invoice_number: "",
    issue_date: "",
    due_date: "",
    line_items: [{ description: "", amount_dollars: "" }],
    amount_dollars: "",
    attachment_id: null,
  };
}

// Map the form values to a BillCreateRequest payload (server-side zod schema).
function toRequest(values: BillFormValues): BillCreateRequest {
  return {
    vendor_id: values.vendor_id,
    invoice_number: values.invoice_number,
    amount_cents: parseDollars(values.amount_dollars),
    issue_date: values.issue_date,
    due_date: values.due_date,
    line_items: values.line_items.map((li) => ({
      description: li.description,
      amount_cents: parseDollars(li.amount_dollars),
    })),
    attachment_id: values.attachment_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Attachment upload sub-component
// ---------------------------------------------------------------------------

const ACCEPTED_MIME = "application/pdf,image/png,image/jpeg";

type UploadedState = {
  attachment_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
};

function AttachmentInput({
  initial,
  value,
  onChange,
  disabled,
}: {
  initial: BillDetailDTO["attachment"] | null | undefined;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const upload = useUploadAttachment();
  const [uploaded, setUploaded] = React.useState<UploadedState | null>(() => {
    if (initial && initial.id === value) {
      return {
        attachment_id: initial.id,
        original_filename: initial.original_filename,
        mime_type: initial.mime_type,
        size_bytes: initial.size_bytes,
      };
    }
    return null;
  });
  const inputRef = React.useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    upload.mutate(file, {
      onSuccess: (res: UploadResponseDTO) => {
        setUploaded({
          attachment_id: res.attachment_id,
          original_filename: res.original_filename,
          mime_type: res.mime_type,
          size_bytes: res.size_bytes,
        });
        onChange(res.attachment_id);
      },
      onError: (err) => {
        const msg =
          err instanceof ApiError
            ? err.detail
            : "Upload failed. Please try again.";
        toast.error(msg);
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  }

  function clear() {
    setUploaded(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (uploaded) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {uploaded.original_filename}
          </p>
          <p className="text-xs text-muted-foreground">
            {uploaded.mime_type} · {(uploaded.size_bytes / 1024).toFixed(0)} KB
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clear}
          disabled={disabled}
        >
          <X className="mr-1 h-4 w-4" /> Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME}
        disabled={disabled || upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <p className="text-xs text-muted-foreground">
        PDF, PNG, or JPEG. Max 10 MB.
      </p>
      {upload.isPending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BillForm
// ---------------------------------------------------------------------------

export interface BillFormProps {
  mode: "create" | "edit";
  initial?: BillDetailDTO;
  vendorIdHint?: string;
}

export function BillForm({
  mode,
  initial,
  vendorIdHint,
}: BillFormProps): React.ReactElement {
  const navigate = useNavigate();
  const vendorsQuery = useVendorsList();
  const createBill = useCreateBill();
  const updateBill = useUpdateBill(initial?.id ?? "");
  const submitBill = useSubmitBillById();
  const deleteBill = useDeleteBill();

  const form = useForm<BillFormValues>({
    resolver: zodResolver(billFormSchema),
    defaultValues: defaultValues(initial, vendorIdHint),
    mode: "onBlur",
  });
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "line_items",
  });

  const liveValues = watch();
  const lineItemsSum = React.useMemo(() => {
    return (liveValues.line_items ?? []).reduce((acc, li) => {
      const c = parseDollars(li?.amount_dollars);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
  }, [liveValues.line_items]);
  const totalCents = parseDollars(liveValues.amount_dollars);
  const mismatch =
    Number.isFinite(totalCents) &&
    totalCents > 0 &&
    totalCents !== lineItemsSum;

  // Map API field_issues back onto form fields (react-hook-form setError).
  function applyApiFieldIssues(err: unknown) {
    if (!(err instanceof ApiError)) return false;
    if (err.fieldIssues.length === 0) return false;
    for (const issue of err.fieldIssues) {
      // Map server "line_items.0.amount_cents" → our "line_items.0.amount_dollars".
      const path = issue.path
        .replace(/\.amount_cents\b/g, ".amount_dollars")
        .replace(/^amount_cents$/, "amount_dollars");
      setError(path as never, { type: "server", message: issue.message });
    }
    return true;
  }

  const onSaveDraft: SubmitHandler<BillFormValues> = async (values) => {
    const body = toRequest(values);
    try {
      if (mode === "create") {
        const bill = await createBill.mutateAsync(body);
        toast.success("Draft saved.");
        navigate(`/bills/${bill.id}`);
      } else if (initial) {
        await updateBill.mutateAsync(body as BillPatchRequest);
        toast.success("Draft saved.");
        navigate(`/bills/${initial.id}`);
      }
    } catch (err) {
      if (!applyApiFieldIssues(err)) {
        const msg =
          err instanceof ApiError
            ? err.detail
            : "Failed to save draft.";
        toast.error(msg, { duration: Infinity });
      }
    }
  };

  const onSaveAndSubmit: SubmitHandler<BillFormValues> = async (values) => {
    const body = toRequest(values);
    try {
      let billId: string;
      if (mode === "create") {
        const bill = await createBill.mutateAsync(body);
        billId = bill.id;
      } else if (initial) {
        const bill = await updateBill.mutateAsync(body as BillPatchRequest);
        billId = bill.id;
      } else {
        return;
      }
      await submitBill.mutateAsync(billId);
      toast.success("Bill submitted for approval.");
      navigate(`/bills/${billId}`);
    } catch (err) {
      if (!applyApiFieldIssues(err)) {
        const msg =
          err instanceof ApiError
            ? err.detail
            : "Failed to save and submit.";
        toast.error(msg, { duration: Infinity });
      }
    }
  };

  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const vendors: VendorDTO[] = React.useMemo(() => {
    const list = vendorsQuery.data ?? [];
    return list.filter((v) => v.is_active);
  }, [vendorsQuery.data]);

  const isBusy =
    isSubmitting ||
    createBill.isPending ||
    updateBill.isPending ||
    submitBill.isPending;

  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Bill details</h2>

        <div className="grid gap-5">
          {/* Vendor */}
          <div className="space-y-2">
            <Label htmlFor="vendor">Vendor</Label>
            <Select
              value={liveValues.vendor_id ?? ""}
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
                    vendorsQuery.isLoading ? "Loading vendors…" : "Select a vendor"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    <span className="flex items-center gap-2">
                      <span>{v.name}</span>
                      <span className="text-xs uppercase text-muted-foreground">
                        {v.payment_method}
                      </span>
                    </span>
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

          {/* Invoice number */}
          <div className="space-y-2">
            <Label htmlFor="invoice_number">Invoice number</Label>
            <Input
              id="invoice_number"
              maxLength={50}
              {...register("invoice_number")}
              className={cn(errors.invoice_number && "border-destructive")}
              disabled={isBusy}
            />
            {errors.invoice_number && (
              <p className="text-sm font-medium text-destructive">
                {errors.invoice_number.message as string}
              </p>
            )}
          </div>

          {/* Issue + due dates */}
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="issue_date">Issue date</Label>
              <DateField
                id="issue_date"
                value={liveValues.issue_date}
                onChange={(iso) =>
                  setValue("issue_date", iso, { shouldValidate: true })
                }
                disabled={isBusy}
                invalid={!!errors.issue_date}
              />
              {errors.issue_date && (
                <p className="text-sm font-medium text-destructive">
                  {errors.issue_date.message as string}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_date">Due date</Label>
              <DateField
                id="due_date"
                value={liveValues.due_date}
                onChange={(iso) =>
                  setValue("due_date", iso, { shouldValidate: true })
                }
                disabled={isBusy}
                invalid={!!errors.due_date}
              />
              {errors.due_date && (
                <p className="text-sm font-medium text-destructive">
                  {errors.due_date.message as string}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Line items */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Line items</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => append({ description: "", amount_dollars: "" })}
          >
            <Plus className="mr-1 h-4 w-4" /> Add line
          </Button>
        </div>

        <div className="space-y-3">
          {fields.map((f, i) => {
            const liErr = errors.line_items?.[i];
            return (
              <div key={f.id} className="grid grid-cols-[1fr_170px_auto] gap-3">
                <div>
                  <Input
                    placeholder="Description"
                    {...register(`line_items.${i}.description` as const)}
                    disabled={isBusy}
                    className={cn(liErr?.description && "border-destructive")}
                  />
                  {liErr?.description && (
                    <p className="mt-1 text-xs font-medium text-destructive">
                      {liErr.description.message as string}
                    </p>
                  )}
                </div>
                <div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      className={cn(
                        "pl-7",
                        liErr?.amount_dollars && "border-destructive",
                      )}
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register(`line_items.${i}.amount_dollars` as const)}
                      disabled={isBusy}
                    />
                  </div>
                  {liErr?.amount_dollars && (
                    <p className="mt-1 text-xs font-medium text-destructive">
                      {liErr.amount_dollars.message as string}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  disabled={isBusy || fields.length <= 1}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {errors.line_items?.root && (
            <p className="text-sm font-medium text-destructive">
              {errors.line_items.root.message as string}
            </p>
          )}
          {errors.line_items && !errors.line_items.root && typeof errors.line_items.message === "string" && (
            <p className="text-sm font-medium text-destructive">
              {errors.line_items.message}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Total:</span>
          <span className="font-semibold">{formatMoney(lineItemsSum)}</span>
        </div>
      </section>

      {/* Total + attachment */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="grid gap-5">
          <div className="space-y-2">
            <Label htmlFor="amount_dollars">Total amount</Label>
            <div className="relative max-w-[260px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="amount_dollars"
                inputMode="decimal"
                placeholder="0.00"
                {...register("amount_dollars")}
                disabled={isBusy}
                className={cn(
                  "pl-7",
                  (errors.amount_dollars || mismatch) && "border-destructive",
                )}
              />
            </div>
            {errors.amount_dollars ? (
              <p className="text-sm font-medium text-destructive">
                {errors.amount_dollars.message as string}
              </p>
            ) : mismatch ? (
              <p className="text-sm font-medium text-destructive">
                Line items sum to {formatMoney(lineItemsSum)}; total is{" "}
                {formatMoney(totalCents)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Invoice file</Label>
            <AttachmentInput
              initial={initial?.attachment}
              value={liveValues.attachment_id}
              onChange={(id) =>
                setValue("attachment_id", id, { shouldDirty: true })
              }
              disabled={isBusy}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <div>
          {mode === "edit" && initial && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              disabled={isBusy}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete draft
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              mode === "create"
                ? navigate("/bills")
                : initial
                  ? navigate(`/bills/${initial.id}`)
                  : navigate(-1)
            }
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSubmit(onSaveDraft)}
            disabled={isBusy}
          >
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save draft
          </Button>
          <Button
            type="button"
            onClick={handleSubmit(onSaveAndSubmit)}
            disabled={isBusy}
          >
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save and submit for approval
          </Button>
        </div>
      </div>

      {mode === "edit" && initial && (
        <DeleteDraftModal
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          pending={deleteBill.isPending}
          onConfirm={async () => {
            try {
              await deleteBill.mutateAsync(initial.id);
              toast.success("Draft deleted.");
              navigate("/bills");
            } catch (err) {
              const msg =
                err instanceof ApiError
                  ? err.detail
                  : "Failed to delete draft.";
              toast.error(msg, { duration: Infinity });
            }
          }}
        />
      )}
    </form>
  );
}
