import type { VendorDTO } from "@bill-pay/shared";
import { maskLast4, PAYMENT_METHOD_LABEL_UPPER } from "@/components/vendors/shared";

// §6.6.7 detail: reshape per payment method. Account numbers and card PANs
// are masked except for the last 4 (V-AC-4).
export function PaymentDetailsView({ vendor }: { vendor: VendorDTO }) {
  const pd = vendor.payment_details;
  return (
    <dl className="grid grid-cols-[200px_1fr] gap-y-3 text-sm">
      <dt className="text-muted-foreground">Payment method</dt>
      <dd className="font-medium">
        {PAYMENT_METHOD_LABEL_UPPER[vendor.payment_method]}
      </dd>
      {pd.method === "ach" && (
        <>
          <dt className="text-muted-foreground">Routing #</dt>
          <dd className="font-mono">{pd.routing_number}</dd>
          <dt className="text-muted-foreground">Account #</dt>
          <dd className="font-mono">{maskLast4(pd.account_number)}</dd>
          <dt className="text-muted-foreground">Account holder</dt>
          <dd>{pd.account_holder_name}</dd>
        </>
      )}
      {pd.method === "check" && (
        <>
          <dt className="text-muted-foreground">Mailing address</dt>
          <dd className="whitespace-pre-line">
            {[pd.address_line1, pd.address_line2 || null]
              .filter(Boolean)
              .join("\n")}
            {"\n"}
            {pd.city}, {pd.state} {pd.postal_code}
          </dd>
        </>
      )}
      {pd.method === "wire" && (
        <>
          <dt className="text-muted-foreground">Bank name</dt>
          <dd>{pd.bank_name}</dd>
          <dt className="text-muted-foreground">SWIFT/BIC</dt>
          <dd className="font-mono">{pd.swift_code}</dd>
          <dt className="text-muted-foreground">IBAN</dt>
          <dd className="font-mono">{pd.iban}</dd>
          <dt className="text-muted-foreground">Account holder</dt>
          <dd>{pd.account_holder_name}</dd>
        </>
      )}
      {pd.method === "card" && (
        <>
          <dt className="text-muted-foreground">Card brand</dt>
          <dd className="capitalize">{pd.card_brand}</dd>
          <dt className="text-muted-foreground">Card number</dt>
          <dd className="font-mono">•••• {pd.last_four}</dd>
        </>
      )}
    </dl>
  );
}
