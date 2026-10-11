import "../styles/simulate.css";
import { PageHeader } from "../components/PageHeader.js";
import { SimulatePanel } from "../components/SimulatePanel.js";

export function SimulatePage() {
  return (
    <div className="page">
      <PageHeader
        title="Simulate supplier email"
        description="Play the supplier: send an email with documents to the CG inbox, then review it in the Inbox. Nothing leaves the system."
      />
      <SimulatePanel />
    </div>
  );
}
