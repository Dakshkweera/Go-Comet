import "../styles/queries.css";
import { PageHeader } from "../components/PageHeader.js";
import { QueryPanel } from "../components/QueryPanel.js";

export function QueriesPage() {
  return (
    <div className="page">
      <PageHeader
        title="Query your trade operations"
        description="Ask questions about processed shipments using natural language."
      />
      <QueryPanel />
    </div>
  );
}
