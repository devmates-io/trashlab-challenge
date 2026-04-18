import * as React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { Layout } from "@/components/layout";
import { Toaster } from "@/components/ui/sonner";

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
import NotFoundPage from "@/pages/not-found";

export default function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="bills" element={<BillsListPage />} />
            <Route path="bills/new" element={<BillCreatePage />} />
            <Route path="bills/:id" element={<BillDetailPage />} />
            <Route path="bills/:id/edit" element={<BillEditPage />} />
            <Route path="vendors" element={<VendorsListPage />} />
            <Route path="vendors/new" element={<VendorCreatePage />} />
            <Route path="vendors/:id" element={<VendorDetailPage />} />
            <Route path="vendors/:id/edit" element={<VendorEditPage />} />
            <Route path="approval-rules" element={<ApprovalRulesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="/404" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
