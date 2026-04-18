import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// §6.6.3 stat tile: large bold count, "bills" label, muted sum below, arrow
// icon on hover. Whole card is clickable.
export function StatCard({
  label,
  count,
  sumCents,
  to,
}: {
  label: string;
  count: number;
  sumCents: number;
  to: string;
}): React.ReactElement {
  return (
    <Link to={to} className="group" aria-label={`${label}: ${count} bills`}>
      <Card
        className={cn(
          "flex h-full flex-col justify-between gap-4 p-5 transition-colors",
          "hover:border-foreground/20 hover:bg-accent/40",
        )}
      >
        <div className="flex items-start justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <ArrowUpRight
            className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <div>
          <div className="text-3xl font-bold leading-tight tracking-tight">
            {count}
            <span className="ml-1 text-base font-normal text-muted-foreground">
              {count === 1 ? "bill" : "bills"}
            </span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formatMoney(sumCents)}
          </div>
        </div>
      </Card>
    </Link>
  );
}
