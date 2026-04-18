import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useApprovalRules,
  useUsersForRules,
  type ApprovalRuleListItem,
} from "@/hooks/use-approval-rules";
import { RulesTable } from "@/components/approval-rules/rules-table";
import {
  RuleFormModal,
  type RuleFormMode,
} from "@/components/approval-rules/rule-form-modal";
import { DeleteRuleDialog } from "@/components/approval-rules/delete-rule-dialog";
import { toastApiError } from "@/components/approval-rules/shared";

// §6.6.9 approval rules screen — list + modal editor on the same route.
export default function ApprovalRulesPage(): React.ReactElement {
  const rulesQuery = useApprovalRules();
  const usersQuery = useUsersForRules();

  const [formMode, setFormMode] = React.useState<RuleFormMode | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);

  const [deleteTarget, setDeleteTarget] =
    React.useState<ApprovalRuleListItem | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  React.useEffect(() => {
    if (rulesQuery.isError) toastApiError(rulesQuery.error);
  }, [rulesQuery.isError, rulesQuery.error]);

  const openCreate = () => {
    setFormMode({ kind: "create" });
    setFormOpen(true);
  };
  const openEdit = (rule: ApprovalRuleListItem) => {
    setFormMode({ kind: "edit", rule });
    setFormOpen(true);
  };
  const openDelete = (rule: ApprovalRuleListItem) => {
    setDeleteTarget(rule);
    setDeleteOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          New rule
        </Button>
      </div>

      <RulesTable
        rules={rulesQuery.data}
        users={usersQuery.data}
        loading={rulesQuery.isLoading}
        onEdit={openEdit}
        onDelete={openDelete}
      />

      <p className="text-sm text-muted-foreground">
        Note: Rule changes apply to new submissions only. Bills already in
        approval are unaffected.
      </p>

      <RuleFormModal
        open={formOpen}
        mode={formMode}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) {
            // Leave `formMode` momentarily so the closing animation finishes
            // with its current content; reset on the next tick.
            window.setTimeout(() => setFormMode(null), 150);
          }
        }}
      />

      <DeleteRuleDialog
        rule={deleteTarget}
        open={deleteOpen}
        onOpenChange={(next) => {
          setDeleteOpen(next);
          if (!next) {
            window.setTimeout(() => setDeleteTarget(null), 150);
          }
        }}
      />
    </div>
  );
}
