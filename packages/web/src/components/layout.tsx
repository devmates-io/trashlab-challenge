import * as React from "react";
import { NavLink, Outlet, useMatches } from "react-router-dom";
import { LayoutDashboard, Receipt, Shield, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserSwitcher } from "@/components/user-switcher";

type Nav = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Route `handle` metadata contract. Attach via `handle: { title: "..." }` on
// a route definition to expose a page title to the layout header.
export type RouteHandle = {
  title?: string;
};

// §6.6.1 sidebar — exact icons per spec.
const NAV_ITEMS: Nav[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bills", label: "Bills", icon: Receipt },
  { to: "/vendors", label: "Vendors", icon: Users },
  { to: "/approval-rules", label: "Rules", icon: Shield },
];

function Sidebar() {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 items-center px-6 text-lg font-semibold">
        Bill Pay
      </div>
      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

function Header() {
  const matches = useMatches();
  // Walk from the deepest match upward so nested routes can override the
  // title. First match that declares `handle.title` wins.
  const title =
    [...matches]
      .reverse()
      .map((m) => (m.handle as RouteHandle | undefined)?.title)
      .find((t): t is string => typeof t === "string" && t.length > 0) ?? "";
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background px-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <UserSwitcher />
    </header>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-x-auto">
          <div className="mx-auto max-w-[1200px] p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
