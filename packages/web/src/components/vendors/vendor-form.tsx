import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import {
  achPaymentDetailsSchema,
  checkPaymentDetailsSchema,
  wirePaymentDetailsSchema,
  type VendorCreateRequest,
  type VendorDTO,
} from "@bill-pay/shared";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
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

// §6.6.8 — Payment method Select only shows ACH / Check / Wire. Card is
// hidden per §6.2.6 (seed-only vendors).
const FORM_PAYMENT_METHODS = ["ach", "check", "wire"] as const;
type FormPaymentMethod = (typeof FORM_PAYMENT_METHODS)[number];

const formPaymentDetailsSchema = z.discriminatedUnion("method", [
  achPaymentDetailsSchema,
  checkPaymentDetailsSchema,
  wirePaymentDetailsSchema,
]);

// Empty-string ↔ absent contact_email. RHF needs a concrete string default,
// so we accept "" as valid and normalize to `null` when building the API body.
const contactEmailField = z.union([
  z.literal(""),
  z.string().email("Must be a valid email"),
]);

const vendorFormSchema = z
  .object({
    name: z
      .string()
      .min(1, "Required")
      .max(100, "Max 100 characters"),
    contact_email: contactEmailField,
    payment_method: z.enum(FORM_PAYMENT_METHODS),
    payment_details: formPaymentDetailsSchema,
  })
  .superRefine((val, ctx) => {
    if (val.payment_method !== val.payment_details.method) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payment_details", "method"],
        message: "Payment details shape does not match the selected method",
      });
    }
  });

export type VendorFormValues = z.infer<typeof vendorFormSchema>;

// ---- defaults per method ----

const DEFAULT_ACH: VendorFormValues["payment_details"] = {
  method: "ach",
  routing_number: "",
  account_number: "",
  account_holder_name: "",
};
const DEFAULT_CHECK: VendorFormValues["payment_details"] = {
  method: "check",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
};
const DEFAULT_WIRE: VendorFormValues["payment_details"] = {
  method: "wire",
  bank_name: "",
  swift_code: "",
  iban: "",
  account_holder_name: "",
};

function defaultsFor(method: FormPaymentMethod): VendorFormValues["payment_details"] {
  if (method === "ach") return { ...DEFAULT_ACH };
  if (method === "check") return { ...DEFAULT_CHECK };
  return { ...DEFAULT_WIRE };
}

// Map an optional existing VendorDTO (edit mode) to form values. If the
// existing vendor uses the seed-only "card" method, we default the form to
// "ach" since the form cannot represent card shape (§6.2.6).
function toFormValues(initial?: VendorDTO): VendorFormValues {
  if (!initial) {
    return {
      name: "",
      contact_email: "",
      payment_method: "ach",
      payment_details: { ...DEFAULT_ACH },
    };
  }
  const method: FormPaymentMethod =
    initial.payment_method === "card" ? "ach" : initial.payment_method;
  let payment_details: VendorFormValues["payment_details"];
  if (initial.payment_method !== method) {
    payment_details = defaultsFor(method);
  } else if (initial.payment_details.method === "ach") {
    payment_details = {
      method: "ach",
      routing_number: initial.payment_details.routing_number,
      account_number: initial.payment_details.account_number,
      account_holder_name: initial.payment_details.account_holder_name,
    };
  } else if (initial.payment_details.method === "check") {
    payment_details = {
      method: "check",
      address_line1: initial.payment_details.address_line1,
      address_line2: initial.payment_details.address_line2 ?? "",
      city: initial.payment_details.city,
      state: initial.payment_details.state,
      postal_code: initial.payment_details.postal_code,
    };
  } else if (initial.payment_details.method === "wire") {
    payment_details = {
      method: "wire",
      bank_name: initial.payment_details.bank_name,
      swift_code: initial.payment_details.swift_code,
      iban: initial.payment_details.iban,
      account_holder_name: initial.payment_details.account_holder_name,
    };
  } else {
    payment_details = defaultsFor(method);
  }
  return {
    name: initial.name,
    contact_email: initial.contact_email ?? "",
    payment_method: method,
    payment_details,
  };
}

// Build the API-shape request body from the validated form values.
export function toVendorCreateRequest(
  values: VendorFormValues,
): VendorCreateRequest {
  const body: VendorCreateRequest = {
    name: values.name.trim(),
    contact_email: values.contact_email === "" ? null : values.contact_email,
    payment_method: values.payment_method,
    payment_details: values.payment_details,
  };
  return body;
}

// ---- subform renderers ----

type SubformProps = { form: UseFormReturn<VendorFormValues> };

