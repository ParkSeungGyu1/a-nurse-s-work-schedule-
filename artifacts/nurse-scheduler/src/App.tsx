import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import WardsPage from "@/pages/wards/index";
import WardDetailPage from "@/pages/wards/[wardId]/index";
import NursesPage from "@/pages/wards/[wardId]/nurses";
import RulesPage from "@/pages/wards/[wardId]/rules";
import StaffingPage from "@/pages/wards/[wardId]/staffing";
import RequestsPage from "@/pages/wards/[wardId]/requests";
import SchedulePage from "@/pages/wards/[wardId]/schedule";
import ExportPage from "@/pages/wards/[wardId]/export";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Router() {
  return (
    <AppLayout>
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
