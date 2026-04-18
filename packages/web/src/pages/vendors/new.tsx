import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  VendorForm,
  toVendorCreateRequest,
  type VendorFormValues,
} from "@/components/vendors/vendor-form";
import { useCreateVendor } from "@/hooks/use-vendors";
import { toastSuccess } from "@/components/vendors/shared";

export default function VendorCreatePage(): React.ReactElement {
  const navigate = useNavigate();
  const createVendor = useCreateVendor();

  async function handleSubmit(values: VendorFormValues) {
    const body = toVendorCreateRequest(values);
    const vendor = await createVendor.mutateAsync(body);
    toastSuccess("Vendor created.");
    navigate(`/vendors/${vendor.id}`);
  }

  return (
    <VendorForm
      mode="create"
      isSubmitting={createVendor.isPending}
      onSubmit={handleSubmit}
      onCancel={() => navigate("/vendors")}
    />
  );
}
