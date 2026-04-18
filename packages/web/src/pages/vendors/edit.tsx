import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  VendorForm,
  toVendorCreateRequest,
  type VendorFormValues,
} from "@/components/vendors/vendor-form";
import { VendorFormSkeleton } from "@/components/vendors/vendor-form-skeleton";
import { useUpdateVendor, useVendor } from "@/hooks/use-vendors";
import { toastApiError, toastSuccess } from "@/components/vendors/shared";

export default function VendorEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const vendorQuery = useVendor(id);
  const updateVendor = useUpdateVendor(id ?? "");

  React.useEffect(() => {
    if (vendorQuery.isError) {
      toastApiError(vendorQuery.error);
    }
  }, [vendorQuery.isError, vendorQuery.error]);

  if (vendorQuery.isLoading) {
    return <VendorFormSkeleton />;
  }

  if (vendorQuery.isError || !vendorQuery.data) {
    const notFound =
      vendorQuery.error instanceof ApiError &&
      vendorQuery.error.status === 404;
    return (
      <div className="rounded-lg border border-dashed bg-card p-10 text-center">
        <h2 className="text-xl font-semibold">
          {notFound ? "Vendor not found" : "Could not load vendor"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {notFound
            ? "It may have been deleted."
            : "Please try again in a moment."}
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate("/vendors")}>
            Back to vendors
          </Button>
        </div>
      </div>
    );
  }

  const vendor = vendorQuery.data;

  async function handleSubmit(values: VendorFormValues) {
    // §6.5.4 PATCH /vendors/:id accepts a partial body, but if payment_method
    // changes the new payment_details must be sent. We simply send the full
    // shape every time — simpler and guaranteed consistent.
    const body = toVendorCreateRequest(values);
    const updated = await updateVendor.mutateAsync(body);
    toastSuccess("Vendor updated.");
    navigate(`/vendors/${updated.id}`);
  }

  return (
    <VendorForm
      mode="edit"
      initial={vendor}
      isSubmitting={updateVendor.isPending}
      onSubmit={handleSubmit}
      onCancel={() => navigate(`/vendors/${vendor.id}`)}
    />
  );
}
