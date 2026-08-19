import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Loader2 } from "lucide-react";

// Lazy-loaded pages for code splitting
const Home = lazy(() => import("./pages/Home"));
const BundlesPage = lazy(() => import("./pages/Bundles"));
const IntakePage = lazy(() => import("./pages/Intake"));
const EstimatePage = lazy(() => import("./pages/Estimate"));
const EstimateDetailPage = lazy(() => import("./pages/EstimateDetail"));
const ReviewPage = lazy(() => import("./pages/Review"));
const HistoryPage = lazy(() => import("./pages/History"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const CalculatorPage = lazy(() => import("./pages/Calculator"));
const ClientsPage = lazy(() => import("./pages/Clients"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const LeadsPage = lazy(() => import("./pages/Leads"));
const DealsPage = lazy(() => import("./pages/Deals"));
const PipelinePage = lazy(() => import("./pages/PipelineOverview"));
const ScopeGenerationPage = lazy(() => import("./pages/ScopeGeneration"));
const WorkflowPage = lazy(() => import("./pages/Workflow"));
const MonitoringPage = lazy(() => import("./pages/Monitoring"));
const FieldFeedbackPage = lazy(() => import("./pages/FieldFeedback"));
const ProjectActualsPage = lazy(() => import("./pages/ProjectActuals"));
const LearningDashboardPage = lazy(() => import("./pages/LearningDashboard"));
const DrawingUploadPage = lazy(() => import("./pages/DrawingUpload"));
const DrawingReviewPage = lazy(() => import("./pages/DrawingReview"));
const NotFound = lazy(() => import("./pages/NotFound"));
// SUPABASE AUTH V1: the sign-in screen renders outside the authenticated shell.
const LoginPage = lazy(() => import("./pages/Login"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  );
}

function Router() {
  return (
    // SUPABASE AUTH V1: /login is matched before the dashboard shell so an
    // unauthenticated operator can reach the form without hitting the auth gate.
    <Switch>
      <Route path="/login">
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
        </Suspense>
      </Route>
      <Route>
        <AuthenticatedRouter />
      </Route>
    </Switch>
  );
}

function AuthenticatedRouter() {
  return (
    <DashboardLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/bundles" component={BundlesPage} />
          <Route path="/intake" component={IntakePage} />
          <Route path="/estimate" component={EstimatePage} />
          <Route path="/estimates/:id" component={EstimateDetailPage} />
          <Route path="/history" component={HistoryPage} />
          <Route path="/leads" component={LeadsPage} />
          <Route path="/deals" component={DealsPage} />
          <Route path="/pipeline" component={PipelinePage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/projects" component={ProjectsPage} />
          <Route path="/drawings" component={DrawingUploadPage} />
          <Route path="/drawing-review" component={DrawingReviewPage} />
          <Route path="/scope-generation" component={ScopeGenerationPage} />
          <Route path="/workflow" component={WorkflowPage} />
          <Route path="/calculator" component={CalculatorPage} />
          <Route path="/monitoring" component={MonitoringPage} />
          <Route path="/feedback" component={FieldFeedbackPage} />
          <Route path="/actuals" component={ProjectActualsPage} />
          <Route path="/learning" component={LearningDashboardPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
