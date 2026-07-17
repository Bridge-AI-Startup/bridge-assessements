import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { pagesConfig } from "./pages.config";
import PageNotFound from "./lib/PageNotFound";

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : () => null;

const LayoutWrapper = ({ children }) =>
  Layout ? <Layout>{children}</Layout> : <>{children}</>;

export default function App() {
  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <LayoutWrapper>
              <MainPage />
            </LayoutWrapper>
          }
        />
        {Object.entries(Pages)
          .filter(([path]) => path !== mainPageKey)
          .map(([path, Page]) => (
            <Route
              key={path}
              path={`/${path}`}
              element={
                <LayoutWrapper>
                  <Page />
                </LayoutWrapper>
              }
            />
          ))}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Router>
  );
}
