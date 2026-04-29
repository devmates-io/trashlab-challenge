import * as React from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { Layout, RequireAdmin, type RouteHandle } from "@/components/layout";
import { Toaster } from "@/components/ui/sonner";

import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import BillsListPage from "@/pages/bills/list";
import BillCreatePage from "@/pages/bills/new";
import BillEditPage from "@/pages/bills/edit";
import BillDetailPage from "@/pages/bills/detail";
import VendorsListPage from "@/pages/vendors/list";
import VendorCreatePage from "@/pages/vendors/new";
import VendorEditPage from "@/pages/vendors/edit";
import VendorDetailPage from "@/pages/vendors/detail";
import ApprovalRulesPage from "@/pages/approval-rules/list";
// Admin user-management pages (Package D, concurrent). Imported as if they
// already exist; the build will fail to typecheck until D's files land.
// That's expected during parallel execution.
import UsersListPage from "@/pages/users/list";
import UserCreatePage from "@/pages/users/new";
import UserEditPage from "@/pages/users/edit";
import NotificationsPage from "@/pages/notifications";
import RecurringListPage from "@/pages/recurring/list";
import RecurringTemplateNewPage from "@/pages/recurring/new";
import RecurringTemplateEditPage from "@/pages/recurring/edit";
import NotFoundPage from "@/pages/not-found";

const handle = (title: string): RouteHandle => ({ title });

const router = createBrowserRouter([
  // /login renders OUTSIDE Layout so it isn't itself auth-guarded.
  {
    path: "login",
    element: <LoginPage />,
  },
  {
    element: <Layout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
        handle: handle("Dashboard"),
      },
      {
        path: "bills",
        element: <BillsListPage />,
        handle: handle("Bills"),
      },
      {
        path: "bills/new",
        element: <BillCreatePage />,
        handle: handle("New bill"),
      },
      {
        path: "bills/:id",
        element: <BillDetailPage />,
        handle: handle("Bill detail"),
      },
      {
        path: "bills/:id/edit",
        element: <BillEditPage />,
        handle: handle("Edit bill"),
      },
      {
        path: "vendors",
        element: <VendorsListPage />,
        handle: handle("Vendors"),
      },
      {
        path: "vendors/new",
        element: <VendorCreatePage />,
        handle: handle("New vendor"),
      },
      {
        path: "vendors/:id",
        element: <VendorDetailPage />,
        handle: handle("Vendor detail"),
      },
      {
        path: "vendors/:id/edit",
        element: <VendorEditPage />,
        handle: handle("Edit vendor"),
      },
      {
        path: "approval-rules",
        element: <ApprovalRulesPage />,
        handle: handle("Approval rules"),
      },
      {
        path: "notifications",
        element: <NotificationsPage />,
        handle: handle("Notifications"),
      },
      {
        path: "recurring",
        element: <RecurringListPage />,
        handle: handle("Recurring bills"),
      },
      {
        path: "recurring/new",
        element: <RecurringTemplateNewPage />,
        handle: handle("New recurring template"),
      },
      {
        path: "recurring/:id/edit",
        element: <RecurringTemplateEditPage />,
        handle: handle("Edit recurring template"),
      },
      // Admin-only branch. RequireAdmin wraps the user-management routes so
      // a non-admin landing on /users via direct URL is sent back to /
      // (rather than seeing the page chrome and a generic 403 toast).
      {
        element: <RequireAdmin />,
        children: [
          {
            path: "users",
            element: <UsersListPage />,
            handle: handle("Users"),
          },
          {
            path: "users/new",
            element: <UserCreatePage />,
            handle: handle("New user"),
          },
          {
            path: "users/:id/edit",
            element: <UserEditPage />,
            handle: handle("Edit user"),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "/404", element: <Navigate to="/" replace /> },
]);

export default function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
