import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { BillForm } from "@/components/bills/bill-form";

export default function BillCreatePage(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const vendorIdHint = searchParams.get("vendor_id") ?? undefined;
  return <BillForm mode="create" vendorIdHint={vendorIdHint} />;
}
