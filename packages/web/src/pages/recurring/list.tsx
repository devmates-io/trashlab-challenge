import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { RecurringCadence, RecurringTemplateDTO } from "@bill-pay/shared";
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
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import {
  useDeleteRecurringTemplate,
  usePauseRecurringTemplate,
  useRecurringTemplates,
  useResumeRecurringTemplate,
  useRunDueTemplates,
} from "@/hooks/use-recurring";

const CADENCE_LABEL: Record<RecurringCadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RecurringListPage(): React.ReactElement {
  const navigate = useNavigate();
  const list = useRecurringTemplates();
  const pause = usePauseRecurringTemplate();
  const resume = useResumeRecurringTemplate();
  const del = useDeleteRecurringTemplate();
  const runDue = useRunDueTemplates();

  const today = todayIso();
  const templates = list.data ?? [];
  const dueCount = templates.filter(
    (t) => t.is_active && t.paused_at === null && t.next_run_at <= today,
  ).length;

  async function handleRunDue() {
    try {
      const res = await runDue.mutateAsync();
      if (res.ran.length === 0) {
        toast.info("No templates were due — nothing to materialize.");
        return;
      }
      toast.success(
        `Created ${res.ran.length} draft bill${res.ran.length === 1 ? "" : "s"} from due templates.`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Failed to run due templates.",
      );
    }
  }

  async function handlePauseToggle(t: RecurringTemplateDTO) {
    try {
      if (t.paused_at) {
        await resume.mutateAsync(t.id);
        toast.success(`Resumed "${t.name}".`);
      } else {
        await pause.mutateAsync(t.id);
        toast.success(`Paused "${t.name}".`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Action failed.");
    }
  }

  async function handleDelete(t: RecurringTemplateDTO) {
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(t.id);
      toast.success("Template deleted.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Delete failed.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Blueprints that materialize into draft bills on a fixed cadence.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRunDue}
            disabled={runDue.isPending || dueCount === 0}
          >
            <Repeat className="mr-2 h-4 w-4" />
            {runDue.isPending
              ? "Running…"
              : dueCount > 0
                ? `Run ${dueCount} due`
                : "No due templates"}
          </Button>
          <Button asChild>
            <Link to="/recurring/new">
              <Plus className="mr-2 h-4 w-4" /> New template
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`skel-${i}`}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!list.isLoading && templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="space-y-3">
                    <p className="text-muted-foreground">
                      No recurring templates yet. Create one for repeating bills
                      like rent or SaaS.
                    </p>
                    <Button asChild>
                      <Link to="/recurring/new">
                        <Plus className="mr-2 h-4 w-4" /> New template
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!list.isLoading &&
              templates.map((t) => {
                const isPaused = t.paused_at !== null;
                const isDue =
                  !isPaused && t.is_active && t.next_run_at <= today;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.vendor_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.amount_cents)}
                    </TableCell>
                    <TableCell>{CADENCE_LABEL[t.cadence]}</TableCell>
                    <TableCell>
                      {formatDate(t.next_run_at)}
                      {isDue && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          Due
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isPaused ? (
                        <Badge variant="outline">Paused</Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/recurring/${t.id}/edit`)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePauseToggle(t)}
                          disabled={pause.isPending || resume.isPending}
                          title={isPaused ? "Resume" : "Pause"}
                        >
                          {isPaused ? (
                            <Play className="h-3.5 w-3.5" />
                          ) : (
                            <Pause className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(t)}
                          disabled={del.isPending}
                          title="Delete"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
