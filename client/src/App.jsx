import "./App.css";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import VisualEditAgent from "@/lib/VisualEditAgent";
import NavigationTracker from "@/lib/NavigationTracker";
import { pagesConfig } from "./pages.config";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import PageNotFound from "./lib/PageNotFound";
import { Analytics } from "@vercel/analytics/react";
import BillingSuccess from "./pages/BillingSuccess";
import BillingCancel from "./pages/BillingCancel";

// Import GitHub pages from separate Bridge_Github project using @github alias
import GitHubLayout from "@github/pages/Layout.jsx";
import GitHubAnalysisLanding from "@github/pages/GitHubAnalysisLanding.jsx";
import GitHubAnalysis from "@github/pages/GitHubAnalysis.jsx";

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) =>
  Layout ? (
    <Layout currentPageName={currentPageName}>{children}</Layout>
  ) : (
    <>{children}</>
  );

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <NavigationTracker />
        <Routes>
          <Route
            path="/"
            element={
              <LayoutWrapper currentPageName={mainPageKey}>
                <MainPage />
              </LayoutWrapper>
            }
          />
          {Object.entries(Pages)
            .filter(([path]) => path !== mainPageKey) // Exclude mainPage from individual routes since it's already at "/"
            .map(([path, Page]) => (
            <Route
              key={path}
              path={`/${path}`}
              element={
                <LayoutWrapper currentPageName={path}>
                  <Page />
                </LayoutWrapper>
              }
            />
          ))}
          {/* Custom routes for Stripe redirects */}
          <Route
            path="/billing/success"
            element={
              <LayoutWrapper currentPageName="BillingSuccess">
                <BillingSuccess />
              </LayoutWrapper>
            }
          />
          <Route
            path="/billing/cancel"
            element={
              <LayoutWrapper currentPageName="BillingCancel">
                <BillingCancel />
              </LayoutWrapper>
            }
          />

          {/* Bridge GitHub routes */}
          <Route
            path="/github"
            element={
              <GitHubLayout>
                <GitHubAnalysisLanding />
              </GitHubLayout>
            }
          />
          <Route
            path="/GitHubAnalysisLanding"
            element={
              <GitHubLayout>
                <GitHubAnalysisLanding />
              </GitHubLayout>
            }
          />
          <Route
            path="/GitHubAnalysis"
            element={
              <GitHubLayout>
                <GitHubAnalysis />
              </GitHubLayout>
            }
          />
          <Route
            path="/github/analysis"
            element={
              <GitHubLayout>
                <GitHubAnalysis />
              </GitHubLayout>
            }
          />

          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Router>
      <Toaster />
      <VisualEditAgent />
      <Analytics />
    </QueryClientProvider>
  );
}

export default App;
