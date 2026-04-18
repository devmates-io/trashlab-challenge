import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import type { VendorDTO } from "@bill-pay/shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useVendorsList } from "@/hooks/use-vendors";
import {
  PAYMENT_METHOD_LABEL,
  toastApiError,
} from "@/components/vendors/shared";

export default function VendorsListPage(): React.ReactElement {
  const navigate = useNavigate();
  const vendors = useVendorsList();

  // Surface fetch errors via toast (§6.6.11).
  React.useEffect(() => {
    if (vendors.isError) {
      toastApiError(vendors.error);
    }
  }, [vendors.isError, vendors.error]);

  const rows = vendors.data ?? [];
  const showEmpty = !vendors.isLoading && !vendors.isError && rows.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          All vendors your team can pay.
        </p>
        <Button asChild>
          <Link to="/vendors/new">
            <Plus className="mr-2 h-4 w-4" />
            New vendor
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Payment method</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!vendors.isLoading &&
              rows.map((vendor) => (
                <VendorRow
                  key={vendor.id}
                  vendor={vendor}
                  onOpen={() => navigate(`/vendors/${vendor.id}`)}
                />
              ))}
          </TableBody>
        </Table>

        {showEmpty && (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No vendors yet. Create your first vendor to start tracking bills.
            </p>
            <Button asChild>
              <Link to="/vendors/new">
                <Plus className="mr-2 h-4 w-4" />
                New vendor
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function VendorRow({
  vendor,
  onOpen,
}: {
  vendor: VendorDTO;
  onOpen: () => void;
}) {
  return (
    <TableRow
      onClick={onOpen}
      className="cursor-pointer"
      // Keyboard parity so reviewers can tab-navigate the list.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell className="font-medium">{vendor.name}</TableCell>
      <TableCell>{PAYMENT_METHOD_LABEL[vendor.payment_method]}</TableCell>
      <TableCell className="text-muted-foreground">
        {vendor.contact_email || "—"}
      </TableCell>
      <TableCell>
        {vendor.is_active ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="outline">Inactive</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