function uppercaseOnBlur(
  form: UseFormReturn<VendorFormValues>,
  // Narrowed at call-site; we cast internally to satisfy RHF's deep path types.
  path: string,
): (e: React.FocusEvent<HTMLInputElement>) => void {
  return (e) => {
    const next = e.target.value.toUpperCase();
    if (next !== e.target.value) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.setValue(path as any, next, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };
}

function AchSubform({ form }: SubformProps) {
  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="payment_details.routing_number"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Routing number</FormLabel>
            <FormControl>
              <Input
                inputMode="numeric"
                maxLength={9}
                placeholder="9 digits"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.account_number"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Account number</FormLabel>
            <FormControl>
              <Input
                inputMode="numeric"
                maxLength={17}
                placeholder="4–17 digits"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.account_holder_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Account holder name</FormLabel>
            <FormControl>
              <Input maxLength={100} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function CheckSubform({ form }: SubformProps) {
  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="payment_details.address_line1"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address line 1</FormLabel>
            <FormControl>
              <Input maxLength={100} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.address_line2"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Address line 2 (optional)</FormLabel>
            <FormControl>
              <Input
                maxLength={100}
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_96px_140px]">
        <FormField
          control={form.control}
          name="payment_details.city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input maxLength={50} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="payment_details.state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <FormControl>
                <Input
                  maxLength={2}
                  placeholder="CA"
                  {...field}
                  onBlur={uppercaseOnBlur(form, "payment_details.state")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="payment_details.postal_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ZIP code</FormLabel>
              <FormControl>
                <Input
                  maxLength={10}
                  placeholder="94103 or 94103-1234"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}

function WireSubform({ form }: SubformProps) {
  return (
    <div className="grid gap-4">
      <FormField
        control={form.control}
        name="payment_details.bank_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Bank name</FormLabel>
            <FormControl>
              <Input maxLength={100} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.swift_code"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SWIFT/BIC code</FormLabel>
            <FormControl>
              <Input
                maxLength={11}
                placeholder="8 or 11 characters"
                {...field}
                onBlur={uppercaseOnBlur(form, "payment_details.swift_code")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.iban"
        render={({ field }) => (
          <FormItem>
            <FormLabel>IBAN</FormLabel>
            <FormControl>
              <Input
                maxLength={34}
                placeholder="15–34 characters"
                {...field}
                onBlur={uppercaseOnBlur(form, "payment_details.iban")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="payment_details.account_holder_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Account holder name</FormLabel>
            <FormControl>
              <Input maxLength={100} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ---- main component ----

type VendorFormProps = {
  mode: "create" | "edit";
  initial?: VendorDTO;
  isSubmitting: boolean;
  submitLabel?: string;
  onSubmit: (values: VendorFormValues) => Promise<void> | void;
  onCancel: () => void;
};

export function VendorForm({
  mode,
  initial,
  isSubmitting,
  submitLabel,
  onSubmit,
  onCancel,
}: VendorFormProps) {
  const form = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: toFormValues(initial),
  });

  const watchMethod = form.watch("payment_method");
  const lastMethodRef = React.useRef<FormPaymentMethod>(
    form.getValues("payment_method"),
  );

  // Reset payment_details when the user changes payment_method so we never
  // submit a shape that doesn't match the discriminator (§6.2 invariant).
  React.useEffect(() => {
    if (watchMethod === lastMethodRef.current) return;
    lastMethodRef.current = watchMethod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.setValue("payment_details" as any, defaultsFor(watchMethod), {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.clearErrors("payment_details");
  }, [watchMethod, form]);

  async function handleValid(values: VendorFormValues) {
    try {
      await onSubmit(values);
    } catch (err) {
      // Map field-level API errors back to the form (react-hook-form setError).
      if (err instanceof ApiError && err.fieldIssues.length > 0) {
        for (const issue of err.fieldIssues) {
          const path = issue.path.replace(/^\//, "").replaceAll("/", ".") as
            | "name"
            | "contact_email"
            | "payment_method"
            | `payment_details.${string}`;
          form.setError(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            path as any,
            { type: "server", message: issue.message },
          );
        }
      }
      toastApiError(err);
    }
  }

  const defaultSubmitLabel = mode === "create" ? "Save vendor" : "Save changes";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleValid)} className="space-y-8">
        <fieldset disabled={isSubmitting} className="space-y-8">
          <section className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold">Vendor details</h2>
              <p className="text-sm text-muted-foreground">
                Basic identifying information for this vendor.
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
                      placeholder="Acme Legal, LLC"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contact_email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact email (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="ap@acme.legal"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          <section className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold">Payment details</h2>
              <p className="text-sm text-muted-foreground">
                Choose a method; the required fields adjust accordingly.
              </p>
            </div>
            <FormField
              control={form.control}
              name="payment_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment method</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ach">ACH</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="wire">Wire</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchMethod === "ach" && <AchSubform form={form} />}
            {watchMethod === "check" && <CheckSubform form={form} />}
            {watchMethod === "wire" && <WireSubform form={form} />}
          </section>
        </fieldset>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              (submitLabel ?? defaultSubmitLabel)
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
