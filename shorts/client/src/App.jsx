import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { pagesConfig } from "./pages.config";
import PageNotFound from "./lib/PageNotFound";

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : () => null;

const LayoutWrapper = ({ children }) =>
  Layout ? <Layout>{children}</Layout> : <>{children}</>;

/**
 * The standalone leaderboard is gone — the gallery is the ranking now. Old
 * links (shared rounds, bookmarks, the account page) keep working, query string
 * and all, instead of landing on Page-not-found.
 */
function LeaderboardRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/Gallery${search}`} replace />;
}

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
        <Route path="/Leaderboard" element={<LeaderboardRedirect />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Router>
  );
}
