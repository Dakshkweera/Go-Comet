import { useEffect, useState } from "react";
import { healthResponseSchema } from "@nova/contracts";

export function App() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then(async (res) => {
        const health = healthResponseSchema.parse(await res.json());
        setStatus(`${health.status} (db: ${health.db})`);
      })
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Nova — Trade Document Pipeline</h1>
      <p>API: {status}</p>
    </main>
  );
}
