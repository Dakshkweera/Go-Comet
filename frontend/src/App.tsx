import { useEffect } from "react";
import { AppShell } from "./components/AppShell.js";
import { EmptyState } from "./components/EmptyState.js";
import { CustomersPage } from "./pages/Customers.js";
import { DocumentDetailPage } from "./pages/DocumentDetail.js";
import { DocumentsPage } from "./pages/Documents.js";
import { ExceptionsPage } from "./pages/Exceptions.js";
import { OverviewPage } from "./pages/Overview.js";
import { QueriesPage } from "./pages/Queries.js";
import { RulesPage } from "./pages/Rules.js";
import { Link, matchPath, navigate, usePath } from "./router.js";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/documents": "Documents",
  "/exceptions": "Exceptions",
  "/queries": "Queries",
  "/customers": "Customers",
  "/rules": "Rules",
};

function Page({ path }: { path: string }) {
  switch (path) {
    case "/":
      return <OverviewPage />;
    case "/documents":
      return <DocumentsPage />;
    case "/exceptions":
      return <ExceptionsPage />;
    case "/queries":
      return <QueriesPage />;
    case "/customers":
      return <CustomersPage />;
    case "/rules":
      return <RulesPage />;
  }
  const detail = matchPath("/documents/:id", path);
  if (detail) return <DocumentDetailPage key={detail.id} id={detail.id!} />;
  return (
    <div className="page">
      <EmptyState
        icon="documents"
        title="Page not found"
        action={
          <Link to="/" className="btn btn-secondary btn-sm">
            Go to overview
          </Link>
        }
      >
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}

export function App() {
  const raw = usePath();
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;

  useEffect(() => {
    if (path === "/" && location.hash.startsWith("#run_")) {
      navigate(`/documents/${location.hash.slice(1)}`, { replace: true });
    }
  }, [path]);

  useEffect(() => {
    if (matchPath("/documents/:id", path)) return;
    document.title = TITLES[path] ? `${TITLES[path]} · Nova` : "Nova";
  }, [path]);

  return (
    <AppShell>
      <Page path={path} />
    </AppShell>
  );
}
