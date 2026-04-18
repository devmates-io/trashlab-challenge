import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import type { UserDTO } from "@bill-pay/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/format";
import {
  usePatchApprovalRule,
  type ApprovalRuleListItem,
} from "@/hooks/use-approval-rules";
import {
  toastApiError,
  toastSuccess,
} from "@/components/approval-rules/shared";

export function RulesTable({
  rules,
  users,
  loading,
  onEdit,
  onDelete,
}: {
  rules: ApprovalRuleListItem[] | undefined;
  users: UserDTO[] | undefined;
  loading: boolean;
  onEdit: (rule: ApprovalRuleListItem) => void;
  onDelete: (rule: ApprovalRuleListItem) => void;
}): React.ReactElement {
  if (loading) {
    return <RulesTableSkeleton />;
  }

  const userNameById = new Map<string, string>(
    (users ?? []).map((u) => [u.id, u.name]),
  );
  const list = rules ?? [];

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Threshold</TableHead>
            <TableHead>Approvers</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[120px] text-right">Active</TableHead>
            <TableHead className="w-[56px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              userNameById={userNameById}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RuleRow({
  rule,
  userNameById,
  onEdit,
  onDelete,
}: {
  rule: ApprovalRuleListItem;
  userNameById: Map<string, string>;
  onEdit: (rule: ApprovalRuleListItem) => void;
  onDelete: (rule: ApprovalRuleListItem) => void;
}): React.ReactElement {
  const patch = usePatchApprovalRule();
  // Perceived-snappy switch (§task prompt): flip UI immediately, revert on
  // server error. Local override is cleared after each successful request so
  // the query becomes the source of truth again.
  const [pendingActive, setPendingActive] = React.useState<boolean | null>(
    null,
  );
  const displayedActive = pendingActive ?? rule.is_active;

  const onToggle = (next: boolean) => {
    setPendingActive(next);
    patch.mutate(
      { id: rule.id, body: { is_active: next } },
      {
        onSuccess: () => {
          toastSuccess(next ? "Rule activated." : "Rule deactivated.");
          setPendingActive(null);
        },
        onError: (err) => {
          setPendingActive(null);
          toastApiError(err);
        },
      },
    );
  };

  const approverNames = rule.approver_user_ids
    .map((id) => userNameById.get(id))
    .filter((n): n is string => Boolean(n))
    .join(", ");

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onEdit(rule)}
    >
      <TableCell className="font-medium">{rule.name}</TableCell>
      <TableCell>&ge; {formatMoney(rule.min_amount_cents)}</TableCell>
      <TableCell className="text-muted-foreground">
        {approverNames || "—"}
      </TableCell>
      <TableCell>
        <Badge variant={displayedActive ? "default" : "outline"}>
          {displayedActive ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div
          className="inline-flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={displayedActive}
            onCheckedChange={onToggle}
            disabled={patch.isPending}
            aria-label={
              displayedActive ? "Deactivate rule" : "Activate rule"
            }
          />
        </div>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Row actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(rule)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(rule)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function RulesTableSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2 rounded-md border bg-card p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
