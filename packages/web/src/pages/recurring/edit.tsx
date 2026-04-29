import * as React from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { RecurringTemplateForm } from "@/components/recurring/template-form";
import { useRecurringTemplate } from "@/hooks/use-recurring";

export default function RecurringTemplateEditPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const query = useRecurringTemplate(id);

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading template…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <Navigate to="/recurring" replace />;
  }
  return <RecurringTemplateForm mode="edit" initial={query.data} />;
}
