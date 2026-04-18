import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentDetailsView } from "@/components/vendors/payment-details-view";
import { DeleteVendorDialog } from "@/components/vendors/delete-vendor-dialog";
import {
  BILL_STATUS_LABEL,
  billStatusBadgeVariant,
  toastApiError,
  toastSuccess,
} from "@/components/vendors/shared";
import {
  useBillsForVendor,
  useDeleteVendor,
  useVendor,
  type BillSummary,
} from "@/hooks/use-vendors";
import { formatDate, formatMoney } from "@/lib/format";

export default function VendorDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const vendorQuery = useVendor(id);
  const billsQuery = useBillsForVendor(id);
  const deleteVendor = useDeleteVendor();
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    if (vendorQuery.isError) toastApiError(vendorQuery.error);
  }, [vendorQuery.isError, vendorQuery.error]);
  React.useEffect(() => {
    if (billsQuery.isError) toastApiError(billsQuery.error);
  }, [billsQuery.isError, billsQuery.error]);

  if (vendorQuery.isLoading) {
    return <VendorDetailSkeleton />;
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
  const bills = billsQuery.data ?? [];
  // Block delete client-side whenever we already know the vendor has bills —
  // the API will 409 regardless (§7 V-AC-6); this just sets the UX up front.
  // While bills are still loading we also block to avoid a momentary
  // click-through during the initial page render.
  const billsKnown = !billsQuery.isLoading;
  const hasBills = bills.length > 0;
  const deleteDisabled = !billsKnown || hasBills;
  const deleteDisabledHint = !billsKnown
    ? "Loading bills…"
    : hasBills
      ? "Cannot delete vendor with bills."
      : undefined;

  async function handleConfirmDelete() {
    if (!id) return;
    try {
      await deleteVendor.mutateAsync(id);
      toastSuccess("Vendor deleted.");
      setDeleteOpen(false);
      navigate("/vendors");
    } catch (err) {
      toastApiError(err);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Vendor: {vendor.name}</h2>
          {!vendor.is_active && (
            <Badge variant="outline">Inactive</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to={`/vendors/${vendor.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <Button
            variant="destructive"
            disabled={deleteDisabled}
            // No tooltip component preinstalled; native title fills the role
            // per §6.6.7: "Cannot delete vendor with bills."
            title={deleteDisabledHint}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h3>
        <dl className="grid grid-cols-[200px_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Contact</dt>
          <dd>{vendor.contact_email || "—"}</dd>
        </dl>
        <div className="mt-4">
          <PaymentDetailsView vendor={vendor} />
        </div>
      </section>

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between p-6 pb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Bills
          </h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`bill-skel-${i}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!billsQuery.isLoading &&
              bills.map((bill) => (
                <BillRow key={bill.id} bill={bill} />
              ))}
          </TableBody>
        </Table>
        {!billsQuery.isLoading && bills.length === 0 && (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No bills for this vendor yet.
            </p>
            <Button asChild>
              <Link to={`/bills/new?vendor_id=${vendor.id}`}>
                <Plus className="mr-2 h-4 w-4" />
                New bill with this vendor
              </Link>
            </Button>
          </div>
        )}
      </section>

      <DeleteVendorDialog
        open={deleteOpen}
        vendorName={vendor.name}
        isDeleting={deleteVendor.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function BillRow({ bill }: { bill: BillSummary }) {
  const navigate = useNavigate();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => navigate(`/bills/${bill.id}`)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/bills/${bill.id}`);
        }
      }}
    >
      <TableCell className="font-medium">{bill.invoice_number}</TableCell>
      <TableCell>{formatMoney(bill.amount_cents)}</TableCell>
      <TableCell>{formatDate(bill.due_date)}</TableCell>
      <TableCell>
        <Badge variant={billStatusBadgeVariant(bill.status)}>
          {BILL_STATUS_LABEL[bill.status]}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function VendorDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-4 w-24" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <Skeleton className="mb-4 h-4 w-16" />
        <div className="space-y-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
    </div>
  );
}
