import * as React from "react";
import { NavLink, Navigate, Outlet, useMatches } from "react-router-dom";
import {
  LayoutDashboard,
  Loader2,
  LogOut,
  Receipt,
  Repeat,
  Shield,
  Users,
  UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserSwitcher } from "@/components/user-switcher";
import { NotificationsBell } from "@/components/notifications-bell";
import { getSessionToken } from "@/lib/api";
import {
  useCurrentUser,
  useIsImpersonating,
  useLogout,
  useRealUser,
  useSession,
  useStopImpersonating,
} from "@/hooks/use-current-user";

type Nav = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // When true, only render this item if the *acting* identity is an admin.
  // Per the policy decision documented at the bottom of this file, admin
  // navigation hides while impersonating to avoid the "admin actions taken
  // as someone else" trap.
  adminOnly?: boolean;
};

// Route `handle` metadata contract. Attach via `handle: { title: "..." }` on
// a route definition to expose a page title to the layout header.
export type RouteHandle = {
  title?: string;
};

// §6.6.1 sidebar — exact icons per spec, plus the admin-only Users entry
// added for the auth/admin shell.
const NAV_ITEMS: Nav[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bills", label: "Bills", icon: Receipt },
  { to: "/vendors", label: "Vendors", icon: Users },
  { to: "/recurring", label: "Recurring", icon: Repeat },
  { to: "/approval-rules", label: "Rules", icon: Shield },
  { to: "/users", label: "Users", icon: UserCog, adminOnly: true },
];

function Sidebar({ showAdminNav }: { showAdminNav: boolean }) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || showAdminNav,
  );
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 items-center px-6 text-lg font-semibold">
        Bill Pay
      </div>
      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-1">
          {visibleItems.map(({ to, label, icon: Icon }) => (
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

// Right-side cluster on the header. Composition rules:
// - Admin (real) AND not impersonating  → <UserSwitcher /> + identity + logout.
// - Currently impersonating              → "Acting as <name>" pill with stop
//   button + logout. UserSwitcher is hidden because the layout now needs to
//   show the impersonated identity, not the picker.
// - Non-admin                            → identity label + logout.
function HeaderRightCluster() {
  const realUser = useRealUser();
  const actingUser = useCurrentUser();
  const isImpersonating = useIsImpersonating();
  const stopImpersonating = useStopImpersonating();
  const logout = useLogout();

  const isAdmin = realUser.data?.role === "admin";
  const real = realUser.data;
  const acting = actingUser.data;

  return (
    <div className="flex items-center gap-3">
      {isImpersonating && acting ? (
        <div className="flex items-center gap-2 rounded-full border border-yellow-300 bg-yellow-100 px-3 py-1 text-sm text-yellow-900">
          <span className="font-medium">Acting as {acting.name}</span>
          <span className="text-yellow-700">·</span>
          <button
            type="button"
            onClick={() => stopImpersonating.mutate()}
            disabled={stopImpersonating.isPending}
            className="text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60"
          >
            {stopImpersonating.isPending ? "Stopping…" : "Stop"}
          </button>
        </div>
      ) : isAdmin ? (
        <UserSwitcher />
      ) : real ? (
        <div className="text-sm">
          <span className="font-medium">{real.name}</span>
          <span className="px-2 text-muted-foreground">·</span>
          <span className="capitalize text-muted-foreground">{real.role}</span>
        </div>
      ) : null}
      <NotificationsBell />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="gap-2"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </div>
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
      <HeaderRightCluster />
    </header>
  );
}

// High-contrast strip rendered between header and page content while an
// admin is impersonating. Yellow palette mirrors common "you are not in
// your normal context" UX (e.g. Google support reps' "Acting as user").
function ImpersonationBanner() {
  const realUser = useRealUser();
  const actingUser = useCurrentUser();
  const stopImpersonating = useStopImpersonating();
  const real = realUser.data;
  const acting = actingUser.data;
  if (!real || !acting) return null;
  return (
    <div className="border-b border-yellow-300 bg-yellow-100 px-8 py-2 text-sm text-yellow-900">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
        <div>
          You are signed in as{" "}
          <span className="font-semibold">{real.name}</span> · acting as{" "}
          <span className="font-semibold">{acting.name}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => stopImpersonating.mutate()}
          disabled={stopImpersonating.isPending}
          className="border-yellow-400 bg-white/60 hover:bg-white"
        >
          {stopImpersonating.isPending ? "Stopping…" : "Stop impersonating"}
        </Button>
      </div>
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Layout() {
  // Auth guard. The four cases handled here mirror the four "shapes" the
  // session can be in at any given moment:
  //
  // 1. No token in storage           → redirect to /login.
  // 2. Token present, query loading   → centered spinner (avoids flashing
  //    the chrome before the identity is known).
  // 3. Token present, query error     → token has been cleared by apiFetch
  //    on 401 / removed by another tab; redirect to /login.
  // 4. Token present, session loaded  → render the chrome.
  const session = useSession();
  const actingUser = useCurrentUser();
  const isImpersonating = useIsImpersonating();

  if (getSessionToken() === null) {
    return <Navigate to="/login" replace />;
  }
  if (session.isLoading || actingUser.isLoading) {
    return <CenteredSpinner label="Loading…" />;
  }
  if (session.isError || !session.data) {
    return <Navigate to="/login" replace />;
  }

  // Policy: admin nav follows the *acting* identity, not the real one. An
  // admin who is impersonating Alice should see Alice's chrome (no admin
  // entry). Stopping impersonation restores the admin's normal view.
  // Rationale lives at the bottom of this file.
  const showAdminNav = actingUser.data?.role === "admin";

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar showAdminNav={showAdminNav} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Header />
        {isImpersonating && <ImpersonationBanner />}
        <main className="flex-1 overflow-x-auto">
          <div className="mx-auto max-w-[1200px] p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// Route-level guard for admin-only pages (currently /users/*). Mirrors the
// sidebar gate (`useCurrentUser`) on purpose: while an admin impersonates
// a non-admin, the sidebar's Users entry is hidden AND a direct URL hit
// to /users redirects back to /. Both behaviors are derived from the acting
// identity so an admin doing user-CRUD while pretending to be Alice is
// simply impossible. To regain admin access, the impersonator stops
// impersonating — at which point both the nav and this route open back up.
export function RequireAdmin() {
  const actingUser = useCurrentUser();
  if (actingUser.isLoading) {
    return <CenteredSpinner label="Loading…" />;
  }
  if (actingUser.data?.role !== "admin") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

// ---- Policy notes ---------------------------------------------------------
//
// Admin nav while impersonating: HIDDEN.
//   The sidebar's Users entry is gated on the *acting* user's role, not the
//   real one. While Dana (admin) is "logged in as" Alice, the sidebar reads
//   like Alice's. The banner remains visible at all times so the impersonating
//   admin can stop and recover their normal nav with one click. The trade-off
//   we explicitly avoid is: an admin acting as Alice clicks "Users" and
//   creates / edits a user — those mutations would be performed under
//   Alice's identity (the API uses the acting user as the actor), which is
//   confusing at best and an audit-trail integrity bug at worst.
