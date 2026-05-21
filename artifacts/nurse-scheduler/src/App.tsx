import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const WardsPage = lazy(() => import("@/pages/wards/index"));
const WardDetailPage = lazy(() => import("@/pages/wards/[wardId]/index"));
const NursesPage = lazy(() => import("@/pages/wards/[wardId]/nurses"));
const RulesPage = lazy(() => import("@/pages/wards/[wardId]/rules"));
const StaffingPage = lazy(() => import("@/pages/wards/[wardId]/staffing"));
const RequestsPage = lazy(() => import("@/pages/wards/[wardId]/requests"));
const SchedulePage = lazy(() => import("@/pages/wards/[wardId]/schedule"));
const ExportPage = lazy(() => import("@/pages/wards/[wardId]/export"));
const NotFound = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Router() {
  return (
    <AppLayout>
      <Suspense
        fallback={
          <div className="flex min-h-[50vh] items-center justify-center px-4">
            <div className="rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
              화면을 불러오는 중입니다.
            </div>
          </div>
        }
      >
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/wards" component={WardsPage} />
          <Route path="/wards/:wardId" component={WardDetailPage} />
          <Route path="/wards/:wardId/nurses" component={NursesPage} />
          <Route path="/wards/:wardId/rules" component={RulesPage} />
          <Route path="/wards/:wardId/staffing" component={StaffingPage} />
          <Route path="/wards/:wardId/requests" component={RequestsPage} />
          <Route path="/wards/:wardId/schedule" component={SchedulePage} />
          <Route path="/wards/:wardId/export" component={ExportPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
