import * as React from "react";

// Shared placeholder body for Phase-1 stubs. Replaced by downstream engineers
// as individual screens get implemented in Phase 2.
export function StubPage({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-dashed bg-card p-10 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {detail ?? "Stub — implemented in Phase 2."}
      </p>
    </div>
  );
}
