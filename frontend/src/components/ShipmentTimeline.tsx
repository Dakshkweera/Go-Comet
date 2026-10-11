import { eventMeta } from "../shipmentDomain.js";
import type { ShipmentEvent } from "../types/api.js";
import { ActivityFeed } from "./ActivityList.js";
import { EmptyState } from "./EmptyState.js";
import { SectionHeader } from "./PageHeader.js";

export function ShipmentTimeline({ events }: { events: ShipmentEvent[] }) {
  return (
    <section className="section" aria-labelledby="sd-timeline-title">
      <SectionHeader
        id="sd-timeline-title"
        title="Timeline"
        subtitle="Everything that happened to this shipment, oldest first."
      />
      <div className="panel sd-timeline">
        {events.length === 0 ? (
          <EmptyState compact icon="clock" title="No activity yet" />
        ) : (
          <ActivityFeed
            absoluteTime
            items={events.map((e, i) => ({
              key: `${i}-${e.type}-${e.at}`,
              ...eventMeta(e.type),
              title: e.message,
              at: e.at,
            }))}
          />
        )}
      </div>
    </section>
  );
}
