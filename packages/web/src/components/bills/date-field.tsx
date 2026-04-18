import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

// Input/Output is an ISO date string YYYY-MM-DD (matches shared schema
// isoDateStringSchema — §6.5.1). Internal Calendar works with a Date.
function parseIso(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIso(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateField({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  id,
  invalid,
}: {
  value: string | undefined | null;
  onChange: (iso: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const date = parseIso(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            invalid && "border-destructive",
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDate(date) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            onChange(toIso(d));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
