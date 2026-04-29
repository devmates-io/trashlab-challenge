import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useFieldArray, useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type {
  BillCreateRequest,
  BillExtractResponse,
  BillPatchRequest,
  PossibleDuplicateMatch,
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
  useExtractInvoice,
  useSubmitBillById,
  useUpdateBill,
  useUploadAttachment,
  type BillDetailDTO,
  type UploadResponseDTO,
} from "@/hooks/use-bills";
import { useVendorsList } from "@/hooks/use-vendors";
import { DateField } from "@/components/bills/date-field";
import { DeleteDraftModal } from "@/components/bills/delete-draft-modal";
import { DuplicateBillDialog } from "@/components/bills/duplicate-bill-dialog";

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
      attachment_id: initial.attachment?.id ?? null,
    };
  }
  return {
    vendor_id: vendorIdHint ?? "",
    invoice_number: "",
    issue_date: "",
    due_date: "",
    line_items: [{ description: "", amount_dollars: "" }],
    attachment_id: null,
  };
}

// Map the form values to a BillCreateRequest payload (server-side zod schema).
// `amount_cents` is derived from the line-items sum — the bill's total is
// always exactly the sum of its line items; the UI no longer asks the user
// to re-enter it.
function toRequest(values: BillFormValues): BillCreateRequest {
  const line_items = values.line_items.map((li) => ({
    description: li.description,
    amount_cents: parseDollars(li.amount_dollars),
  }));
  const amount_cents = line_items.reduce(
    (acc, li) => acc + (Number.isFinite(li.amount_cents) ? li.amount_cents : 0),
    0,
  );
  return {
    vendor_id: values.vendor_id,
    invoice_number: values.invoice_number,
    amount_cents,
    issue_date: values.issue_date,
    due_date: values.due_date,
    line_items,
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
  onExtract,
  disabled,
  isExtracting,
}: {
  initial: BillDetailDTO["attachment"] | null | undefined;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  // §6.10.1 — invoked when the user clicks "Extract from invoice". The
  // parent form runs the LLM call and applies the suggested fields. Passing
  // the attachment id (not the file) means the server reads from disk and
  // every extraction is idempotent against the same upload.
  onExtract: (attachmentId: string) => void;
  disabled?: boolean;
  isExtracting: boolean;
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {uploaded.original_filename}
            </p>
            <p className="text-xs text-muted-foreground">
              {uploaded.mime_type} · {(uploaded.size_bytes / 1024).toFixed(0)} KB
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onExtract(uploaded.attachment_id)}
              disabled={disabled || isExtracting}
              title="Use AI to extract the invoice fields automatically"
            >
              {isExtracting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              {isExtracting ? "Extracting…" : "Extract from invoice"}
            </Button>
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
        </div>
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
        PDF, PNG, or JPEG. Max 10 MB. After uploading, click{" "}
        <span className="font-medium">Extract from invoice</span> to auto-fill
        the form.
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
  const extractInvoice = useExtractInvoice();

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
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "line_items",
  });

  const liveValues = watch();
  // react-hook-form's `watch()` doesn't reliably re-render on nested
  // useFieldArray edits (only on append/remove), so we recompute the
  // visible sum explicitly on blur of any amount input and whenever the
  // array shape changes. This sum is now the authoritative bill total.
  const computeLineItemsSum = React.useCallback(() => {
    return (getValues("line_items") ?? []).reduce((acc, li) => {
      const c = parseDollars(li?.amount_dollars);
      return acc + (Number.isFinite(c) ? c : 0);
    }, 0);
  }, [getValues]);
  const [lineItemsSum, setLineItemsSum] = React.useState<number>(() =>
    computeLineItemsSum(),
  );
  const refreshLineItemsSum = React.useCallback(() => {
    setLineItemsSum(computeLineItemsSum());
  }, [computeLineItemsSum]);
  // Keep the sum in sync when rows are added/removed or when initial data loads.
  React.useEffect(() => {
    refreshLineItemsSum();
  }, [fields.length, refreshLineItemsSum]);

  // Map API field_issues back onto form fields (react-hook-form setError).
  // The server speaks `line_items.N.amount_cents`; the form field is
  // `line_items.N.amount_dollars`.
  function applyApiFieldIssues(err: unknown) {
    if (!(err instanceof ApiError)) return false;
    if (err.fieldIssues.length === 0) return false;
    for (const issue of err.fieldIssues) {
      const path = issue.path.replace(
        /\.amount_cents\b/g,
        ".amount_dollars",
      );
      setError(path as never, { type: "server", message: issue.message });
    }
    return true;
  }

  // §6.10.3 — duplicate-confirmation state. When a save call returns 409
  // POSSIBLE_DUPLICATE, we stash the request body and the user's intent
  // ("save and submit" vs "save draft") so a confirm-anyway click can
  // replay the exact same flow with `force=true`.
  type PendingSave = {
    body: BillCreateRequest;
    submitAfter: boolean;
  };
  const [duplicateState, setDuplicateState] = React.useState<{
    matches: PossibleDuplicateMatch[];
    pending: PendingSave;
  } | null>(null);

  // Pulls the `matches` array out of the 409 problem document. Returns
  // null when the error isn't a duplicate signal.
  function extractDuplicateMatches(err: unknown): PossibleDuplicateMatch[] | null {
    if (!(err instanceof ApiError) || err.code !== "POSSIBLE_DUPLICATE") {
      return null;
    }
    const raw = err.body?.matches;
    if (!Array.isArray(raw)) return null;
    return raw as PossibleDuplicateMatch[];
  }

  // Shared post-save flow: optionally chain a /submit, navigate, toast.
  async function afterCreate(billId: string, submitAfter: boolean) {
    if (submitAfter) {
      await submitBill.mutateAsync(billId);
      toast.success("Bill submitted for approval.");
    } else {
      toast.success("Draft saved.");
    }
    navigate(`/bills/${billId}`);
  }

  async function performCreate(body: BillCreateRequest, submitAfter: boolean, force = false) {
    try {
      const bill = await createBill.mutateAsync({ body, force });
      await afterCreate(bill.id, submitAfter);
    } catch (err) {
      const dupes = extractDuplicateMatches(err);
      if (dupes && dupes.length > 0) {
        setDuplicateState({ matches: dupes, pending: { body, submitAfter } });
        return;
      }
      if (!applyApiFieldIssues(err)) {
        const msg =
          err instanceof ApiError
            ? err.detail
            : submitAfter
              ? "Failed to save and submit."
              : "Failed to save draft.";
        toast.error(msg, { duration: Infinity });
      }
    }
  }

  async function performEdit(billId: string, body: BillPatchRequest, submitAfter: boolean) {
    try {
      await updateBill.mutateAsync(body);
      if (submitAfter) {
        await submitBill.mutateAsync(billId);
        toast.success("Bill submitted for approval.");
      } else {
        toast.success("Draft saved.");
      }
      navigate(`/bills/${billId}`);
    } catch (err) {
      if (!applyApiFieldIssues(err)) {
        const msg =
          err instanceof ApiError
            ? err.detail
            : submitAfter
              ? "Failed to save and submit."
              : "Failed to save draft.";
        toast.error(msg, { duration: Infinity });
      }
    }
  }

  const onSaveDraft: SubmitHandler<BillFormValues> = async (values) => {
    const body = toRequest(values);
    if (mode === "create") {
      await performCreate(body, false);
    } else if (initial) {
      await performEdit(initial.id, body as BillPatchRequest, false);
    }
  };

  const onSaveAndSubmit: SubmitHandler<BillFormValues> = async (values) => {
    const body = toRequest(values);
    if (mode === "create") {
      await performCreate(body, true);
    } else if (initial) {
      await performEdit(initial.id, body as BillPatchRequest, true);
    }
  };

  // Replay the original create with `force=true` after the user confirms
  // they want to create despite duplicates. We close the dialog optimistically
  // — if the second call fails, the inline toast surface fires.
  async function confirmDuplicateAnyway() {
    if (!duplicateState) return;
    const pending = duplicateState.pending;
    setDuplicateState(null);
    await performCreate(pending.body, pending.submitAfter, true);
  }

  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const vendors: VendorDTO[] = React.useMemo(() => {
    const list = vendorsQuery.data ?? [];
    return list.filter((v) => v.is_active);
  }, [vendorsQuery.data]);

  // §6.10.1 — apply extracted fields to the form. Each field is treated as a
  // suggestion: we overwrite the current value but keep the field editable.
  // `vendor_name` is matched against the active vendor list by exact name
  // (case-insensitive). If no match, we surface the name in a toast so the
  // user can pick a vendor or create one. Only fields the model returned
  // are touched — undefined extractions never clobber form state.
  const applyExtraction = React.useCallback(
    (extraction: BillExtractResponse) => {
      let appliedCount = 0;
      const filledFields: string[] = [];

      if (extraction.vendor_name) {
        const target = extraction.vendor_name.toLowerCase().trim();
        const match = vendors.find((v) => v.name.toLowerCase().trim() === target);
        if (match) {
          setValue("vendor_id", match.id, { shouldValidate: true, shouldDirty: true });
          appliedCount++;
          filledFields.push("vendor");
        } else {
          toast.info(
            `Vendor "${extraction.vendor_name}" not found. Pick one or create it first.`,
          );
        }
      }
      if (extraction.invoice_number) {
        setValue("invoice_number", extraction.invoice_number, {
          shouldDirty: true,
          shouldValidate: true,
        });
        appliedCount++;
        filledFields.push("invoice number");
      }
      if (extraction.issue_date) {
        setValue("issue_date", extraction.issue_date, {
          shouldDirty: true,
          shouldValidate: true,
        });
        appliedCount++;
        filledFields.push("issue date");
      }
      if (extraction.due_date) {
        setValue("due_date", extraction.due_date, {
          shouldDirty: true,
          shouldValidate: true,
        });
        appliedCount++;
        filledFields.push("due date");
      }
      if (extraction.line_items && extraction.line_items.length > 0) {
        const dollars = extraction.line_items.map((li) => ({
          description: li.description,
          amount_dollars: centsToDollars(li.amount_cents),
        }));
        setValue("line_items", dollars, {
          shouldDirty: true,
          shouldValidate: true,
        });
        refreshLineItemsSum();
        appliedCount++;
        filledFields.push(`${dollars.length} line item${dollars.length === 1 ? "" : "s"}`);
      }

      if (extraction.source === "stub") {
        toast.warning(
          "Stub extraction — set ANTHROPIC_API_KEY in .env to enable real OCR.",
          { duration: 8000 },
        );
        return;
      }

      if (appliedCount === 0) {
        toast.info("No fields were extracted from this invoice.");
        return;
      }

      const conf = extraction.confidence;
      const confSuffix =
        typeof conf === "number" ? ` (${Math.round(conf * 100)}% confidence)` : "";
      toast.success(`Extracted ${filledFields.join(", ")}${confSuffix}.`);
    },
    [vendors, setValue, refreshLineItemsSum],
  );

  const handleExtract = React.useCallback(
    (attachmentId: string) => {
      extractInvoice.mutate(
        { attachment_id: attachmentId },
        {
          onSuccess: applyExtraction,
          onError: (err) => {
            const msg =
              err instanceof ApiError
                ? err.detail
                : "Could not extract fields from this invoice.";
            toast.error(msg);
          },
        },
      );
    },
    [extractInvoice, applyExtraction],
  );

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
              disabled={isBusy || vendorsQuery.isLoading || vendorsQuery.isError}
            >
              <SelectTrigger
                id="vendor"
                className={cn(
                  errors.vendor_id && "border-destructive",
                  vendorsQuery.isError && "border-destructive",
                )}
              >
                <SelectValue
                  placeholder={
                    vendorsQuery.isLoading
                      ? "Loading vendors…"
                      : vendorsQuery.isError
                        ? "Failed to load vendors"
                        : "Select a vendor"
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
            {vendorsQuery.isError && (
              <p className="text-sm font-medium text-destructive">
                Could not load vendors. Please refresh and try again.
              </p>
            )}
            {!vendorsQuery.isError && errors.vendor_id && (
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
                    {(() => {
                      const amountReg = register(
                        `line_items.${i}.amount_dollars` as const,
                      );
                      return (
                        <Input
                          className={cn(
                            "pl-7",
                            liErr?.amount_dollars && "border-destructive",
                          )}
                          inputMode="decimal"
                          placeholder="0.00"
                          {...amountReg}
                          onBlur={(e) => {
                            amountReg.onBlur(e);
                            refreshLineItemsSum();
                          }}
                          disabled={isBusy}
                        />
                      );
                    })()}
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

        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-lg font-semibold">
            {formatMoney(lineItemsSum)}
          </span>
        </div>
      </section>

      {/* Attachment */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <Label>Invoice file</Label>
          <AttachmentInput
            initial={initial?.attachment}
            value={liveValues.attachment_id}
            onChange={(id) =>
              setValue("attachment_id", id, { shouldDirty: true })
            }
            onExtract={handleExtract}
            isExtracting={extractInvoice.isPending}
            disabled={isBusy}
          />
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

      <DuplicateBillDialog
        open={duplicateState !== null}
        matches={duplicateState?.matches ?? []}
        onCancel={() => setDuplicateState(null)}
        onConfirm={confirmDuplicateAnyway}
        isConfirming={createBill.isPending}
      />
    </form>
  );
}
