import { useState } from "react";
import { refreshShipments, useRefreshError } from "../shipmentData.js";
import { Icon } from "./Icon.js";

export function RefreshButton() {
  const [refreshing, setRefreshing] = useState(false);
  const error = useRefreshError();

  async function reload() {
    setRefreshing(true);
    try {
      await refreshShipments();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      {error && (
        <span className="status-dot tone-danger" role="status">
          <span className="dot" />
          Could not refresh: {error}
        </span>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => void reload()}
        disabled={refreshing}
      >
        {refreshing ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <Icon name="refresh" size={14} />
        )}
        Refresh
      </button>
    </>
  );
}
