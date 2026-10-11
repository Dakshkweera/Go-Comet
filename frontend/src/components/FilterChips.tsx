import "../styles/inbox.css";
import type { FilterKey, ShipmentFilter } from "../shipmentDomain.js";

export function FilterChips({
  filters,
  active,
  counts,
  label,
  onSelect,
}: {
  filters: ShipmentFilter[];
  active: FilterKey;
  counts: Record<FilterKey, number>;
  label: string;
  onSelect: (key: FilterKey) => void;
}) {
  return (
    <div className="ib-chips" role="group" aria-label={label}>
      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          className={active === f.key ? "ib-chip is-active" : "ib-chip"}
          aria-pressed={active === f.key}
          onClick={() => onSelect(f.key)}
        >
          {f.label}
          <span className="ib-chip-count">{counts[f.key]}</span>
        </button>
      ))}
    </div>
  );
}
